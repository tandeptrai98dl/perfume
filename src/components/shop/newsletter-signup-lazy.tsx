'use client';

import dynamic from 'next/dynamic';

/**
 * The newsletter form sits in the footer of every page, below the fold. It is server-rendered
 * as usual (no layout shift) but its JavaScript (form state, Turnstile, the Server Action
 * client) is a separate chunk outside the first-load budget (ARCHITECTURE.md §14.1, ADR-0026).
 */
export const NewsletterSignup = dynamic(() =>
  import('./newsletter-signup').then((module) => module.NewsletterSignup),
);
