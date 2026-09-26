import { z } from 'zod';

const trimmed = (minimum, maximum, label) => z
  .string()
  .trim()
  .min(minimum, `${label} is required`)
  .max(maximum, `${label} is too long`);

export const registerSchema = z.object({
  name: trimmed(1, 100, 'Name'),
  email: z.email('Email must be valid').max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password is too long'),
}).strict();

export const loginSchema = z.object({
  email: z.email('Email must be valid').max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Password is required').max(72, 'Password is too long'),
}).strict();

export const projectSchema = z.object({
  name: trimmed(1, 120, 'Project name'),
}).strict();

export const uploadUrlSchema = z.object({
  fileName: trimmed(1, 255, 'File name'),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp'], {
    error: 'contentType must be image/jpeg, image/png, or image/webp',
  }),
}).strict();

export const roomSchema = z.object({
  projectId: z.string().regex(/^project_[a-f0-9]{32}$/, 'projectId is invalid'),
  name: trimmed(1, 120, 'Room name'),
  roomType: z.string().trim().regex(/^[a-z][a-z0-9_]{0,59}$/, 'roomType is invalid'),
  originalImageKey: z.string().min(1).max(1024),
  originalImageUrl: z.url().nullish(),
}).strict();

export function createDesignSchema(maxVariants) {
  return z.object({
    roomId: z.string().regex(/^room_[a-f0-9]{32}$/, 'roomId is invalid'),
    style: trimmed(1, 100, 'Style'),
    palette: z.array(trimmed(1, 60, 'Palette item')).max(12).default([]),
    preserve: z.array(trimmed(1, 100, 'Preserve item')).max(20).default([]),
    instructions: trimmed(1, 2000, 'Instructions'),
    variants: z.number().int().min(1).max(maxVariants),
    quality: z.enum(['preview', 'final']).default('preview'),
  }).strict();
}

export const designIdSchema = z.object({
  id: z.string().regex(/^job_[a-f0-9]{32}$/, 'Design job id is invalid'),
});
