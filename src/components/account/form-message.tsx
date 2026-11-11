'use client';

import { useTranslations } from 'next-intl';

import { useFormField } from '@/components/ui/form';
import { cn } from '@/lib/utils';

/**
 * Field error for account forms: Zod/server messages are codes (`account.errors.<code>`),
 * translated here. Unknown codes fall back to the generic "check this value".
 */
export function useAccountError() {
  const t = useTranslations('account.errors');
  return (code: string | undefined | null): string => {
    if (!code) return t('invalid');
    return t.has(code as 'invalid') ? t(code as 'invalid') : t('invalid');
  };
}

export function AccountFormMessage({ className }: { className?: string }) {
  const { error, messageId } = useFormField();
  const message = useAccountError();
  if (!error) return null;
  return (
    <p id={messageId} role="alert" className={cn('text-small text-danger', className)}>
      {message(error.message)}
    </p>
  );
}

/** Form-level message (submit errors / confirmations), announced politely or assertively. */
export function FormNotice({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'text-small border px-4 py-3',
        tone === 'error' && 'border-danger text-danger',
        tone === 'success' && 'border-success text-success',
        tone === 'info' && 'border-line-200 bg-sand-100 text-ink-950',
      )}
    >
      {children}
    </p>
  );
}
