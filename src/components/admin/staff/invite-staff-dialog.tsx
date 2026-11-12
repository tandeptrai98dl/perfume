'use client';

import { UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import { inviteStaffAction } from '@/actions/admin/staff';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import type { StaffRole } from '@/server/auth/permissions';

import { useActionFeedback } from '../form/action-feedback';
import { SelectField, TextField } from '../form/fields';

type Values = { name: string; email: string; role: StaffRole | null };

/** Invite by e-mail (§11.2): the server creates the account and sends a set-password link. */
export function InviteStaffDialog({
  roles,
  inviteHours,
}: {
  roles: readonly StaffRole[];
  inviteHours: number;
}) {
  const t = useTranslations('admin');
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({ defaultValues: { name: '', email: '', role: 'staff' } });

  function submit(values: Values) {
    startTransition(async () => {
      const result = await inviteStaffAction(values);
      if (!result.ok) {
        feedback.applyFieldErrors(form, result);
        feedback.fail(result);
        return;
      }
      feedback.success(t('staff.invited'));
      setOpen(false);
      form.reset();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          {t('staff.invite')}
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle className="text-h3">{t('staff.inviteTitle')}</DialogTitle>
          <DialogDescription>
            {t('staff.inviteDescription', { hours: inviteHours })}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
            <TextField<Values>
              name="name"
              label={t('staff.fields.name')}
              autoComplete="off"
              maxLength={100}
            />
            <TextField<Values>
              name="email"
              type="email"
              label={t('staff.fields.email')}
              autoComplete="off"
              maxLength={254}
            />
            <SelectField<Values>
              name="role"
              label={t('staff.fields.role')}
              options={roles.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t('form.cancel')}
              </Button>
              <Button type="submit" loading={pending}>
                {t('staff.invite')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
