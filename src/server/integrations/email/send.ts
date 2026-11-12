import nodemailer, { type Transporter } from 'nodemailer';
import type { ReactElement } from 'react';
import { render, toPlainText } from 'react-email';

/**
 * Email adapter (ARCHITECTURE.md §9 integrations). Templates are React Email components;
 * this module renders them to HTML + plain text and sends them over SMTP.
 * Only the worker sends email (via outbox jobs), never a request handler.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  template: ReactElement;
  /** Extra headers, e.g. `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058). */
  headers?: Record<string, string>;
};

export type EmailSender = {
  send(message: EmailMessage): Promise<{ messageId: string }>;
  close(): void;
};

/** `from` may be resolved per message (admin → Settings → sender, cached by the caller). */
type From = string | (() => Promise<string>);

export function createEmailSender(
  options: { smtpUrl: string; from: From } | { transport: Transporter; from: From },
): EmailSender {
  const transport =
    'transport' in options ? options.transport : nodemailer.createTransport(options.smtpUrl);
  return {
    async send({ to, subject, template, headers }) {
      const html = await render(template);
      const from = typeof options.from === 'function' ? await options.from() : options.from;
      const info = await transport.sendMail({
        from,
        to,
        subject,
        html,
        text: toPlainText(html),
        ...(headers ? { headers } : {}),
      });
      return { messageId: String(info.messageId) };
    },
    close() {
      transport.close();
    },
  };
}
