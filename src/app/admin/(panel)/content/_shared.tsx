import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { requireAdminPage } from '@/server/auth/guards';
import type { TranslationStatus } from '@/server/modules/content';

/** Every content screen requires `content.manage` (RBAC §11.1: owner, manager, editor). */
export async function requireContentAdmin() {
  await requireAdminPage('content.manage');
  return getTranslations({ locale: 'vi', namespace: 'admin.content' });
}

export async function idParam(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) notFound();
  return parsed.data;
}

export function PageHeader({
  title,
  description,
  back,
  action,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  action?: { href: string; label: string };
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        {back && (
          <Link href={back.href as Route} className="text-small hover:text-ink-950 text-taupe-600">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-h2">{title}</h1>
        {description && <p className="max-w-2xl text-taupe-600">{description}</p>}
      </div>
      {action && (
        <Link
          href={action.href as Route}
          className="bg-ink-950 text-ivory-50 hover:bg-ink-700 text-button inline-flex min-h-11 items-center px-6 font-medium uppercase"
        >
          {action.label}
        </Link>
      )}
    </header>
  );
}

export async function TranslationBadge({ status }: { status: TranslationStatus }) {
  const t = await getTranslations({ locale: 'vi', namespace: 'admin.content.translationState' });
  if (!status) return <Badge variant="outline">{t('missing')}</Badge>;
  return status.isPublished ? (
    <Badge variant="success">{t('published')}</Badge>
  ) : (
    <Badge variant="warning">{t('draft')}</Badge>
  );
}

export function DataTable({
  caption,
  head,
  children,
  empty,
}: {
  caption: string;
  head: string[];
  children: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-line-200 text-small border-b">
            {head.map((h, i) => (
              <th key={i} scope="col" className="py-3 pe-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {empty && (
            <tr>
              <td colSpan={head.length} className="py-8 text-taupe-600">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const cell = 'border-line-200 border-b py-3 pe-4 align-top';

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}
