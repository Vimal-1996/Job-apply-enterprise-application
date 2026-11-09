import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectTaggingCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const RESUME_FILES = Symbol('RESUME_FILES');

export const UPLOAD_LINK_SECONDS = 300;
export const DOWNLOAD_LINK_SECONDS = 60;

/** Uploads arrive tagged pending; a bucket rule deletes pending files after a day. */
const PENDING_TAGGING = '<Tagging><TagSet><Tag><Key>status</Key><Value>pending</Value></Tag></TagSet></Tagging>';

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  expiresInSeconds: number;
}

/** Everything the app does with stored resume files. The only code that talks to S3. */
export interface ResumeFiles {
  /** A browser upload limited to exactly this key, a size range and this content type. */
  presignUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;
  /** Size of the stored object, or null if it isn't there. */
  head(key: string): Promise<{ size: number } | null>;
  /** The first `bytes` bytes, to check what the file really is. */
  readStart(key: string, bytes: number): Promise<Buffer>;
  /** The whole file (resumes are at most a few MB). */
  read(key: string): Promise<Buffer>;
  /** Marks a verified file so the abandoned-upload rule leaves it alone. */
  markReady(key: string): Promise<void>;
  /** A short-lived link that downloads the file as an attachment under `fileName`. */
  presignDownload(key: string, fileName: string, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  /** Removes every file belonging to a user. */
  deleteAllForUser(userId: string): Promise<void>;
}

export function userPrefix(userId: string): string {
  return `users/${userId}/`;
}

/** RFC 6266 attachment header that keeps non-ASCII names intact. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

type Sender = Pick<S3Client, 'send'>;

export class S3ResumeFiles implements ResumeFiles {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async presignUpload(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload> {
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Fields: { 'Content-Type': contentType, tagging: PENDING_TAGGING },
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', contentType],
        ['eq', '$tagging', PENDING_TAGGING],
      ],
      Expires: UPLOAD_LINK_SECONDS,
    });
    return { url, fields, expiresInSeconds: UPLOAD_LINK_SECONDS };
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await (this.client as Sender).send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  }

  async readStart(key: string, bytes: number): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async markReady(key: string): Promise<void> {
    await this.client.send(
      new PutObjectTaggingCommand({ Bucket: this.bucket, Key: key, Tagging: { TagSet: [{ Key: 'status', Value: 'ready' }] } }),
    );
  }

  presignDownload(key: string, fileName: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: attachmentDisposition(fileName),
        ResponseContentType: contentType,
      }),
      { expiresIn: DOWNLOAD_LINK_SECONDS },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: userPrefix(userId), ContinuationToken: token }),
      );
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
      token = page.NextContinuationToken;
    } while (token);
  }
}
