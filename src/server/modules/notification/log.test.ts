import { describe, expect, it } from 'vitest';

import { errorSummary, maskRecipient } from './log';

describe('notification log helpers', () => {
  it('stores recipients masked', () => {
    expect(maskRecipient('email', 'huong.nguyen@example.com')).toBe('h***@example.com');
    expect(maskRecipient('telegram', '-1001234567890')).toBe('***890');
    expect(maskRecipient('email', null)).toBe('—');
  });

  it('strips addresses, phone numbers and URLs from errors', () => {
    const summary = errorSummary(
      new Error(
        '550 mailbox huong@example.com unavailable; call 0912 345 678 or see https://x.test/bot123:abc',
      ),
    );
    expect(summary).toBe('Error: 550 mailbox [email] unavailable; call [number] or see [url]');
    expect(errorSummary('x'.repeat(500))).toHaveLength(300);
  });
});
