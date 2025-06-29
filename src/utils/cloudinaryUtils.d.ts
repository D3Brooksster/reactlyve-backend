// src/utils/cloudinaryUtils.d.ts
import { Buffer } from 'buffer';

export declare function extractPublicIdAndResourceType(cloudinaryUrl: string): { public_id: string; resource_type: 'image' | 'video' | 'raw' } | null;

export declare function deleteFromCloudinary(cloudinaryUrl: string): Promise<any>;

export declare function uploadVideoToCloudinary(
  buffer: Buffer,
  fileSize: number,
  folder?: string,
  options?: Record<string, any>
): Promise<{ secure_url: string; thumbnail_url: string; duration: number; moderation?: any }>;

export declare function uploadToCloudinarymedia(
  buffer: Buffer,
  resourceType: 'image' | 'video',
  options?: Record<string, any>
): Promise<{ secure_url: string; moderation?: any }>;

export declare function deleteMultipleFromCloudinary(
  publicIds: string[],
  resourceType?: 'image' | 'video' | 'raw'
): Promise<any>;

export declare const NEW_WORKING_OVERLAY_PARAMS: string;
export declare const SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING: string;
export declare const LARGE_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING: string;
export declare const IMAGE_OVERLAY_TRANSFORMATION_STRING: string;
export declare const OVERLAY_PUBLIC_ID: string;
/**
 * Overlay width as a fraction of the base asset's width. Derived from the
 * `CLOUDINARY_OVERLAY_WIDTH_PERCENT` environment variable. Defaults to `0.3`.
 */
export declare const OVERLAY_WIDTH_PERCENT: string;

export declare function generateDownloadUrl(cloudinaryUrl: string, filename: string): string;
