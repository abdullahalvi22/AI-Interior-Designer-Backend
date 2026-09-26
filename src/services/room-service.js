import { badRequest, notFound } from '../lib/errors.js';
import { withTransaction } from '../db/pool.js';
import { roomIdFromImageKey } from './storage-service.js';

export class RoomService {
  constructor(pool, storage) {
    this.pool = pool;
    this.storage = storage;
  }

  createUploadUrl(userId, input) {
    return this.storage.createRoomUpload(userId, input);
  }

  async create(userId, input) {
    const roomId = roomIdFromImageKey(userId, input.originalImageKey);
    if (!roomId) throw badRequest('originalImageKey is not a valid upload key for this user');

    await this.storage.assertUploaded(input.originalImageKey);
    const canonicalUrl = this.storage.publicUrl(input.originalImageKey) || null;
    const row = await withTransaction(this.pool, async (client) => {
      const project = await client.query(
        'SELECT id FROM projects WHERE id = ? AND user_id = ?',
        [input.projectId, userId],
      );
      if (!project.rowCount) throw notFound('Project not found');

      await client.query(
        `INSERT INTO rooms(
           id, user_id, project_id, name, room_type, original_image_key, original_image_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [roomId, userId, input.projectId, input.name, input.roomType, input.originalImageKey, canonicalUrl],
      );
      const existing = await client.query(
        `SELECT id, user_id, project_id, name, room_type, original_image_key, original_image_url
         FROM rooms WHERE original_image_key = ? FOR UPDATE`,
        [input.originalImageKey],
      );
      const saved = existing.rows[0];
      if (!saved || saved.user_id !== userId || saved.project_id !== input.projectId) {
        throw badRequest('This uploaded image is already attached to another room');
      }
      await client.query(
        `UPDATE rooms SET name = ?, room_type = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [input.name, input.roomType, saved.id],
      );
      return { ...saved, name: input.name, room_type: input.roomType };
    });
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      roomType: row.room_type,
      originalImageKey: row.original_image_key,
      originalImageUrl: row.original_image_url || await this.storage.getReadUrl(row.original_image_key),
    };
  }
}
