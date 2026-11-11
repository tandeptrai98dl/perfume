import { and, asc, count, desc, eq, ne } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { addresses, provinces, users, wards } from '@/server/db/schema';
import { DomainError, type Tx } from '@/server/lib/command-context';
import { MAX_ADDRESSES, type AddressValues } from '@/lib/validation/account';

/*
 * Address book (§10.6: max 10, one default). Every query is scoped by `user_id`. Writes lock
 * the user's row so two concurrent "add" requests cannot exceed the limit or leave two
 * defaults. The checkout stream reads addresses through `listAddresses`/`getAddress` only.
 */

type Reader = Pick<Database, 'select'>;

export type SavedAddress = {
  id: string;
  fullName: string;
  phone: string;
  provinceCode: string;
  provinceName: string;
  provinceNameAscii: string;
  wardCode: string;
  wardName: string;
  wardNameAscii: string;
  street: string;
  isDefault: boolean;
};

function selectAddresses(db: Reader) {
  return db
    .select({
      id: addresses.id,
      fullName: addresses.fullName,
      phone: addresses.phone,
      provinceCode: addresses.provinceCode,
      provinceName: provinces.name,
      provinceNameAscii: provinces.nameAscii,
      wardCode: addresses.wardCode,
      wardName: wards.name,
      wardNameAscii: wards.nameAscii,
      street: addresses.street,
      isDefault: addresses.isDefault,
    })
    .from(addresses)
    .innerJoin(provinces, eq(provinces.code, addresses.provinceCode))
    .innerJoin(wards, eq(wards.code, addresses.wardCode));
}

/** Default first, then most recently added. */
export async function listAddresses(db: Reader, userId: string): Promise<SavedAddress[]> {
  return selectAddresses(db)
    .where(eq(addresses.userId, userId))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt), asc(addresses.id));
}

export async function getAddress(
  db: Reader,
  input: { userId: string; addressId: string },
): Promise<SavedAddress | null> {
  const [row] = await selectAddresses(db)
    .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, input.userId)))
    .limit(1);
  return row ?? null;
}

async function lockUser(tx: Tx, userId: string) {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!user) throw new DomainError('notFound');
}

async function assertWardInProvince(tx: Tx, provinceCode: string, wardCode: string) {
  const [ward] = await tx
    .select({ provinceCode: wards.provinceCode })
    .from(wards)
    .where(eq(wards.code, wardCode))
    .limit(1);
  if (!ward || ward.provinceCode !== provinceCode) {
    throw new DomainError('invalid', [{ path: 'wardCode', code: 'wardInvalid' }]);
  }
}

async function clearDefault(tx: Tx, userId: string, exceptId: string) {
  await tx
    .update(addresses)
    .set({ isDefault: false })
    .where(
      and(eq(addresses.userId, userId), ne(addresses.id, exceptId), eq(addresses.isDefault, true)),
    );
}

export async function createAddress(
  db: Database,
  input: { userId: string; values: AddressValues },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await lockUser(tx, input.userId);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(addresses)
      .where(eq(addresses.userId, input.userId));
    if (n >= MAX_ADDRESSES) {
      throw new DomainError('invalid', [{ path: '', code: 'addressLimit' }]);
    }
    await assertWardInProvince(tx, input.values.provinceCode, input.values.wardCode);
    // The first address is always the default.
    const isDefault = n === 0 || input.values.isDefault;
    const [created] = await tx
      .insert(addresses)
      .values({ ...input.values, isDefault, userId: input.userId })
      .returning({ id: addresses.id });
    if (isDefault) await clearDefault(tx, input.userId, created!.id);
    return { id: created!.id };
  });
}

export async function updateAddress(
  db: Database,
  input: { userId: string; addressId: string; values: AddressValues },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await lockUser(tx, input.userId);
    const [current] = await tx
      .select({ isDefault: addresses.isDefault })
      .from(addresses)
      .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, input.userId)))
      .limit(1);
    if (!current) throw new DomainError('notFound');
    await assertWardInProvince(tx, input.values.provinceCode, input.values.wardCode);
    // Unticking "default" on the default address is ignored: someone must stay default.
    const isDefault = current.isDefault || input.values.isDefault;
    await tx
      .update(addresses)
      .set({ ...input.values, isDefault })
      .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, input.userId)));
    if (isDefault) await clearDefault(tx, input.userId, input.addressId);
    return { id: input.addressId };
  });
}

export async function setDefaultAddress(
  db: Database,
  input: { userId: string; addressId: string },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await lockUser(tx, input.userId);
    const updated = await tx
      .update(addresses)
      .set({ isDefault: true })
      .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, input.userId)))
      .returning({ id: addresses.id });
    if (updated.length === 0) throw new DomainError('notFound');
    await clearDefault(tx, input.userId, input.addressId);
    return { id: input.addressId };
  });
}

/** Deleting the default promotes the most recently added remaining address. */
export async function deleteAddress(
  db: Database,
  input: { userId: string; addressId: string },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await lockUser(tx, input.userId);
    const [deleted] = await tx
      .delete(addresses)
      .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, input.userId)))
      .returning({ isDefault: addresses.isDefault });
    if (!deleted) throw new DomainError('notFound');
    if (deleted.isDefault) {
      const [next] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.userId, input.userId))
        .orderBy(desc(addresses.createdAt), desc(addresses.id))
        .limit(1);
      if (next)
        await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
    }
    return { id: input.addressId };
  });
}
