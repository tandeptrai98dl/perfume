import { describe, expect, it } from 'vitest';

import {
  addressSchema,
  orderLookupSchema,
  profileSchema,
  resetPasswordSchema,
  signUpSchema,
} from './account';

function codes(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : result.error!.issues.map((issue) => issue.message);
}

describe('account schemas', () => {
  it('requires passwords of at least 8 characters on sign-up', () => {
    expect(
      codes(signUpSchema.safeParse({ name: 'A', email: 'a@b.vn', password: '1234567' })),
    ).toEqual(['passwordTooShort']);
    expect(
      signUpSchema.safeParse({ name: 'A', email: 'a@b.vn', password: '12345678' }).success,
    ).toBe(true);
  });

  it('checks the reset confirmation', () => {
    expect(
      codes(resetPasswordSchema.safeParse({ password: 'abcdefgh', confirm: 'abcdefgx' })),
    ).toEqual(['passwordMismatch']);
  });

  it('normalises address phones and rejects non-Vietnamese numbers', () => {
    const ok = addressSchema.parse({
      fullName: ' Nguyễn Văn A ',
      phone: '+84 912 345 678',
      provinceCode: '01',
      wardCode: '00004',
      street: '12 Hàng Bạc',
    });
    expect(ok).toMatchObject({ fullName: 'Nguyễn Văn A', phone: '0912345678', isDefault: false });
    expect(
      codes(
        addressSchema.safeParse({
          fullName: 'A',
          phone: '12345',
          provinceCode: '01',
          wardCode: '1',
          street: 'x',
        }),
      ),
    ).toEqual(['phoneInvalid']);
  });

  it('accepts an empty phone and birthday on the profile but rejects bad dates', () => {
    const base = { name: 'A', phone: '', birthday: '', locale: 'en', marketingOptIn: false };
    expect(profileSchema.parse(base)).toMatchObject({ phone: null, birthday: null });
    expect(codes(profileSchema.safeParse({ ...base, birthday: '2001-02-30' }))).toEqual([
      'birthdayInvalid',
    ]);
    expect(codes(profileSchema.safeParse({ ...base, birthday: '2999-01-01' }))).toEqual([
      'birthdayInvalid',
    ]);
    expect(profileSchema.parse({ ...base, birthday: '1990-05-17' }).birthday).toBe('1990-05-17');
  });

  it('normalises lookup codes typed in lower case', () => {
    expect(orderLookupSchema.parse({ code: ' pf-261111-7k3q ', phone: '0912345678' }).code).toBe(
      'PF-261111-7K3Q',
    );
    expect(codes(orderLookupSchema.safeParse({ code: 'PF-1', phone: '0912345678' }))).toEqual([
      'codeInvalid',
    ]);
  });
});
