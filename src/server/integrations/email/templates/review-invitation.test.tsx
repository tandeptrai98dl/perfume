import { render, toPlainText } from 'react-email';
import { describe, expect, it } from 'vitest';

import { ReviewInvitationEmail, reviewInvitationSubject } from './review-invitation';

const items = [
  {
    productName: 'Cèdre Nocturne EDT',
    variantLabel: '100 ml',
    url: 'https://shop.test/danh-gia/abc',
  },
  { productName: 'Ambre Soie EDP', variantLabel: '50 ml', url: 'https://shop.test/danh-gia/def' },
];

describe('review invitation e-mail', () => {
  it.each(['vi', 'en'] as const)('renders one link per line for guests in %s', async (locale) => {
    const html = await render(
      <ReviewInvitationEmail
        locale={locale}
        kind="guest"
        customerName="Hương"
        orderCode="PF-261111-7K3Q"
        items={items}
        validDays={30}
      />,
    );
    const text = toPlainText(html);
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain('https://shop.test/danh-gia/abc');
    expect(html).toContain('https://shop.test/danh-gia/def');
    expect(text).toContain('Cèdre Nocturne EDT');
    expect(text).toContain('30');
    expect(reviewInvitationSubject(locale, 'PF-261111-7K3Q')).toContain('PF-261111-7K3Q');
  });

  it('points members to their account', async () => {
    const html = await render(
      <ReviewInvitationEmail
        locale="en"
        kind="member"
        customerName="Jane"
        orderCode="PF-261111-7K3Q"
        items={items.map((item) => ({
          productName: item.productName,
          variantLabel: item.variantLabel,
        }))}
        accountUrl="https://shop.test/en/account/reviews"
      />,
    );
    expect(html).toContain('https://shop.test/en/account/reviews');
    expect(html).not.toContain('/danh-gia/');
    expect(toPlainText(html)).toContain('Write a review');
  });
});
