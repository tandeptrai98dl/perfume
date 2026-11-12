import { render, toPlainText } from 'react-email';
import { describe, expect, it } from 'vitest';

import { NewsletterEmail, newsletterEmailSubject } from './newsletter-email';

async function text(element: React.ReactElement) {
  return toPlainText(await render(element)).replace(/ /g, ' ');
}

describe('newsletter e-mails', () => {
  it.each(['vi', 'en'] as const)('renders the confirmation in %s with the link', async (locale) => {
    expect(newsletterEmailSubject(locale, 'confirm')).not.toBe('');
    const body = await text(
      <NewsletterEmail locale={locale} kind="confirm" url="https://shop.example/confirm?token=x" />,
    );
    expect(body).toContain('https://shop.example/confirm?token=x');
    expect(body).toContain(locale === 'vi' ? '72 giờ' : '72 hours');
  });

  it.each(['vi', 'en'] as const)(
    'renders the welcome in %s with an unsubscribe link',
    async (locale) => {
      expect(newsletterEmailSubject(locale, 'welcome')).not.toBe('');
      const html = await render(
        <NewsletterEmail
          locale={locale}
          kind="welcome"
          url="https://shop.example/perfumes"
          unsubscribeUrl="https://shop.example/newsletter/unsubscribe?s=1&t=2"
        />,
      );
      expect(html).toContain('href="https://shop.example/newsletter/unsubscribe?s=1&amp;t=2"');
      expect(toPlainText(html)).toContain(locale === 'vi' ? 'Hủy đăng ký' : 'Unsubscribe');
    },
  );
});
