import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import { URL } from 'url'; // Ensure URL is imported if not globally available

dotenv.config(); // Ensure environment variables are loaded

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export const deleteFromCloudinary = (cloudinaryUrl: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(cloudinaryUrl);
      const pathname = url.pathname; 

      const pathSegments = pathname.split('/').filter(segment => segment); 

      if (pathSegments.length < 4) { 
        return reject(new Error('Invalid Cloudinary URL: Path too short. Needs at least cloud_name, resource_type, delivery_type, and public_id part.'));
      }

      const resource_type = pathSegments[1];
      if (!['image', 'video', 'raw'].includes(resource_type)) {
        return reject(new Error(`Invalid resource_type: '${resource_type}'. Must be 'image', 'video', or 'raw'.`));
      }

      const startIndexAfterUpload = 3; 
      const potentialPublicIdParts = pathSegments.slice(startIndexAfterUpload);

      if (potentialPublicIdParts.length === 0) {
        return reject(new Error('No segments found for public_id after cloud_name/resource_type/delivery_type.'));
      }

      const publicIdPathParts = potentialPublicIdParts.filter(segment => {
        if (segment.match(/^v\d+$/)) {
          return false; 
        }
        return true; 
      });

      if (publicIdPathParts.length === 0) {
        return reject(new Error('Public ID path parts array is empty after filtering version segment (if any).'));
      }

      const publicIdWithExtension = publicIdPathParts.join('/');
      
      const lastDotIndex = publicIdWithExtension.lastIndexOf('.');
      const public_id = (lastDotIndex > 0 && lastDotIndex < publicIdWithExtension.length -1) 
                        ? publicIdWithExtension.substring(0, lastDotIndex) 
                        : publicIdWithExtension;

      if (!public_id) { 
        return reject(new Error('Public ID became empty after attempting to remove extension.'));
      }
      
      console.log(`Attempting to delete from Cloudinary: public_id='${public_id}', resource_type='${resource_type}'`);

      cloudinary.uploader.destroy(public_id, { resource_type: resource_type as 'image' | 'video' | 'raw' }, (error, result) => {
        if (error) {
          console.error('Error deleting from Cloudinary:', error);
          return reject(error);
        }
        if (result && result.result !== 'ok' && result.result !== 'not found') {
            console.warn('Cloudinary deletion warning:', result);
             if (result.result === 'not found') {
                console.log(`Asset with public_id '${public_id}' not found on Cloudinary. Considered as deleted.`);
                return resolve(result);
            }
            return reject(new Error(`Cloudinary deletion failed: ${result.result}`));
        }
        console.log('Successfully deleted from Cloudinary or asset was not found:', result);
        resolve(result);
      });
    } catch (error) {
      console.error('Failed to parse Cloudinary URL or other unexpected error in deleteFromCloudinary:', error);
      reject(error);
    }
  });
};
