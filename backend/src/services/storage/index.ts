import { StorageService } from "./StorageService.js";
import { CloudinaryAdapter } from "./CloudinaryAdapter.js";
import { DatabaseStorageAdapter } from "./DatabaseStorageAdapter.js";

// Single wiring point, same pattern as services/email/index.ts — every
// route imports `storageService` from here, never StorageService/an
// adapter directly. Cloudinary when its keys are set; otherwise photos are
// kept in the database and served from /media/<id>.
export const usingCloudinary = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
export const storageService = new StorageService(usingCloudinary ? new CloudinaryAdapter() : new DatabaseStorageAdapter());
