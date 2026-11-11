// vi.json is the superset: it also holds the Vietnamese-only "admin" namespace.
import type messages from '../messages/vi.json';
import type { formats } from './i18n/formats';
import type { routing } from './i18n/routing';

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
    Formats: typeof formats;
  }
}
