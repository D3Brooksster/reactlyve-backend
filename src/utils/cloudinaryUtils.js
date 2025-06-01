const { v2: cloudinary } = require('cloudinary');
const dotenv = require('dotenv');
const { URL } = require('url');
const { Readable } = require('stream');

const SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING = "f_auto,q_auto,l_reactlyve:81ad2da14e6d70f29418ba02a7d2aa96,w_0.1,g_south_east,x_10,y_10,fl_layer_apply";
const LARGE_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING = "w_1280,c_limit,q_auto,f_auto,l_reactlyve:81ad2da14e6d70f29418ba02a7d2aa96,w_0.1,g_south_east,x_10,y_10,fl_layer_apply";
const IMAGE_OVERLAY_TRANSFORMATION_STRING = "f_auto,q_auto,l_reactlyve:81ad2da14e6d70f29418ba02a7d2aa96,w_0.1,g_south_east,x_10,y_10,fl_layer_apply";
const JUST_THE_OVERLAY_TRANSFORMATION = "l_reactlyve:81ad2da14e6d70f29418ba02a7d2aa96,w_0.1,g_south_east,x_10,y_10,fl_layer_apply";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

exports.extractPublicIdAndResourceType = (cloudinaryUrl) => {
  if (typeof cloudinaryUrl !== 'string' || !cloudinaryUrl.includes('cloudinary.com')) {
    if (typeof cloudinaryUrl !== 'string') {
      console.warn(`Invalid URL format for public ID extraction: Expected a string, but received ${typeof cloudinaryUrl}.`);
    } else {
      console.log(`Attempted to extract public ID from non-Cloudinary URL: ${cloudinaryUrl}`);
    }
    return null;
  }

  try {
    const url = new URL(cloudinaryUrl);
    const pathname = url.pathname;
    const pathSegments = pathname.split('/').filter(segment => segment);

    let resourceTypeIndex = -1;
    for (let i = 0; i < pathSegments.length; i++) {
      if (['image', 'video', 'raw'].includes(pathSegments[i])) {
        resourceTypeIndex = i;
        break;
      }
    }

    if (resourceTypeIndex === -1 || resourceTypeIndex + 2 >= pathSegments.length) {
      console.error('Invalid Cloudinary URL: Could not determine resource_type or not enough path segments.', { cloudinaryUrl });
      return null;
    }
    
    const resource_type = pathSegments[resourceTypeIndex];
    
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

exports.deleteFromCloudinary = (cloudinaryUrl) => {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(cloudinaryUrl);
      if (url.hostname !== 'res.cloudinary.com' && !url.hostname.endsWith('.cloudinary.com')) {
        console.log(`Skipping deletion for non-Cloudinary URL: ${cloudinaryUrl}`);
        return resolve({ message: "Skipped non-Cloudinary URL" });
      }
    } catch (error) {
      console.warn(`Invalid URL provided to deleteFromCloudinary: ${cloudinaryUrl}`, error);
      return resolve({ message: "Skipped invalid URL" });
    }

    const extracted = exports.extractPublicIdAndResourceType(cloudinaryUrl); // Use exports.
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

exports.uploadVideoToCloudinary = (buffer, fileSize, folder = 'reactions') => {
  return new Promise((resolve, reject) => {
    console.log('Buffer size:', buffer.length, 'File size:', fileSize);
    if (buffer.length === 0) return reject(new Error('Empty buffer received'));

    let videoTransformationOptions;
    const TEN_MB = 10 * 1024 * 1024;
    // overlayTransformationString is no longer needed here as we use JUST_THE_OVERLAY_TRANSFORMATION directly

    if (fileSize < TEN_MB) {
      videoTransformationOptions = [{ fetch_format: 'auto' }];
    } else {
      videoTransformationOptions = [
        { width: 1280, crop: "limit" },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ];
    }

    const thumbnailTransformation = {
      format: "jpg",
      crop: "thumb",
      width: 200,
      height: 150,
      start_offset: "0",
      quality: "auto"
    };

    let eagerTransformations = [];
    const overlayStep = { raw_transformation: JUST_THE_OVERLAY_TRANSFORMATION };

    if (Array.isArray(videoTransformationOptions)) {
      eagerTransformations = [...videoTransformationOptions, overlayStep, thumbnailTransformation];
    } else { // It's a single object (though current logic always makes it an array)
      eagerTransformations = [videoTransformationOptions, overlayStep, thumbnailTransformation];
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: folder,
        eager_async: true,
        eager: eagerTransformations
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          return reject(error);
        }

        const videoSecureUrl = result?.secure_url || '';
        let duration = 0;
        if (result && typeof result.duration === 'number') {
          duration = Math.round(result.duration);
        } else if (result && result.video && typeof result.video.duration === 'number') {
          duration = Math.round(result.video.duration);
        }

        let thumbnailUrl = '';
        if (result && result.public_id && result.version) {
          const cloudName = cloudinary.config().cloud_name;
          // Transformation string for the thumbnail as defined in thumbnailTransformation
          // c_thumb,f_jpg,h_150,q_auto,so_0,w_200
          const transformationString = `c_thumb,f_jpg,h_150,q_auto,so_0,w_200`;
          thumbnailUrl = `https://res.cloudinary.com/${cloudName}/video/upload/${transformationString}/v${result.version}/${result.public_id}.jpg`;
        } else {
          console.warn('Could not construct thumbnail URL: public_id or version missing from Cloudinary result.', { result });
        }

        resolve({ secure_url: videoSecureUrl, thumbnail_url: thumbnailUrl, duration });
      }
    );

    Readable.from(buffer).pipe(stream);
  });
};

exports.uploadToCloudinarymedia = async (buffer, resourceType) => {
  try {
    const base64Data = buffer.toString('base64');
    const prefix = resourceType === 'image' ? 'data:image/jpeg;base64,' : 'data:video/mp4;base64,';
    const dataUri = `${prefix}${base64Data}`;

    const uploadOptions = { // Removed 'any' type
      resource_type: resourceType,
      folder: 'messages',
    };

    const overlayStep = { raw_transformation: JUST_THE_OVERLAY_TRANSFORMATION };

    if (resourceType === 'image') {
      let imageEagerOptions = [{ fetch_format: 'auto' }, { quality: 'auto' }];
      imageEagerOptions.push(overlayStep);
      uploadOptions.eager = imageEagerOptions;
    } else if (resourceType === 'video') {
      let videoEagerOptions = [{ fetch_format: 'auto' }, { quality: 'auto' }];
      videoEagerOptions.push(overlayStep);
      uploadOptions.eager = videoEagerOptions;
    }

    const result = await new Promise((resolve, reject) => { // Removed 'any' type
      cloudinary.uploader.upload(
        dataUri,
        uploadOptions,
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

exports.deleteMultipleFromCloudinary = (publicIds, resourceType = 'image') => {
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
      } else if (result && result.error) {
        allSucceeded = false;
        console.error('Cloudinary bulk deletion returned an error in the result object:', { result });
      }

      if (!allSucceeded) {
         if (process.env.NODE_ENV === 'development') {
            console.warn('Cloudinary bulk deletion completed with some failures. See details in result object.', { result });
          }
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log(`Successfully bulk deleted or assets not found from Cloudinary.`, { numIds: publicIds.length, resourceType, result });
        }
      }
      resolve(result);
    });
  });
};
