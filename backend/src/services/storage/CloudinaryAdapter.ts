import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import type { StorageProviderAdapter, UploadResult } from "./StorageService.js";

let configured = false;

/**
 * Lazy, not module-load-time: throwing here would crash the whole server
 * at startup (including /health) the moment Cloudinary env vars are
 * unset — e.g. a fresh environment before secrets are filled in. Instead
 * only an actual upload/delete call fails, with a clear message pointing
 * at exactly which var is missing.
 */
function ensureConfigured(): void {
  if (configured) return;

  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;

  const missing = [
    !cloud_name && "CLOUDINARY_CLOUD_NAME",
    !api_key && "CLOUDINARY_API_KEY",
    !api_secret && "CLOUDINARY_API_SECRET",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`CloudinaryAdapter: missing env var(s): ${missing.join(", ")}`);
  }

  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  configured = true;
}

/**
 * Only this file may import the `cloudinary` SDK. Everything else —
 * product image uploads today, any future StorageService consumer later —
 * calls `StorageService.upload()`/`.delete()` and never sees a vendor type.
 */
export class CloudinaryAdapter implements StorageProviderAdapter {
  async upload(fileBuffer: Buffer, options?: { folder?: string }): Promise<UploadResult> {
    ensureConfigured();

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: options?.folder ?? "wellness-ecom", resource_type: "image" },
        (err, res) => {
          if (err || !res) return reject(err ?? new Error("Cloudinary upload returned no result."));
          resolve(res);
        },
      );
      stream.end(fileBuffer);
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
    };
  }

  async delete(publicId: string): Promise<void> {
    ensureConfigured();
    await cloudinary.uploader.destroy(publicId);
  }
}

