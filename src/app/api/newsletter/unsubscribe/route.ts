import { serverEnv } from '@/lib/env';
import { getDb } from '@/server/db/client';
import { errorFields, logger } from '@/server/lib/logger';
import { newsletterUnsubscribeSchema, unsubscribeNewsletter } from '@/server/modules/customer';
import { guardRequest } from '@/server/request-guard';
import { getClientIp } from '@/server/request-ip';

/**
 * RFC 8058 one-click unsubscribe (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`), called
 * by mail clients with POST to the URL of the `List-Unsubscribe` header. The signed
 * `?s=<subscriber>&t=<signature>` is the authorisation (no session, no staff permission).
 * Answers 200 for any valid signature, already unsubscribed or not.
 */

const ONE_CLICK_RULE = { limit: 30, windowMs: 10 * 60_000 };
const noStore = { 'cache-control': 'no-store' };

export async function POST(request: Request) {
  const url = new URL(request.url);
  const query = newsletterUnsubscribeSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return new Response(null, { status: 400, headers: noStore });

  if (!(await guardRequest({ scope: 'newsletterOneClick', rule: ONE_CLICK_RULE })).ok) {
    return new Response(null, { status: 429, headers: { ...noStore, 'retry-after': '600' } });
  }

  try {
    const done = await unsubscribeNewsletter(getDb(), {
      ...query.data,
      secret: serverEnv().BETTER_AUTH_SECRET,
      context: { ip: await getClientIp(), userAgent: request.headers.get('user-agent') },
      source: 'newsletter_one_click',
    });
    return new Response(null, { status: done ? 200 : 400, headers: noStore });
  } catch (error) {
    logger.error('newsletter.one_click_failed', errorFields(error));
    return new Response(null, { status: 500, headers: noStore });
  }
}
