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

export function createEmailSender(
  options: { smtpUrl: string; from: string } | { transport: Transporter; from: string },
): EmailSender {
  const transport =
    'transport' in options ? options.transport : nodemailer.createTransport(options.smtpUrl);
  return {
    async send({ to, subject, template, headers }) {
      const html = await render(template);
      const info = await transport.sendMail({
        from: options.from,
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
