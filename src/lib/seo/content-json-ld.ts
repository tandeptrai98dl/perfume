import type { FaqEntry } from '@/lib/rich-text';

/** JSON-LD for content pages (§13.1): Article for journal posts, FAQPage for the FAQ. */

export function articleJsonLd(args: {
  url: string;
  headline: string;
  description: string;
  datePublished: Date;
  dateModified: Date;
  inLanguage: string;
  siteName: string;
  siteUrl: string;
  authorName?: string | null;
  image?: string | null;
}) {
  const publisher = { '@type': 'Organization', name: args.siteName, url: args.siteUrl };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: args.headline.slice(0, 110),
    description: args.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': args.url },
    url: args.url,
    inLanguage: args.inLanguage,
    datePublished: args.datePublished.toISOString(),
    dateModified: args.dateModified.toISOString(),
    author: args.authorName ? { '@type': 'Person', name: args.authorName } : publisher,
    publisher,
    ...(args.image ? { image: [args.image] } : {}),
  };
}

export function faqPageJsonLd(args: { url: string; inLanguage: string; entries: FaqEntry[] }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: args.url,
    inLanguage: args.inLanguage,
    mainEntity: args.entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}

/** Script-safe JSON: "<" is escaped so the payload cannot close the script element. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029');
}
