/**
 * S3 storage helpers.
 * Replaces the Manus Forge storage proxy with direct AWS S3 access.
 */

import { ENV } from "./_core/env";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    if (!ENV.awsS3Bucket) {
      throw new Error(
        "S3 credentials missing: set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET"
      );
    }
    _s3 = new S3Client({
      region: ENV.awsRegion,
      credentials:
        ENV.awsAccessKeyId && ENV.awsSecretAccessKey
          ? {
              accessKeyId: ENV.awsAccessKeyId,
              secretAccessKey: ENV.awsSecretAccessKey,
            }
          : undefined, // falls back to default credential chain (e.g. IAM role on Railway/AWS)
    });
  }
  return _s3;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Upload a file to S3.
 * Returns the object key and a presigned download URL.
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);

  const body =
    typeof data === "string" ? Buffer.from(data, "utf-8") : data;

  await s3.send(
    new PutObjectCommand({
      Bucket: ENV.awsS3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  // Generate a presigned download URL (valid 7 days)
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: ENV.awsS3Bucket, Key: key }),
    { expiresIn: 604800 }
  );

  return { key, url };
}

/**
 * Get a presigned download URL for an existing S3 object.
 */
export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const s3 = getS3();
  const key = normalizeKey(relKey);

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: ENV.awsS3Bucket, Key: key }),
    { expiresIn: 604800 }
  );

  return { key, url };
}
