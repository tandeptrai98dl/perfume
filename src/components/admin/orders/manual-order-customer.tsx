'use client';

import { Search, UserCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import { useFormContext } from 'react-hook-form';

import { lookupCustomersAction } from '@/actions/admin/manual-orders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CustomerMatch } from '@/server/modules/customer';

import { useActionFeedback } from '../form/action-feedback';
import { SelectField, TextField } from '../form/fields';
import type { ManualOrderValues } from './manual-order-types';

/*
 * Customer step of the manual order (§11.2): exact lookup by phone or e-mail with masked
 * results, or a new customer typed in. Picking a match links the order to the account (or
 * reuses a guest's contact); the full phone/e-mail stay on the server.
 */
export function ManualOrderCustomer({
  match,
  onMatch,
}: {
  match: CustomerMatch | null;
  onMatch: (match: CustomerMatch | null) => void;
}) {
  const t = useTranslations('admin.orders.new.customer');
  const tForm = useTranslations('admin.form');
  const feedback = useActionFeedback();
  const form = useFormContext<ManualOrderValues>();
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerMatch[] | null>(null);
  const [searching, startSearch] = useTransition();

  function search() {
    const q = query.trim();
    if (!q) return;
    startSearch(async () => {
      const result = await lookupCustomersAction({ query: q });
      if (!result.ok) {
        feedback.fail(result);
        return;
      }
      setResults(result.data);
      // A new customer usually means the number that was just searched.
      if (!q.includes('@') && !form.getValues('customer.phone')) {
        form.setValue('customer.phone', q, { shouldDirty: true });
      }
      if (q.includes('@') && !form.getValues('customer.email')) {
        form.setValue('customer.email', q, { shouldDirty: true });
      }
    });
  }

  function choose(next: CustomerMatch) {
    onMatch(next);
    setResults(null);
    if (!form.getValues('customer.fullName')) {
      form.setValue('customer.fullName', next.name, { shouldDirty: true });
    }
    form.setValue('customer.locale', next.locale, { shouldDirty: true });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-lookup`} className="text-small font-medium">
          {t('lookup')}
        </label>
        <div className="flex max-w-xl gap-2">
          <Input
            id={`${id}-lookup`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                search();
              }
            }}
            autoComplete="off"
            aria-describedby={`${id}-lookup-hint`}
          />
          <Button type="button" variant="secondary" onClick={search} loading={searching}>
            <Search aria-hidden className="size-4" />
            {t('search')}
          </Button>
        </div>
        <p id={`${id}-lookup-hint`} className="text-small text-taupe-600">
          {t('lookupHint')}
        </p>
      </div>

      {results && (
        <div aria-live="polite">
          {results.length === 0 ? (
            <p className="text-small text-taupe-600">{t('noMatch')}</p>
          ) : (
            <ul className="border-line-200 flex flex-col border" aria-label={t('matches')}>
              {results.map((result) => (
                <li
                  key={`${result.ref.type}-${result.ref.id}`}
                  className="border-line-200 flex flex-wrap items-center justify-between gap-3 border-b p-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {result.name}
                      <Badge variant={result.registered ? 'dark' : 'outline'}>
                        {result.registered ? t('registered') : t('guest')}
                      </Badge>
                      {result.codRisk && <Badge variant="warning">{t('codRisk')}</Badge>}
                    </p>
                    <p className="text-small font-mono text-taupe-600">
                      {[result.phoneMasked, result.emailMasked].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-small text-taupe-600">
                      {t('orders', { count: result.orderCount })} · {t(`locale.${result.locale}`)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => choose(result)}
                    aria-label={t('chooseNamed', { name: result.name })}
                  >
                    {t('choose')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {match && (
        <div
          className="border-ink-950 flex flex-wrap items-center justify-between gap-3 border p-3"
          data-testid="manual-order-match"
        >
          <p className="text-small flex items-center gap-2">
            <UserCheck aria-hidden className="size-4" />
            <span>
              {t('selected', { name: match.name })}{' '}
              <span className="font-mono text-taupe-600">
                {[match.phoneMasked, match.emailMasked].filter(Boolean).join(' · ')}
              </span>
            </span>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onMatch(null)}>
            <X aria-hidden className="size-4" />
            {t('clear')}
          </Button>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <TextField<ManualOrderValues>
          name="customer.fullName"
          label={t('fullName')}
          autoComplete="off"
          maxLength={100}
        />
        <TextField<ManualOrderValues>
          name="customer.phone"
          label={t('phone')}
          description={
            match?.phoneMasked ? t('phoneFromMatch', { phone: match.phoneMasked }) : undefined
          }
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={20}
        />
        <TextField<ManualOrderValues>
          name="customer.email"
          label={`${t('email')} ${tForm('optional')}`}
          description={
            match?.emailMasked ? t('emailFromMatch', { email: match.emailMasked }) : t('emailHint')
          }
          type="email"
          autoComplete="off"
          maxLength={254}
        />
        <SelectField<ManualOrderValues>
          name="customer.locale"
          label={t('emailLocale')}
          description={t('emailLocaleHint')}
          options={[
            { value: 'vi', label: t('locale.vi') },
            { value: 'en', label: t('locale.en') },
          ]}
        />
      </div>
    </div>
  );
}
