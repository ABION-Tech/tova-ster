import { pool } from "../../db/pool.js";
import type { StorageProviderAdapter, UploadResult } from "./StorageService.js";
import { ValidationError } from "../../products/productRepo.js";

/**
 * Keeps uploaded photos in Postgres and serves them from /media/<id>.
 * Used when Cloudinary isn't configured, so the team can add and change
 * product photos from day one. Only real images are accepted (checked by
 * their first bytes, not the file name), up to 5 MB each.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function sniffImage(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (b.length > 6 && (b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  return null;
}

const base = () => (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, "");

export class DatabaseStorageAdapter implements StorageProviderAdapter {
  async upload(fileBuffer: Buffer, options?: { folder?: string }): Promise<UploadResult> {
    const type = sniffImage(fileBuffer);
    if (!type) throw new ValidationError("That file isn't a JPG, PNG, WebP or GIF image.");
    if (fileBuffer.length > MAX_IMAGE_BYTES) throw new ValidationError("That photo is over 5 MB. Please make it smaller and try again.");
    const r = await pool.query<{ id: string }>(
      `INSERT INTO media (content_type, bytes, size, folder) VALUES ($1, $2, $3, $4) RETURNING id`,
      [type, fileBuffer, fileBuffer.length, options?.folder ?? null]);
    const id = r.rows[0]!.id;
    return { url: `${base()}/media/${id}`, publicId: `media:${id}` };
  }

  async delete(publicId: string): Promise<void> {
    const id = publicId.replace(/^media:/, "");
    if (/^[0-9a-f-]{36}$/.test(id)) await pool.query(`DELETE FROM media WHERE id = $1`, [id]);
  }
}
