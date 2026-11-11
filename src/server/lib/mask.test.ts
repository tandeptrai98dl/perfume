import { describe, expect, it } from 'vitest';

import { maskEmail, maskPhone } from './mask';

describe('PII masking', () => {
  it('keeps only the first letter of an email local part', () => {
    expect(maskEmail('nguyen.van.a@example.com')).toBe('n***@example.com');
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('keeps only the last three digits of a phone number', () => {
    expect(maskPhone('+84 912 345 678')).toBe('***678');
    expect(maskPhone('12')).toBe('***');
  });
});
