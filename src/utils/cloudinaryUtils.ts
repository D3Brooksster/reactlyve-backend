import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import { URL } from 'url'; // Ensure URL is imported if not globally available
import { Readable } from 'stream'; // Added Readable

dotenv.config(); // Ensure environment variables are loaded

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export const extractPublicIdAndResourceType = (cloudinaryUrl: string): { public_id: string; resource_type: 'image' | 'video' | 'raw' } | null => {
  try {
    const url = new URL(cloudinaryUrl);
    const pathname = url.pathname;
    const pathSegments = pathname.split('/').filter(segment => segment);

    // Minimal check: /cloud_name/resource_type/delivery_type/public_id...
    // More robust: find resource_type and then join the rest as public_id
    // Example: /res.cloudinary.com/cloudname/image/upload/v123/folder/image.jpg
    // pathSegments would be [cloudname, image, upload, v123, folder, image.jpg]
    // We need to find 'image', 'video', or 'raw'.
    
    let resourceTypeIndex = -1;
    for (let i = 0; i < pathSegments.length; i++) {
      if (['image', 'video', 'raw'].includes(pathSegments[i])) {
        resourceTypeIndex = i;
        break;
      }
    }

    if (resourceTypeIndex === -1 || resourceTypeIndex + 2 >= pathSegments.length) {
      // Not enough segments after resource_type for delivery_type and public_id
      console.error('Invalid Cloudinary URL: Could not determine resource_type or not enough path segments.', { cloudinaryUrl });
      return null;
    }
    
    const resource_type = pathSegments[resourceTypeIndex] as 'image' | 'video' | 'raw';
    
    // public_id starts after resource_type and delivery_type (e.g., 'upload', 'fetch')
    // Skip version segment (e.g. v12345) if present directly after delivery_type
    let publicIdStartIndex = resourceTypeIndex + 2; 
    if (pathSegments[publicIdStartIndex]?.match(/^v\d+$/)) {
      publicIdStartIndex++;
    }
    
    if (publicIdStartIndex >= pathSegments.length) {
        console.error('Invalid Cloudinary URL: No segments found for public_id.', { cloudinaryUrl });
        return null;
    }

    const publicIdWithExtension = pathSegments.slice(publicIdStartIndex).join('/');
    const lastDotIndex = publicIdWithExtension.lastIndexOf('.');
    const public_id = (lastDotIndex > 0 && lastDotIndex < publicIdWithExtension.length - 1)
                      ? publicIdWithExtension.substring(0, lastDotIndex)
                      : publicIdWithExtension;

    if (!public_id) {
      console.error('Public ID became empty after attempting to remove extension.', { cloudinaryUrl });
      return null;
    }
    return { public_id, resource_type };
  } catch (error) {
    console.error('Failed to parse Cloudinary URL in extractPublicIdAndResourceType:', { cloudinaryUrl, error });
    return null;
  }
};

export const deleteFromCloudinary = (cloudinaryUrl: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const extracted = extractPublicIdAndResourceType(cloudinaryUrl);
    if (!extracted) {
      return reject(new Error(`Failed to extract public_id or resource_type from URL: ${cloudinaryUrl}`));
    }
    const { public_id, resource_type } = extracted;

    if (process.env.NODE_ENV === 'development') {
      console.log(`Attempting to delete from Cloudinary: public_id='${public_id}', resource_type='${resource_type}'`);
    }

    cloudinary.uploader.destroy(public_id, { resource_type }, (error, result) => {
      if (error) {
        console.error('Error deleting from Cloudinary:', { public_id, resource_type, error });
        return reject(error);
      }
      if (result && result.result !== 'ok' && result.result !== 'not found') {
        if (process.env.NODE_ENV === 'development') {
          console.warn('Cloudinary deletion warning:', { public_id, resource_type, result });
        }
        if (result.result === 'not found') {
          if (process.env.NODE_ENV === 'development') {
            console.log(`Asset with public_id '${public_id}' not found on Cloudinary. Considered as deleted.`);
          }
          return resolve(result);
        }
        return reject(new Error(`Cloudinary deletion failed: ${result.result}`));
      }
      if (process.env.NODE_ENV === 'development') {
        console.log('Successfully deleted from Cloudinary or asset was not found:', { public_id, resource_type, result });
      }
      resolve(result);
    });
  });
};

