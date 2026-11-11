'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { deleteAddressAction, setDefaultAddressAction } from '@/actions/account';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import type { SavedAddress } from '@/server/modules/customer';

import { AddressForm, type AdminUnitOption } from './address-form';
import { useAccountError } from './form-message';

/** AddressBook (§8.3, §10.6): up to `max` addresses, one default. */
export function AddressBook({
  addresses,
  provinces,
  max,
}: {
  addresses: SavedAddress[];
  provinces: AdminUnitOption[];
  max: number;
}) {
  const t = useTranslations('account.addresses');
  const locale = useLocale();
  const errorMessage = useAccountError();
  const [editing, setEditing] = useState<SavedAddress | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SavedAddress | null>(null);
  const [pending, startTransition] = useTransition();
  const full = addresses.length >= max;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(errorMessage(result.error));
    });
  }

  const name = (a: SavedAddress, kind: 'ward' | 'province') =>
    kind === 'ward'
      ? locale === 'en'
        ? a.wardNameAscii
        : a.wardName
      : locale === 'en'
        ? a.provinceNameAscii
        : a.provinceName;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-taupe-600">{t('intro', { max })}</p>
        <Button onClick={() => setEditing('new')} disabled={full}>
          <Plus aria-hidden />
          {t('add')}
        </Button>
      </div>
      {full && <p className="text-small text-taupe-600">{t('limitReached', { max })}</p>}

      {addresses.length === 0 ? (
        <EmptyState title={t('empty')} className="border-line-200 border" />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-testid="address-list">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="border-line-200 flex flex-col gap-4 border bg-white p-5"
              data-testid="address-card"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{address.fullName}</p>
                {address.isDefault && <Badge variant="dark">{t('default')}</Badge>}
              </div>
              <address className="text-ink-700 flex-1 not-italic">
                {address.phone}
                <br />
                {address.street}
                <br />
                {name(address, 'ward')}, {name(address, 'province')}
              </address>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Button variant="link" onClick={() => setEditing(address)}>
                  {t('edit')}
                </Button>
                {!address.isDefault && (
                  <Button
                    variant="link"
                    disabled={pending}
                    onClick={() =>
                      run(() => setDefaultAddressAction({ id: address.id }), t('defaultSaved'))
                    }
                  >
                    {t('setDefault')}
                  </Button>
                )}
                <Button variant="link" onClick={() => setDeleting(address)}>
                  {t('delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? t('addTitle') : t('editTitle')}</DialogTitle>
            <DialogDescription className="sr-only">{t('intro', { max })}</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <AddressForm
              key={editing === 'new' ? 'new' : editing.id}
              provinces={provinces}
              addressId={editing === 'new' ? undefined : editing.id}
              initial={
                editing === 'new'
                  ? undefined
                  : {
                      fullName: editing.fullName,
                      phone: editing.phone,
                      provinceCode: editing.provinceCode,
                      wardCode: editing.wardCode,
                      street: editing.street,
                      isDefault: editing.isDefault,
                    }
              }
              onSaved={() => {
                setEditing(null);
                toast.success(t('saved'));
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>{t('deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t('cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                run(async () => {
                  const result = await deleteAddressAction({ id: target.id });
                  if (result.ok) setDeleting(null);
                  return result;
                }, t('deleted'));
              }}
            >
              {t('confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
