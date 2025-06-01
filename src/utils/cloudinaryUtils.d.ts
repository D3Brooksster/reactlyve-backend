// src/utils/cloudinaryUtils.d.ts
import { Buffer } from 'buffer';

export declare function extractPublicIdAndResourceType(cloudinaryUrl: string): { public_id: string; resource_type: 'image' | 'video' | 'raw' } | null;

export declare function deleteFromCloudinary(cloudinaryUrl: string): Promise<any>;

export declare function uploadVideoToCloudinary(
  buffer: Buffer,
  fileSize: number,
  folder?: string
): Promise<{ secure_url: string; thumbnail_url: string; duration: number }>;

export declare function uploadToCloudinarymedia(
  buffer: Buffer,
  resourceType: 'image' | 'video'
): Promise<string>;

export declare function deleteMultipleFromCloudinary(
  publicIds: string[],
  resourceType?: 'image' | 'video' | 'raw'
): Promise<any>;
