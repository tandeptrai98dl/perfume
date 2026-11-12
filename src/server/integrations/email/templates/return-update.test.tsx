import { render, toPlainText } from 'react-email';
import { describe, expect, it } from 'vitest';

import { RETURN_EMAIL_KINDS, returnEmailSubject, ReturnUpdateEmail } from './return-update';

const lines = [{ productName: 'Cèdre Nocturne EDT', variantLabel: '100 ml', quantity: 1 }];

describe('return e-mails', () => {
  it.each(['vi', 'en'] as const)('renders every step in %s', async (locale) => {
    for (const kind of RETURN_EMAIL_KINDS) {
      const html = await render(
        <ReturnUpdateEmail
          locale={locale}
          kind={kind}
          code="PF-261112-7K3Q"
          customerName="Hương"
          orderUrl="https://shop.test/tra-cuu-don-hang?code=PF-261112-7K3Q&t=x"
          lines={lines}
          note={kind === 'approved' ? 'GHN pickup' : kind === 'rejected' ? 'Opened' : null}
          outcome={kind === 'received' ? 'partial' : null}
          refundTotal={kind === 'received' ? 1_500_000 : 0}
          refundQueued={kind === 'received' ? 1_000_000 : 0}
        />,
      );
      const text = toPlainText(html);
      expect(html).toContain(`lang="${locale}"`);
      expect(text).toContain('PF-261112-7K3Q');
      expect(text).toContain('Cèdre Nocturne EDT');
      expect(returnEmailSubject(locale, kind, 'PF-261112-7K3Q')).toContain('PF-261112-7K3Q');
      if (kind === 'approved') expect(text).toContain('GHN pickup');
      if (kind === 'rejected') expect(text).toContain('Opened');
      if (kind === 'received') expect(text).toMatch(/1[.,]500[.,]000/);
    }
  });

  it('announces a replacement instead of a refund', async () => {
    const text = toPlainText(
      await render(
        <ReturnUpdateEmail
          locale="en"
          kind="received"
          code="PF-261112-7K3Q"
          customerName="Jane"
          orderUrl="https://shop.test/en/order-lookup"
          lines={lines}
          outcome="replacement"
        />,
      ),
    );
    expect(text).toContain('A replacement will be sent to you');
    expect(text).not.toContain('Your refund');
  });
});
