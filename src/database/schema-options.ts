import type { SchemaOptions } from 'mongoose';

/**
 * Shared Mongoose options: snake_case timestamps, no __v, and API-shaped JSON
 * (`_id` exposed as `id`).
 */
export function schemaOptions(collection: string, timestamps = true): SchemaOptions {
  return {
    collection,
    versionKey: false,
    timestamps: timestamps ? { createdAt: 'created_at', updatedAt: 'updated_at' } : false,
  };
}
