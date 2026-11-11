import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { assertSafeKey, IMMUTABLE_CACHE_CONTROL, type StorageAdapter } from './types';

export type S3StorageConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint for MinIO or an S3-compatible provider; omit for AWS. */
  endpoint?: string;
  /** Path-style URLs (`endpoint/bucket/key`), needed by MinIO and many providers. */
  forcePathStyle?: boolean;
};

/** S3-compatible adapter (AWS SDK v3). Objects are public-read through the bucket policy/CDN. */
export function createS3Storage(config: S3StorageConfig, client?: S3Client): StorageAdapter {
  const s3 =
    client ??
    new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Many S3-compatible providers do not support the newer default checksums.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

  return {
    kind: 's3',
    async put(key, body, options) {
      assertSafeKey(key);
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          ContentLength: body.length,
          CacheControl: options.cacheControl ?? IMMUTABLE_CACHE_CONTROL,
        }),
      );
    },
    async get(key) {
      assertSafeKey(key);
      try {
        const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (!result.Body) return null;
        const bytes = await result.Body.transformToByteArray();
        return {
          body: Buffer.from(bytes),
          contentType: result.ContentType ?? 'application/octet-stream',
        };
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async delete(key) {
      assertSafeKey(key);
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}
