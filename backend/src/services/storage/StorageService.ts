/**
 * StorageService — the ONLY thing business logic is allowed to call for
 * uploading/deleting product images. No feature code may import the
 * Cloudinary SDK directly. Wired for real in Stage 4.
 */

export interface UploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
}

export interface StorageProviderAdapter {
  upload(fileBuffer: Buffer, options?: { folder?: string }): Promise<UploadResult>;
  delete(publicId: string): Promise<void>;
}

export class StorageService {
  constructor(private readonly adapter: StorageProviderAdapter) {}

  upload(fileBuffer: Buffer, options?: { folder?: string }) {
    return this.adapter.upload(fileBuffer, options);
  }

  delete(publicId: string) {
    return this.adapter.delete(publicId);
  }
}
