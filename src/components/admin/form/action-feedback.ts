'use client';

import { useTranslations } from 'next-intl';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';

import type { ActionResult } from '@/actions/admin/run';

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

/**
 * Turns Server Action results into UI feedback: translated field errors on the form (RHF
 * `setError`), and a toast for the outcome. Error codes come from Zod messages and
 * DomainError codes (`admin.errors.<code>`).
 */
export function useActionFeedback() {
  const t = useTranslations('admin');

  function message(code: string): string {
    const key = `errors.${code}`;
    return t.has(key as 'errors.invalid') ? t(key as 'errors.invalid') : t('errors.invalid');
  }

  function applyFieldErrors<T extends FieldValues>(
    form: UseFormReturn<T>,
    failure: Failure,
    prefix = '',
  ): string[] {
    const paths: string[] = [];
    for (const issue of failure.fieldErrors) {
      let path = issue.path;
      if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
      if (!path) continue;
      form.setError(path as Path<T>, { type: 'server', message: message(issue.code) });
      paths.push(path);
    }
    return paths;
  }

  function fail(failure: Failure) {
    const [first] = failure.fieldErrors;
    const title = failure.error === 'validation' ? t('form.fixErrors') : message(failure.error);
    const description = first && first.code !== failure.error ? message(first.code) : undefined;
    toast.error(title, description ? { description } : undefined);
  }

  return { message, applyFieldErrors, fail, success: (text: string) => toast.success(text) };
}
