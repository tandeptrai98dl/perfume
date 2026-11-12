import { render, toPlainText } from 'react-email';
import { describe, expect, it } from 'vitest';

import { PrivacyEmail, privacyEmailSubject, type PrivacyEmailKind } from './privacy-email';

const KINDS: PrivacyEmailKind[] = ['verify', 'received', 'exportReady', 'completed', 'rejected'];

async function text(element: React.ReactElement) {
  return toPlainText(await render(element)).replace(/ /g, ' ');
}

describe('privacy e-mails', () => {
  it.each(['vi', 'en'] as const)('renders every kind in %s', async (locale) => {
    for (const kind of KINDS) {
      expect(privacyEmailSubject(locale, kind)).not.toBe('');
      const body = await text(
        <PrivacyEmail
          locale={locale}
          kind={kind}
          type="delete"
          url="https://shop.example/x"
          dueAt={new Date('2026-12-02T03:00:00Z')}
          note="note"
        />,
      );
      expect(body).toContain('https://shop.example/x');
    }
  });

  it('shows the legal due date and the link expiry in the reader’s language', async () => {
    const vi = await text(
      <PrivacyEmail
        locale="vi"
        kind="received"
        type="correct"
        dueAt={new Date('2026-11-22T03:00:00Z')}
      />,
    );
    expect(vi).toContain('Hạn xử lý theo quy định: 22 tháng 11, 2026');
    const en = await text(
      <PrivacyEmail
        locale="en"
        kind="exportReady"
        type="export"
        url="https://shop.example/api/privacy/export/1"
        expiresAt={new Date('2026-11-19T03:00:00Z')}
      />,
    );
    expect(en).toContain('YOUR DATA IS READY');
    expect(en).toContain('November 19, 2026');
  });
});
