'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import {
  changeStaffRoleAction,
  deactivateStaffAction,
  reactivateStaffAction,
  resendStaffInviteAction,
  resetStaffTwoFactorAction,
} from '@/actions/admin/staff';
import type { ActionResult } from '@/actions/admin/run';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { StaffRole } from '@/server/auth/permissions';
import type { StaffStatus } from '@/server/modules/staff';

import { ConfirmDialog } from '../confirm-dialog';
import { useActionFeedback } from '../form/action-feedback';

type Member = { id: string; name: string; role: StaffRole; status: StaffStatus };

/** Owner actions on one staff account (§11.2). Guards are enforced again on the server. */
export function StaffActions({ member, roles }: { member: Member; roles: readonly StaffRole[] }) {
  const t = useTranslations('admin');
  const feedback = useActionFeedback();
  const id = useId();
  const [role, setRole] = useState<StaffRole>(member.role);
  const [pending, startTransition] = useTransition();

  async function run(action: Promise<ActionResult<unknown>>, done: string): Promise<boolean> {
    const result = await action;
    if (!result.ok) {
      feedback.fail(result);
      return false;
    }
    feedback.success(done);
    return true;
  }

  const deactivated = member.status === 'deactivated';

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="border-line-200 flex flex-col gap-5 border bg-white p-4"
    >
      <h2 id={`${id}-title`} className="text-h3">
        {t('staff.actionsFor', { name: member.name })}
      </h2>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-56 flex-col gap-2">
          <label htmlFor={`${id}-role`} className="text-small font-medium">
            {t('staff.fields.role')}
          </label>
          <Select value={role} onValueChange={(value) => setRole(value as StaffRole)}>
            <SelectTrigger id={`${id}-role`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`roles.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ConfirmDialog
          trigger={
            <Button variant="secondary" disabled={role === member.role}>
              {t('staff.changeRole')}
            </Button>
          }
          title={t('staff.changeRoleTitle', { name: member.name })}
          description={t('staff.changeRoleDescription')}
          confirmLabel={t('staff.changeRole')}
          destructive={false}
          onConfirm={() =>
            run(changeStaffRoleAction({ userId: member.id, role }), t('staff.roleChanged'))
          }
        />
      </div>

      <div className="flex flex-wrap gap-3">
        {member.status === 'invited' && (
          <Button
            variant="secondary"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                await run(resendStaffInviteAction({ userId: member.id }), t('staff.inviteResent'));
              })
            }
          >
            {t('staff.resendInvite')}
          </Button>
        )}
        {!deactivated && (
          <ConfirmDialog
            trigger={<Button variant="secondary">{t('staff.resetTwoFactor')}</Button>}
            title={t('staff.resetTwoFactorTitle', { name: member.name })}
            description={t('staff.resetTwoFactorDescription')}
            confirmLabel={t('staff.resetTwoFactor')}
            onConfirm={() =>
              run(resetStaffTwoFactorAction({ userId: member.id }), t('staff.twoFactorReset'))
            }
          />
        )}
        {deactivated ? (
          <ConfirmDialog
            trigger={<Button variant="secondary">{t('staff.reactivate')}</Button>}
            title={t('staff.reactivateTitle', { name: member.name })}
            description={t('staff.reactivateDescription')}
            confirmLabel={t('staff.reactivate')}
            destructive={false}
            onConfirm={() =>
              run(reactivateStaffAction({ userId: member.id }), t('staff.reactivated'))
            }
          />
        ) : (
          <ConfirmDialog
            trigger={<Button variant="danger">{t('staff.deactivate')}</Button>}
            title={t('staff.deactivateTitle', { name: member.name })}
            description={t('staff.deactivateDescription')}
            confirmLabel={t('staff.deactivate')}
            onConfirm={() =>
              run(deactivateStaffAction({ userId: member.id }), t('staff.deactivated'))
            }
          />
        )}
      </div>
    </section>
  );
}
