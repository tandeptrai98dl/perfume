/**
 * Notification module (§3.3): customer e-mails in the order's locale and internal staff alerts
 * by e-mail + Telegram (ADR-0019). Called by the worker's job handlers only.
 */
export {
  emailForTransition,
  handleOrderPlaced,
  sendAuthEmail,
  sendOrderConfirmation,
  sendOrderEdited,
  sendOrderUpdate,
  sendPaymentLink,
  sendPaymentReceived,
  sendReturnUpdate,
  sendStaffAlert,
  sendStatusChangeEmail,
  type NotificationDeps,
} from './service';
export {
  buildStaffAlert,
  STAFF_ALERT_KINDS,
  type StaffAlert,
  type StaffAlertKind,
} from './staff-alerts';
export { carrierTrackingUrl, orderPageUrl, orderPaymentUrl } from './links';
export { EMAIL_SENT_EVENT, STAFF_ALERT_EVENT } from './once';
// ---------- M3 notification log (notification_logs) ----------
export {
  deliverLogged,
  errorSummary,
  listNotificationLogs,
  logSkipped,
  maskRecipient,
  type NotificationChannel,
  type NotificationLogRow,
  type NotificationStatus,
} from './log';
