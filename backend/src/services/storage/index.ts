import { StorageService } from "./StorageService.js";
import { CloudinaryAdapter } from "./CloudinaryAdapter.js";

// Single wiring point, same pattern as services/email/index.ts — every
// route imports `storageService` from here, never StorageService/an
// adapter directly.
export const storageService = new StorageService(new CloudinaryAdapter());
