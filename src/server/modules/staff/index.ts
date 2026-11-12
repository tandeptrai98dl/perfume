/**
 * Staff module public API (M3, §11.2 "Staff & audit"): staff accounts, roles, invitations,
 * deactivation and 2FA resets. Shared with the worker: no `server-only`, no Next.js APIs.
 */
export {
  changeStaffRole,
  deactivateStaff,
  inviteStaff,
  reactivateStaff,
  resendStaffInvite,
  resetStaffTwoFactor,
  SET_PASSWORD_PATH,
  setPasswordUrl,
  type StaffContext,
} from './commands';
export {
  getStaffMember,
  listStaff,
  listStaffOptions,
  staffStatus,
  type StaffMember,
  type StaffOption,
} from './queries';
export { checkStaffChange, type StaffChange, type StaffTarget } from './rules';
export {
  changeStaffRoleSchema,
  INVITE_TTL_HOURS,
  inviteStaffSchema,
  STAFF_STATUSES,
  staffIdSchema,
  staffListSchema,
  type ChangeStaffRoleInput,
  type InviteStaffInput,
  type StaffIdInput,
  type StaffListQuery,
  type StaffStatus,
} from './schemas';
