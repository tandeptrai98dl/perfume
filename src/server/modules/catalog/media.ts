import { eq } from 'drizzle-orm';

import { mediaUrl } from '@/lib/media-url';
import { toSlug } from '@/lib/slug';
import { media, mediaTranslations } from '@/server/db/schema';
import type { StorageAdapter } from '@/server/integrations/storage';
import { IMMUTABLE_CACHE_CONTROL } from '@/server/integrations/storage';
import { recordAudit } from '@/server/lib/audit';
import { can, DomainError, type CommandContext } from '@/server/lib/command-context';
import { newId } from '@/server/lib/ids';
import { logger } from '@/server/lib/logger';

import { processImage, UploadValidationError } from './media-processing';

export type MediaContext = Omit<CommandContext, 'boss'> & { storage: StorageAdapter | null };

export type UploadedMedia = {
  id: string;
  storageKey: string;
  url: string;
  width: number;
  height: number;
  mime: string;
  sizeBytes: number;
  blurDataUrl: string;
};

/**
 * Meaningful, unique object names (SEO §13.1, CDN cache 1 year §14.1):
 * `media/2026/11/maison-lumiere-cedre-0192f3a4b5c6.webp`.
 */
export function mediaStorageKey(fileName: string, id: string, now = new Date()): string {
  const base = toSlug(fileName.replace(/\.[^.]*$/, '')).slice(0, 60) || 'image';
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `media/${now.getUTCFullYear()}/${month}/${base}-${id.replace(/-/g, '').slice(-12)}.webp`;
}

/**
 * Validates, re-encodes and stores an image, then records it in `media` (+ the Vietnamese
 * alt text when given). Media rows are shared by products, brands, collections and CMS
 * content, so either catalogue or content editors may upload.
 */
export async function uploadMedia(
  ctx: MediaContext,
  input: { buffer: Buffer; fileName: string; altVi?: string | null },
): Promise<UploadedMedia> {
  if (!can(ctx.actor, 'products.editContent') && !can(ctx.actor, 'content.manage')) {
    throw new DomainError('forbidden');
  }
  if (!ctx.storage) throw new DomainError('storageNotConfigured');

  let processed;
  try {
    processed = await processImage(input.buffer);
  } catch (error) {
    if (error instanceof UploadValidationError) {
      throw new DomainError('invalid', [{ path: 'file', code: error.issue }]);
    }
    throw error;
  }

  const id = newId();
  const storageKey = mediaStorageKey(input.fileName, id);
  await ctx.storage.put(storageKey, processed.body, {
    contentType: processed.mime,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
  });

  const row = {
    id,
    storageKey,
    url: mediaUrl(storageKey),
    width: processed.width,
    height: processed.height,
    mime: processed.mime,
    sizeBytes: processed.sizeBytes,
    blurDataUrl: processed.blurDataUrl,
  };
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(media).values(row);
      const alt = input.altVi?.trim();
      if (alt) await tx.insert(mediaTranslations).values({ mediaId: id, locale: 'vi', alt });
      await recordAudit(tx, {
        actorId: ctx.actor.id,
        action: 'media.upload',
        entityType: 'media',
        entityId: id,
        diff: {
          storageKey: { from: null, to: storageKey },
          sourceMime: { from: null, to: processed.sourceMime },
          sizeBytes: { from: input.buffer.length, to: processed.sizeBytes },
        },
        ip: ctx.ip,
      });
    });
  } catch (error) {
    // Do not leave an orphaned object behind when the row could not be written.
    await ctx.storage
      .delete(storageKey)
      .catch((cleanupError: unknown) =>
        logger.warn('media.cleanup_failed', { storageKey, error: String(cleanupError) }),
      );
    throw error;
  }
  return row;
}

export async function mediaExists(ctx: Pick<CommandContext, 'db'>, id: string): Promise<boolean> {
  const rows = await ctx.db.select({ id: media.id }).from(media).where(eq(media.id, id));
  return rows.length > 0;
}
