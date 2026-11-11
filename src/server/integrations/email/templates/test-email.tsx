import { Body, Container, Head, Heading, Html, Preview, Text } from 'react-email';

export type TestEmailProps = {
  locale: 'vi' | 'en';
  heading: string;
  body: string;
};

/** Smoke-test email sent from the outbox spike (M0 exit criterion). */
export function TestEmail({ locale, heading, body }: TestEmailProps) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{heading}</Preview>
      <Body>
        <Container>
          <Heading as="h1">{heading}</Heading>
          <Text>{body}</Text>
        </Container>
      </Body>
    </Html>
  );
}
