import { z } from 'zod';

import { normalizeVietnamesePhone } from '@/lib/phone';

/**
 * Account & auth form schemas shared by the browser (React Hook Form) and the server
 * (Server Actions re-validate everything). Custom messages are translation codes under
 * `account.errors.*`, never user-facing text.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const MAX_ADDRESSES = 10;

const requiredText = (max: number) => z.string().trim().min(1, 'required').max(max, 'tooLong');

export const vnPhoneSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .refine((value) => normalizeVietnamesePhone(value) !== null, 'phoneInvalid')
  .transform((value) => normalizeVietnamesePhone(value)!);

const emailSchema = z.string().trim().min(1, 'required').pipe(z.email('emailInvalid'));
const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, 'passwordTooShort')
  .max(PASSWORD_MAX, 'passwordTooLong');

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'required'),
});

export const signUpSchema = z.object({
  name: requiredText(100),
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string().min(1, 'required') })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'passwordMismatch',
  });

export const addressSchema = z.object({
  fullName: requiredText(100),
  phone: vnPhoneSchema,
  provinceCode: z.string().trim().min(1, 'required').max(10, 'invalid'),
  wardCode: z.string().trim().min(1, 'required').max(10, 'invalid'),
  street: requiredText(200),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.input<typeof addressSchema>;
export type AddressValues = z.output<typeof addressSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Optional birthday: empty, or a real calendar date between 1900 and today. */
export const birthdaySchema = z
  .string()
  .trim()
  .refine((value) => {
    if (value === '') return true;
    if (!ISO_DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
    return date.getUTCFullYear() >= 1900 && date.getTime() <= Date.now();
  }, 'birthdayInvalid')
  .transform((value) => (value === '' ? null : value));

export const profileSchema = z.object({
  name: requiredText(100),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || normalizeVietnamesePhone(value) !== null, 'phoneInvalid')
    .transform((value) => (value === '' ? null : normalizeVietnamesePhone(value)!)),
  birthday: birthdaySchema,
  locale: z.enum(['vi', 'en']),
  marketingOptIn: z.boolean(),
});
export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileValues = z.output<typeof profileSchema>;

export const orderLookupSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'required')
    .transform((value) => value.toUpperCase().replace(/\s+/g, ''))
    .refine((value) => /^PF-\d{6}-[2-9A-HJKMNP-Z]{4}$/.test(value), 'codeInvalid'),
  phone: vnPhoneSchema,
});
export type OrderLookupInput = z.input<typeof orderLookupSchema>;
