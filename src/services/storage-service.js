import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { badRequest } from '../lib/errors.js';
import { createId } from '../lib/ids.js';

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function encodeKey(key) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export class StorageService {
  constructor(config, client) {
    this.config = config.r2;
    this.client = client || new S3Client({
      region: 'auto',
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      // Avoid presigning the checksum of an empty body for browser/mobile PUTs.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  publicUrl(key) {
    if (!this.config.publicBaseUrl) return undefined;
    return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${encodeKey(key)}`;
  }

  async getReadUrl(key) {
    return this.publicUrl(key) || getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: this.config.readTtlSeconds },
    );
  }

  async createRoomUpload(userId, { contentType }) {
    const roomId = createId('room');
    const imageKey = `rooms/${userId}/${roomId}/original.${EXTENSIONS[contentType]}`;
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: imageKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.config.uploadTtlSeconds,
      signableHeaders: new Set(['content-type']),
    });
    return {
      uploadUrl,
      imageKey,
      ...(this.publicUrl(imageKey) ? { imageUrl: this.publicUrl(imageKey) } : {}),
    };
  }

  async assertUploaded(key) {
    if (!this.config.verifyUploads) return;
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));
      if (!Object.hasOwn(EXTENSIONS, result.ContentType)) {
        throw badRequest('Uploaded object is not a supported image');
      }
      if (Number(result.ContentLength || 0) > this.config.maxRoomImageBytes) {
        throw badRequest(`Room image must not exceed ${this.config.maxRoomImageBytes} bytes`);
      }
    } catch (error) {
      if (error.statusCode) throw error;
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw badRequest('The room image upload was not found or has not completed');
      }
      throw error;
    }
  }

  async getImage(key) {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }));
    if (!result.Body) throw new Error(`R2 object ${key} has no body`);
    return {
      buffer: Buffer.from(await result.Body.transformToByteArray()),
      contentType: result.ContentType || 'image/jpeg',
    };
  }

  async putDesign(key, buffer, contentType = 'image/jpeg') {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    return this.publicUrl(key);
  }
}

export function roomIdFromImageKey(userId, imageKey) {
  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = imageKey.match(new RegExp(`^rooms/${escapedUserId}/(room_[a-f0-9]{32})/original\\.(jpg|png|webp)$`));
  return match?.[1];
}
