'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useId, useState, useTransition, type ComponentProps, type ReactNode } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';

import type { ActionResult } from '@/actions/admin/content';
import { Button } from '@/components/ui/button';
import { fieldBase } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Small building blocks shared by the admin content forms (Vietnamese UI, `admin.content`). */

export function useErrorMessage() {
  const t = useTranslations('admin.content.errors');
  return (code: string | undefined) => {
    if (!code) return undefined;
    return t.has(code as 'invalid') ? t(code as 'invalid') : t('invalid');
  };
}

/** Runs a Server Action, maps field errors into the form and shows a toast on success. */
export function useActionSubmit<T extends FieldValues>(
  form: UseFormReturn<T>,
  options: { redirectTo?: (id: string) => string } = {},
) {
  const t = useTranslations('admin.content');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  function submit(run: () => Promise<ActionResult>) {
    setFormError(null);
    startTransition(async () => {
      const result = await run();
      if (result.ok) {
        toast.success(t('saved'));
        if (options.redirectTo) router.push(options.redirectTo(result.id) as Route);
        else router.refresh();
        return;
      }
      for (const [path, code] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(path as Path<T>, { type: 'server', message: code });
      }
      setFormError(result.error);
    });
  }

  return { pending, formError, submit };
}

export function FormError({ code }: { code: string | null }) {
  const message = useErrorMessage();
  if (!code) return null;
  return (
    <p role="alert" className="text-small text-danger border-danger border px-3 py-2">
      {message(code)}
    </p>
  );
}

/** Label + control + hint + error with the ids wired for assistive technology. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const message = useErrorMessage();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} id={`${id}-label`} className="text-small font-medium">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="text-small text-taupe-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-small text-danger">
          {message(error)}
        </p>
      )}
    </div>
  );
}

export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldBase, 'min-h-11 py-2', className)} {...props} />;
}

export function CheckboxRow({
  label,
  className,
  ...props
}: ComponentProps<'input'> & { label: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex min-h-11 items-center gap-3', className)}>
      <input id={id} type="checkbox" className="accent-ink-950 size-5" {...props} />
      <label htmlFor={id} className="text-small">
        {label}
      </label>
    </div>
  );
}

export function SubmitBar({ pending, children }: { pending: boolean; children?: ReactNode }) {
  const t = useTranslations('admin.content');
  return (
    <div className="border-line-200 flex flex-wrap items-center gap-3 border-t pt-6">
      <Button type="submit" loading={pending}>
        {t('save')}
      </Button>
      {children}
    </div>
  );
}

/** Delete button with a confirmation prompt. */
export function DeleteButton({
  action,
  redirectTo,
  label,
}: {
  action: () => Promise<ActionResult>;
  redirectTo?: string;
  label?: string;
}) {
  const t = useTranslations('admin.content');
  const message = useErrorMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      loading={pending}
      className="text-danger"
      onClick={() => {
        if (!window.confirm(t('confirmDelete'))) return;
        startTransition(async () => {
          const result = await action();
          if (!result.ok) {
            toast.error(message(result.error));
            return;
          }
          toast.success(t('deleted'));
          if (redirectTo) router.push(redirectTo as Route);
          else router.refresh();
        });
      }}
    >
      {label ?? t('delete')}
    </Button>
  );
}
