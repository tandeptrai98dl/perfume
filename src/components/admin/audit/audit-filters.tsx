import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { fieldBase, Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AuditFilter } from '@/server/modules/audit';
import type { StaffOption } from '@/server/modules/staff';

function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldBase, 'min-h-11 py-2', className)} {...props} />;
}

/**
 * Audit filters (§11.2: actor, entity type, action, date) as a plain GET form: the URL holds
 * the state (shareable, back button), and it needs no client JavaScript. Applying filters
 * starts again from the newest entry (the cursor is dropped).
 */
export function AuditFilters({
  filter,
  actors,
  entityTypes,
}: {
  filter: AuditFilter;
  actors: StaffOption[];
  entityTypes: string[];
}) {
  const t = useTranslations('admin');
  const entityLabel = (type: string) =>
    t.has(`audit.entityTypes.${type}` as 'audit.entityTypes.order')
      ? t(`audit.entityTypes.${type}` as 'audit.entityTypes.order')
      : type;
  const label = 'text-small flex flex-col gap-2 font-medium';
  return (
    <form
      method="get"
      action="/admin/audit-log"
      aria-label={t('audit.filters.label')}
      className="flex flex-wrap items-end gap-3"
    >
      <label className={cn(label, 'w-52')}>
        {t('audit.filters.actor')}
        <NativeSelect name="actorId" defaultValue={filter.actorId ?? ''}>
          <option value="">{t('audit.filters.all')}</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name} ({t(`roles.${actor.role}`)})
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className={cn(label, 'w-48')}>
        {t('audit.filters.entityType')}
        <NativeSelect name="entityType" defaultValue={filter.entityType ?? ''}>
          <option value="">{t('audit.filters.all')}</option>
          {entityTypes.map((type) => (
            <option key={type} value={type}>
              {entityLabel(type)}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className={cn(label, 'w-52')}>
        {t('audit.filters.action')}
        <Input
          name="action"
          defaultValue={filter.action ?? ''}
          placeholder={t('audit.filters.actionPlaceholder')}
          autoComplete="off"
          maxLength={60}
          pattern="[a-zA-Z0-9_.]+"
        />
      </label>
      <label className={cn(label, 'w-52')}>
        {t('audit.filters.entityId')}
        <Input
          name="entityId"
          defaultValue={filter.entityId ?? ''}
          autoComplete="off"
          maxLength={100}
        />
      </label>
      <label className={cn(label, 'w-40')}>
        {t('audit.filters.from')}
        <Input type="date" name="from" defaultValue={filter.from ?? ''} />
      </label>
      <label className={cn(label, 'w-40')}>
        {t('audit.filters.to')}
        <Input type="date" name="to" defaultValue={filter.to ?? ''} />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit">{t('audit.filters.apply')}</Button>
        <Link
          href={'/admin/audit-log' as Route}
          className="text-small text-gold-700 underline-offset-4 hover:underline"
        >
          {t('audit.filters.reset')}
        </Link>
      </div>
    </form>
  );
}
