import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';

import { STAFF_ROLES, type StaffRole } from '@/server/auth/permissions';
import type { Database } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { foldedContains } from '@/server/lib/sql-helpers';

import type { StaffListQuery, StaffStatus } from './schemas';

type Reader = Pick<Database, 'select'>;

export type StaffMember = {
  id: string;
  name: string;
  /** Staff work address; shown in full to Owners only (`staff.manage`). */
  email: string;
  role: StaffRole;
  status: StaffStatus;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

/*
 * Written with explicit table-qualified names: inside a select list Drizzle renders column
 * references unqualified, and an unqualified `id` here would resolve to `accounts.id`.
 */
const hasPassword = sql<boolean>`exists (
  select 1 from "accounts"
  where "accounts"."user_id" = "users"."id"
    and "accounts"."provider_id" = 'credential'
    and "accounts"."password" is not null
)`;

const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  banned: users.banned,
  twoFactorEnabled: users.twoFactorEnabled,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  hasPassword,
};

type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  hasPassword: boolean;
};

export function staffStatus(row: { banned: boolean; hasPassword: boolean }): StaffStatus {
  if (row.banned) return 'deactivated';
  return row.hasPassword ? 'active' : 'invited';
}

function toMember(row: Row): StaffMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as StaffRole,
    status: staffStatus(row),
    twoFactorEnabled: row.twoFactorEnabled,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

const isStaff = and(inArray(users.role, [...STAFF_ROLES]), isNull(users.deletedAt));

/** Every staff account (a shop has a handful), Owners first, then by name. */
export async function listStaff(db: Reader, query: StaffListQuery): Promise<StaffMember[]> {
  const conditions: (SQL | undefined)[] = [isStaff];
  if (query.q) {
    conditions.push(or(foldedContains(users.name, query.q), foldedContains(users.email, query.q)));
  }
  if (query.status === 'deactivated') conditions.push(eq(users.banned, true));
  if (query.status === 'active') conditions.push(and(eq(users.banned, false), hasPassword));
  if (query.status === 'invited') {
    conditions.push(and(eq(users.banned, false), sql`not ${hasPassword}`));
  }
  const roleOrder = sql`array_position(array[${sql.join(
    STAFF_ROLES.map((role) => sql`${role}`),
    sql`, `,
  )}]::user_role[], ${users.role})`;
  const rows = await db
    .select(columns)
    .from(users)
    .where(and(...conditions))
    .orderBy(roleOrder, asc(users.name))
    .limit(500);
  return rows.map(toMember);
}

export async function getStaffMember(db: Reader, id: string): Promise<StaffMember | null> {
  const [row] = await db
    .select(columns)
    .from(users)
    .where(and(eq(users.id, id), isStaff));
  return row ? toMember(row) : null;
}

export type StaffOption = { id: string; name: string; role: StaffRole };

/** Staff names for filters (e.g. the audit log's actor filter), deactivated included. */
export async function listStaffOptions(db: Reader): Promise<StaffOption[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(isStaff)
    .orderBy(asc(users.name));
  return rows.map((row) => ({ ...row, role: row.role as StaffRole }));
}
