import { z } from 'zod';

import { routing } from '@/i18n/routing';

import { GIFT_MESSAGE_MAX_LENGTH, MAX_REQUESTED_QUANTITY } from './rules';

/** Inputs of the cart Server Actions (validated before anything else, CLAUDE.md). */

const locale = z.enum(routing.locales);
const id = z.uuid();

export const addToCartSchema = z.object({
  variantId: id,
  quantity: z.number().int().min(1).max(MAX_REQUESTED_QUANTITY).default(1),
  locale,
});

export const updateCartItemSchema = z.object({
  itemId: id,
  quantity: z.number().int().min(0).max(MAX_REQUESTED_QUANTITY),
  locale,
});

export const removeCartItemSchema = z.object({ itemId: id, locale });

export const applyCouponSchema = z.object({
  code: z.string().trim().min(1).max(64),
  locale,
});

export const cartLocaleSchema = z.object({ locale });

export const giftOptionsSchema = z.object({
  giftWrap: z.boolean(),
  giftMessage: z
    .string()
    .transform((value) => value.normalize('NFC').trim())
    // Code points, like Postgres char_length (the CHECK on carts.gift_message).
    .refine((value) => [...value].length <= GIFT_MESSAGE_MAX_LENGTH, 'tooLong')
    .nullable()
    .default(null),
  hidePrices: z.boolean(),
  locale,
});

export type AddToCartInput = z.input<typeof addToCartSchema>;
export type UpdateCartItemInput = z.input<typeof updateCartItemSchema>;
export type GiftOptionsInput = z.input<typeof giftOptionsSchema>;
