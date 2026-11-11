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
    async send({ to, subject, template }) {
      const html = await render(template);
      const info = await transport.sendMail({
        from: options.from,
        to,
        subject,
        html,
        text: toPlainText(html),
      });
      return { messageId: String(info.messageId) };
    },
    close() {
      transport.close();
    },
  };
}
