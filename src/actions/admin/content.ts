'use server';

import 'server-only';

import { updateTag } from 'next/cache';
import { z } from 'zod';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getClientIp } from '@/server/request-ip';
import { getProducer } from '@/server/jobs/producer';
import { errorFields, logger } from '@/server/lib/logger';
import { contentTags } from '@/server/modules/catalog/cache-tags';
import {
  bannerInputSchema,
  ContentError,
  createRedirectCommand,
  deleteBanner,
  deletePage,
  deletePost,
  deleteRedirect,
  deleteTopic,
  invalidateRouteTable,
  menuInputSchema,
  pageInputSchema,
  postInputSchema,
  redirectInputSchema,
  saveBanner,
  saveMenu,
  savePage,
  savePost,
  saveTopic,
  topicInputSchema,
  type Actor,
  type CommandResult,
  type ContentDeps,
} from '@/server/modules/content';

/**
 * Admin content Server Actions (thin: validate → authorize → module command → expire tags).
 * Error values are stable codes; the UI maps them to `admin.content.errors.<code>`.
 */

export type ActionResult =
  { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const idInput = z.uuid();

async function actorFrom(userId: string): Promise<Actor> {
  return { id: userId, ip: await getClientIp() };
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    out[path] ??= /^[a-z_]+$/.test(issue.message) ? issue.message : 'invalid';
  }
  return out;
}

/**
 * Shared pipeline: Zod validation, then `content.manage` (2FA-verified staff), then the
 * command; on success the touched cache tags expire immediately (read-your-own-writes).
 */
async function run<S extends z.ZodType>(
  schema: S,
  input: unknown,
  command: (deps: ContentDeps, actor: Actor, data: z.output<S>) => Promise<CommandResult>,
): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: fieldErrors(parsed.error) };
  }
  try {
    const session = await requirePermission('content.manage');
    const deps = { db: getDb(), boss: await getProducer() };
    const result = await command(deps, await actorFrom(session.user.id), parsed.data);
    for (const tag of result.tags) updateTag(tag);
    if (result.tags.includes(contentTags.redirects)) invalidateRouteTable();
    return { ok: true, id: result.id };
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: 'forbidden' };
    if (error instanceof ContentError) {
      return {
        ok: false,
        error: error.code,
        ...(error.field ? { fieldErrors: { [error.field]: error.code } } : {}),
      };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, error: 'validation', fieldErrors: fieldErrors(error) };
    }
    logger.error('admin.content.action.failed', errorFields(error));
    return { ok: false, error: 'unexpected' };
  }
}

export async function savePageAction(input: unknown) {
  return run(pageInputSchema, input, savePage);
}

export async function deletePageAction(id: unknown) {
  return run(idInput, id, deletePage);
}

export async function savePostAction(input: unknown) {
  return run(postInputSchema, input, savePost);
}

export async function deletePostAction(id: unknown) {
  return run(idInput, id, deletePost);
}

export async function saveTopicAction(input: unknown) {
  return run(topicInputSchema, input, saveTopic);
}

export async function deleteTopicAction(id: unknown) {
  return run(idInput, id, deleteTopic);
}

export async function saveBannerAction(input: unknown) {
  return run(bannerInputSchema, input, saveBanner);
}

export async function deleteBannerAction(id: unknown) {
  return run(idInput, id, deleteBanner);
}

export async function saveMenuAction(input: unknown) {
  return run(menuInputSchema, input, saveMenu);
}

export async function createRedirectAction(input: unknown) {
  return run(redirectInputSchema, input, createRedirectCommand);
}

export async function deleteRedirectAction(id: unknown) {
  return run(idInput, id, deleteRedirect);
}