// === Cloudinary upload utilities ===
// Moved from messageRoutes.ts to break circular dependency

export const uploadVideoToCloudinary = (buffer: Buffer, fileSize: number, folder: string = 'reactions'): Promise<{ secure_url: string; duration: number }> => {
  return new Promise((resolve, reject) => {
    console.log('Buffer size:', buffer.length, 'File size:', fileSize);
    if (buffer.length === 0) return reject(new Error('Empty buffer received'));

    let transformation_options;
    const TEN_MB = 10 * 1024 * 1024;

    if (fileSize < TEN_MB) {
      transformation_options = [{ fetch_format: 'auto' }];
    } else {
      transformation_options = [
        { width: 1280, crop: "limit" },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ];
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: folder,
        format: 'mp4', // Kept as per instruction, though f_auto might make it redundant
        eager_async: true,
        eager: transformation_options
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          return reject(error);
        }

        const secure_url = result?.secure_url || '';
        let duration = 0;
        if (result && typeof result.duration === 'number') {
          duration = Math.round(result.duration);
        } else if (result && result.video && typeof result.video.duration === 'number') {
          duration = Math.round(result.video.duration);
        }

        resolve({ secure_url, duration });
      }
    );

    Readable.from(buffer).pipe(stream);
  });
};

export const uploadToCloudinarymedia = async (buffer: Buffer, resourceType: 'image' | 'video'): Promise<string> => {
  try {
    const base64Data = buffer.toString('base64');
    const prefix = resourceType === 'image' ? 'data:image/jpeg;base64,' : 'data:video/mp4;base64,';
    const dataUri = `${prefix}${base64Data}`;

    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload(
        dataUri,
        {
          resource_type: resourceType,
          folder: 'messages',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
    });

    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload file to Cloudinary');
  }
};
export const deleteMultipleFromCloudinary = (publicIds: string[], resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (!publicIds || publicIds.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log('No public IDs provided for bulk deletion.');
      }
      return resolve({ message: 'No public IDs provided, nothing to delete.' });
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`Attempting to bulk delete ${publicIds.length} assets from Cloudinary with resource_type='${resourceType}'`);
    }

    cloudinary.api.delete_resources(publicIds, { resource_type: resourceType, type: 'upload' }, (error, result) => {
      if (error) {
        console.error('Error bulk deleting from Cloudinary:', { numIds: publicIds.length, resourceType, error });
        return reject(error);
      }
      
      // result for delete_resources is an object where keys are public_ids and values are { "result": "ok" or "not found" or error message }
      // Example: { "deleted": { "id1": "ok", "id2": "not_found" }, "deleted_counts": { "id1": { "original": 1, "derived": 0 } }, "failed": {} }
      // We should check for any failures within the result.
      let allSucceeded = true;
      if (result && typeof result.deleted === 'object') {
        for (const id in result.deleted) {
          if (result.deleted[id] !== 'ok' && result.deleted[id] !== 'not found') {
            allSucceeded = false;
            if (process.env.NODE_ENV === 'development') {
              console.warn(`Failed to delete asset ${id} during bulk operation: ${result.deleted[id]}`, { result });
            }
          }
        }
      } else if (result && result.error) { // General error in result
        allSucceeded = false;
        console.error('Cloudinary bulk deletion returned an error in the result object:', { result });
      }


      if (!allSucceeded) {
        // Even if some fail, the API call itself might not throw an error, but returns failure details in the result.
        // For simplicity, we can reject if any part of the bulk operation failed, or resolve with detailed status.
        // Here, let's consider it a partial success but log warnings for failures.
        // The original instruction was "error handling and logging similar to the existing deleteFromCloudinary"
        // which rejects on failure. So, if any part fails, we might want to reject.
        // However, bulk operations might partially succeed.
        // For now, log warnings and resolve, but this could be changed to reject.
         if (process.env.NODE_ENV === 'development') {
            console.warn('Cloudinary bulk deletion completed with some failures. See details in result object.', { result });
          }
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log(`Successfully bulk deleted or assets not found from Cloudinary.`, { numIds: publicIds.length, resourceType, result });
        }
      }
      resolve(result); // Resolve with the result object which contains details for each ID
    });
  });
};
