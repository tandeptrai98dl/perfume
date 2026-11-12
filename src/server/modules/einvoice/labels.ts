import { createTranslator } from 'next-intl';

import viMessages from '../../../../messages/vi.json';

import type { InvoiceLabels } from './build';

/**
 * Invoice wording (always Vietnamese: the legal document) from `admin.einvoices` in
 * messages/vi.json, without Next.js request APIs (shared with the worker, ADR-0023).
 */
export function invoiceLabels(): InvoiceLabels {
  const t = createTranslator({
    locale: 'vi',
    messages: viMessages,
    namespace: 'admin.einvoices',
    onError(error) {
      throw error;
    },
  });
  return {
    unitGoods: t('document.unitGoods'),
    unitService: t('document.unitService'),
    shipping: t('document.shipping'),
    giftWrap: t('document.giftWrap'),
    paymentMethod: t('document.paymentMethod'),
    note: (code) => t('document.note', { code }),
    words: {
      digits: t('words.digits').split('|'),
      hundred: t('words.hundred'),
      ten: t('words.ten'),
      tens: t('words.tens'),
      odd: t('words.odd'),
      oneAfterTens: t('words.oneAfterTens'),
      fourAfterTens: t('words.fourAfterTens'),
      five: t('words.five'),
      thousand: t('words.thousand'),
      million: t('words.million'),
      billion: t('words.billion'),
      currency: t('words.currency'),
    },
  };
}
