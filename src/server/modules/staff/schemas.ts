import { z } from 'zod';

import { STAFF_ROLES } from '@/server/auth/permissions';

/** Staff management inputs (§11.2 "Staff & audit"). Messages are `admin.errors.*` codes. */

export const STAFF_STATUSES = ['invited', 'active', 'deactivated'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const inviteStaffSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'required')
    .max(254, 'tooLong')
    .pipe(z.email('emailInvalid')),
  name: z.string().trim().min(1, 'required').max(100, 'tooLong'),
  role: z.enum(STAFF_ROLES, { error: 'selectRequired' }),
});
export type InviteStaffInput = z.output<typeof inviteStaffSchema>;

export const staffIdSchema = z.object({ userId: z.uuid() });
export type StaffIdInput = z.output<typeof staffIdSchema>;

export const changeStaffRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(STAFF_ROLES, { error: 'selectRequired' }),
});
export type ChangeStaffRoleInput = z.output<typeof changeStaffRoleSchema>;

export const staffListSchema = z.object({
  q: z.string().trim().max(100).default(''),
  status: z.enum(STAFF_STATUSES).nullish(),
});
export type StaffListQuery = z.output<typeof staffListSchema>;

/** Invitation (set-password) links stay valid for 72 hours. */
export const INVITE_TTL_HOURS = 72;
