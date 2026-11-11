import { Body, Container, Head, Heading, Html, Link, Preview, Text } from 'react-email';

import { textStyle } from './layout';
import { emailTheme as theme } from './theme';

/** Internal alert (ADR-0019), Vietnamese like the admin UI. Same no-PII text as Telegram. */
export function StaffAlertEmail({
  heading,
  title,
  lines,
  adminUrl,
  adminLabel,
}: {
  heading: string;
  title: string;
  lines: string[];
  adminUrl: string;
  adminLabel: string;
}) {
  return (
    <Html lang="vi">
      <Head />
      <Preview>{title}</Preview>
      <Body style={{ backgroundColor: theme.color.white, fontFamily: theme.font.sans }}>
        <Container style={{ maxWidth: `${theme.containerWidth}px`, padding: '24px' }}>
          <Text style={{ ...textStyle, color: theme.color.taupe600 }}>{heading}</Text>
          <Heading
            as="h1"
            style={{
              fontSize: `${theme.size.h3}px`,
              margin: '0 0 16px',
              color: theme.color.ink950,
            }}
          >
            {title}
          </Heading>
          {lines.map((line, index) => (
            <Text key={index} style={textStyle}>
              {line}
            </Text>
          ))}
          <Link href={adminUrl} style={{ color: theme.color.gold700 }}>
            {adminLabel}
          </Link>
        </Container>
      </Body>
    </Html>
  );
}
