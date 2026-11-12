/** Message-key helpers for privacy requests (`admin.privacyRequests.*`). */

export function privacyTypeKey(type: 'export' | 'delete' | 'correct' | 'withdraw_consent') {
  return type === 'withdraw_consent' ? 'withdrawConsent' : type;
}

export function privacyStatusKey(status: 'received' | 'in_progress' | 'completed' | 'rejected') {
  return status === 'in_progress' ? 'inProgress' : status;
}

export const PRIVACY_STATUS_TONES = {
  received: 'gold',
  in_progress: 'warning',
  completed: 'success',
  rejected: 'outline',
} as const;
