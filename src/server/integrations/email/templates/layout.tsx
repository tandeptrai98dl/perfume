import type { CSSProperties, ReactNode } from 'react';
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email';

import { emailTheme as theme } from './theme';

/** Branded frame shared by every customer e-mail: ivory page, ink text, gold rule (§7). */

const styles = {
  body: {
    margin: 0,
    padding: '32px 0',
    backgroundColor: theme.color.ivory50,
    color: theme.color.ink950,
    fontFamily: theme.font.sans,
  },
  container: {
    maxWidth: `${theme.containerWidth}px`,
    margin: '0 auto',
    backgroundColor: theme.color.white,
    border: `1px solid ${theme.color.line200}`,
  },
  header: { padding: '32px 40px 0', textAlign: 'center' },
  brand: {
    margin: 0,
    fontFamily: theme.font.display,
    fontSize: '28px',
    lineHeight: '34px',
    letterSpacing: '0.04em',
    color: theme.color.ink950,
  },
  rule: { width: '48px', margin: '16px auto 0', borderTop: `1px solid ${theme.color.gold500}` },
  content: { padding: '24px 40px 32px' },
  heading: {
    margin: '0 0 16px',
    fontFamily: theme.font.display,
    fontWeight: 500,
    fontSize: `${theme.size.h1}px`,
    lineHeight: theme.lineHeight.h1,
    color: theme.color.ink950,
  },
  footer: { padding: '0 40px 32px' },
  footerText: {
    margin: '8px 0 0',
    fontSize: `${theme.size.small}px`,
    lineHeight: theme.lineHeight.small,
    color: theme.color.taupe600,
  },
} satisfies Record<string, CSSProperties>;

export const textStyle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: `${theme.size.body}px`,
  lineHeight: theme.lineHeight.body,
  color: theme.color.ink950,
};

export const mutedTextStyle: CSSProperties = {
  ...textStyle,
  fontSize: `${theme.size.small}px`,
  lineHeight: theme.lineHeight.small,
  color: theme.color.taupe600,
};

export const eyebrowStyle: CSSProperties = {
  margin: '24px 0 8px',
  fontSize: `${theme.size.eyebrow}px`,
  lineHeight: '16px',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  fontWeight: 500,
  color: theme.color.taupe600,
};

export function EmailLayout({
  locale,
  preview,
  heading,
  brand,
  tagline,
  footer,
  children,
}: {
  locale: 'vi' | 'en';
  preview: string;
  heading: string;
  brand: string;
  tagline: string;
  footer: string;
  children: ReactNode;
}) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.brand}>{brand}</Text>
            <Hr style={styles.rule} />
          </Section>
          <Section style={styles.content}>
            <Heading as="h1" style={styles.heading}>
              {heading}
            </Heading>
            {children}
          </Section>
          <Section style={styles.footer}>
            <Hr style={{ borderTop: `1px solid ${theme.color.line200}`, margin: '0 0 16px' }} />
            <Text style={styles.footerText}>{tagline}</Text>
            <Text style={styles.footerText}>{footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** Primary action: ink button, square corners, uppercase label (§7.2 `button`). */
export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: '8px 0 24px' }}>
      <Button
        href={href}
        style={{
          display: 'inline-block',
          padding: '14px 28px',
          backgroundColor: theme.color.ink950,
          color: theme.color.ivory50,
          borderRadius: theme.radius,
          fontSize: `${theme.size.button}px`,
          lineHeight: '16px',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/** Label / value line for totals and details. */
export function EmailRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  const cell: CSSProperties = {
    padding: '4px 0',
    fontSize: `${strong ? theme.size.body : theme.size.small}px`,
    lineHeight: theme.lineHeight.small,
    fontWeight: strong ? 600 : 400,
    color: strong ? theme.color.ink950 : theme.color.ink700,
  };
  return (
    <Row>
      <Column style={cell}>{label}</Column>
      <Column style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>{value}</Column>
    </Row>
  );
}
