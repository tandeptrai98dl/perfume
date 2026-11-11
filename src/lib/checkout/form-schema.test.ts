import { describe, expect, it } from 'vitest';

import { checkoutFormSchema, type CheckoutFormInput } from './form-schema';

const valid: CheckoutFormInput = {
  locale: 'vi',
  checkoutKey: 'k_0123456789abcdef',
  email: ' Khach@Example.com ',
  phone: '+84 912 345 678',
  fullName: 'Nguyễn Văn A',
  address: { provinceCode: '79', wardCode: '26734', street: '12 Lê Lợi' },
  shippingRateId: '019a0000-0000-7000-8000-000000000001',
  paymentMethod: 'cod',
  couponCode: '',
  customerNote: '',
  vatInvoice: {
    requested: false,
    companyName: '',
    taxCode: '',
    email: '',
    address: { provinceCode: '', wardCode: '', street: '' },
  },
  consents: { terms: true, privacy: true, marketing: false },
};

function issues(input: unknown) {
  const result = checkoutFormSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`);
}

describe('checkoutFormSchema', () => {
  it('normalizes a valid form', () => {
    const result = checkoutFormSchema.parse(valid);
    expect(result).toMatchObject({
      email: 'khach@example.com',
      phone: '0912345678',
      couponCode: null,
      customerNote: null,
      vatInvoice: null,
    });
    expect(result).not.toHaveProperty('prices');
  });

  it('rejects invalid phone numbers and e-mails with translation codes', () => {
    expect(issues({ ...valid, phone: '0281234567' })).toEqual(['phone:phoneInvalid']);
    expect(issues({ ...valid, phone: '' })).toEqual(['phone:required']);
    expect(issues({ ...valid, email: 'not-an-email' })).toEqual(['email:emailInvalid']);
    expect(issues({ ...valid, email: '' })).toEqual(['email:required']);
  });

  it('requires name, province, ward, street, shipping and payment', () => {
    expect(
      issues({
        ...valid,
        fullName: ' ',
        address: { provinceCode: '', wardCode: '', street: '' },
        shippingRateId: '',
        paymentMethod: '',
      }),
    ).toEqual([
      'fullName:tooShort',
      'address.provinceCode:selectRequired',
      'address.wardCode:selectRequired',
      'address.street:tooShort',
      'shippingRateId:shippingRequired',
      'paymentMethod:paymentRequired',
    ]);
  });

  it('requires terms and privacy consent; marketing stays optional', () => {
    expect(
      issues({ ...valid, consents: { terms: false, privacy: false, marketing: false } }),
    ).toEqual(['consents.terms:consentRequired', 'consents.privacy:consentRequired']);
    expect(checkoutFormSchema.parse(valid).consents.marketing).toBe(false);
  });

  it('validates VAT invoice details only when requested', () => {
    const vat = { ...valid.vatInvoice, requested: true };
    expect(issues({ ...valid, vatInvoice: vat })).toEqual([
      'vatInvoice.companyName:required',
      'vatInvoice.taxCode:taxCodeInvalid',
      'vatInvoice.email:emailInvalid',
      'vatInvoice.address.provinceCode:selectRequired',
      'vatInvoice.address.wardCode:selectRequired',
      'vatInvoice.address.street:tooShort',
    ]);
    const parsed = checkoutFormSchema.parse({
      ...valid,
      vatInvoice: {
        requested: true,
        companyName: 'Công ty TNHH ABC',
        taxCode: '0312345678-001',
        email: 'Ketoan@ABC.vn',
        address: { provinceCode: '79', wardCode: '26734', street: '1 Nguyễn Huệ' },
      },
    });
    expect(parsed.vatInvoice).toEqual({
      companyName: 'Công ty TNHH ABC',
      taxCode: '0312345678-001',
      email: 'ketoan@abc.vn',
      address: { provinceCode: '79', wardCode: '26734', street: '1 Nguyễn Huệ' },
    });
  });

  it.each(['0312345678', '0312345678-001', '079123456789'])('accepts tax code %s', (taxCode) => {
    const vatInvoice = {
      requested: true,
      companyName: 'ABC',
      taxCode,
      email: 'a@b.vn',
      address: { provinceCode: '79', wardCode: '26734', street: '1 Nguyễn Huệ' },
    };
    expect(issues({ ...valid, vatInvoice })).toEqual([]);
  });

  it('carries no price fields: unknown keys are dropped', () => {
    const parsed = checkoutFormSchema.parse({ ...valid, total: 1, unitPrice: 1 });
    expect(parsed).not.toHaveProperty('total');
    expect(parsed).not.toHaveProperty('unitPrice');
  });

  it('rejects a malformed checkout key', () => {
    expect(issues({ ...valid, checkoutKey: 'short' })[0]).toMatch(/^checkoutKey:/);
  });
});
