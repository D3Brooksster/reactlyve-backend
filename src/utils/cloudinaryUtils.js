const { v2: cloudinary } = require('cloudinary');
const dotenv = require('dotenv');
const { URL } = require('url');
const { Readable } = require('stream');

dotenv.config();

const OVERLAY_PUBLIC_ID = process.env.CLOUDINARY_OVERLAY_PUBLIC_ID || 'Reactlyve_Logo_bi78md';

// Allow overlay width to be specified as a percentage (e.g., "30" or "0.3")
// Defaults to 0.3 (30%) if unset or invalid
let OVERLAY_WIDTH_PERCENT = '0.3';
if (process.env.CLOUDINARY_OVERLAY_WIDTH_PERCENT) {
  const rawValue = process.env.CLOUDINARY_OVERLAY_WIDTH_PERCENT;
  const parsed = parseFloat(rawValue);
  if (!isNaN(parsed) && parsed > 0) {
    OVERLAY_WIDTH_PERCENT = parsed > 1 ? (parsed / 100).toString() : parsed.toString();
  }
}
const NEW_WORKING_OVERLAY_PARAMS = `l_${OVERLAY_PUBLIC_ID},fl_relative,w_${OVERLAY_WIDTH_PERCENT}/fl_layer_apply,g_south_east,x_10,y_10`;
const SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING = `f_auto,q_auto/${NEW_WORKING_OVERLAY_PARAMS}`;
const LARGE_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING = `w_1280,c_limit,q_auto,f_auto/${NEW_WORKING_OVERLAY_PARAMS}`;
const IMAGE_OVERLAY_TRANSFORMATION_STRING = `f_auto,q_auto/${NEW_WORKING_OVERLAY_PARAMS}`;
const JUST_THE_OVERLAY_TRANSFORMATION = `l_${OVERLAY_PUBLIC_ID},fl_relative,w_${OVERLAY_WIDTH_PERCENT},g_south_east,x_10,y_10,fl_layer_apply`; // This might be unused or deprecated after this change

exports.NEW_WORKING_OVERLAY_PARAMS = NEW_WORKING_OVERLAY_PARAMS;
exports.SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING = SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING;
exports.LARGE_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING = LARGE_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING;
exports.IMAGE_OVERLAY_TRANSFORMATION_STRING = IMAGE_OVERLAY_TRANSFORMATION_STRING;
exports.OVERLAY_PUBLIC_ID = OVERLAY_PUBLIC_ID;
exports.OVERLAY_WIDTH_PERCENT = OVERLAY_WIDTH_PERCENT;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

exports.extractPublicIdAndResourceType = (cloudinaryUrl) => {
  if (typeof cloudinaryUrl !== 'string') {
    console.warn(`Invalid URL format for public ID extraction: Expected a string, but received ${typeof cloudinaryUrl}.`);
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(cloudinaryUrl);
  } catch (error) {
    console.error('Failed to parse Cloudinary URL in extractPublicIdAndResourceType:', { cloudinaryUrl, error });
    return null;
  }

  const hostname = parsedUrl.hostname;
  if (hostname !== 'res.cloudinary.com' && !hostname.endsWith('.cloudinary.com')) {
    console.log(`Attempted to extract public ID from non-Cloudinary URL: ${cloudinaryUrl}`);
    return null;
  }

  try {
    // const url = new URL(cloudinaryUrl); // Already parsed as parsedUrl
    const pathname = parsedUrl.pathname;
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
    if (typeof cloudinaryUrl !== 'string') {
      console.warn(`Invalid URL provided to deleteFromCloudinary: Expected a string, but received ${typeof cloudinaryUrl}.`);
      return resolve({ message: "Skipped invalid URL (not a string)" });
    }
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

exports.uploadVideoToCloudinary = (buffer, fileSize, folder = 'reactions', options = {}) => {
  // This helper uses Cloudinary's video upload API. Audio files are also
  // uploaded with `resource_type: "video"`, which is why they appear as video
  // assets in the Cloudinary dashboard.
  if (options.moderation && options.moderation !== 'manual') {
    options.moderation_async = true;
  }
  if (process.env.NODE_ENV === 'development') {
    console.log('[CloudinaryUpload] video options:', options);
  }
  return new Promise((resolve, reject) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('Buffer size:', buffer.length, 'File size:', fileSize);
    }
    if (buffer.length === 0) return reject(new Error('Empty buffer received'));

    // let videoTransformationOptions; // No longer using separate base options here
    const TEN_MB = 10 * 1024 * 1024;
    let combinedOverlayString;

    if (fileSize < TEN_MB) {
      // videoTransformationOptions = [{ fetch_format: 'auto' }];
      combinedOverlayString = SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING;
    } else {
      // videoTransformationOptions = [
      //   { width: 1280, crop: "limit" },
      //   { quality: 'auto' },
      //   { fetch_format: 'auto' }
      // ];
      combinedOverlayString = LARGE_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING;
    }

    const thumbnailTransformation = {
      format: "jpg",
      crop: "thumb",
      width: 200,
      height: 150,
      start_offset: "0",
      quality: "auto"
    };

    // const overlayStep = { raw_transformation: JUST_THE_OVERLAY_TRANSFORMATION }; // Not used in this approach
    const mainVideoTransformation = { raw_transformation: combinedOverlayString };
    const eagerTransformations = [mainVideoTransformation, thumbnailTransformation];

    // if (Array.isArray(videoTransformationOptions)) { // Logic simplified
    //   eagerTransformations = [...videoTransformationOptions, overlayStep, thumbnailTransformation];
    // } else {
    //   eagerTransformations = [videoTransformationOptions, overlayStep, thumbnailTransformation];
    // }

    const postBody = {
      resource_type: 'video',
      folder: folder,
      eager_async: true,
      eager: eagerTransformations,
      ...options
    };
    if (process.env.CLOUDINARY_NOTIFICATION_URL) {
      postBody.notification_url = process.env.CLOUDINARY_NOTIFICATION_URL;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[CloudinaryRequest] POST /upload', JSON.stringify(postBody));
    }

    const stream = cloudinary.uploader.upload_stream(
      postBody,
      (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          return reject(error);
        }

        if (process.env.NODE_ENV === 'development') {
          if (result && result.eager && Array.isArray(result.eager)) {
            console.log('[uploadVideoToCloudinary] Eager transformation results:');
            result.eager.forEach((eager_result, index) => {
              console.log(`  Eager[${index}]: Processed. URL: ${eager_result.secure_url}, Bytes: ${eager_result.bytes}, Format: ${eager_result.format}`);
            });
          } else if (result) {
            console.log('[uploadVideoToCloudinary] No eager transformations found in result or result.eager is not an array. Result:', result);
          }
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

        resolve({ secure_url: videoSecureUrl, thumbnail_url: thumbnailUrl, duration, moderation: result.moderation });
      }
    );

    Readable.from(buffer).pipe(stream);
  });
};

exports.uploadToCloudinarymedia = async (buffer, resourceType, options = {}) => {
  if (options.moderation && options.moderation !== 'manual') {
    options.moderation_async = true;
  }
  if (process.env.NODE_ENV === 'development') {
    console.log('[CloudinaryUpload] media options:', { resourceType, options });
  }
  try {
    const base64Data = buffer.toString('base64');
    const prefix = resourceType === 'image' ? 'data:image/jpeg;base64,' : 'data:video/mp4;base64,';
    const dataUri = `${prefix}${base64Data}`;

    const uploadOptions = {
      resource_type: resourceType,
      folder: 'messages',
      ...options,
    };
    if (process.env.CLOUDINARY_NOTIFICATION_URL) {
      uploadOptions.notification_url = process.env.CLOUDINARY_NOTIFICATION_URL;
    }

    // const overlayStep = { raw_transformation: JUST_THE_OVERLAY_TRANSFORMATION }; // Not used in this approach

    if (resourceType === 'image') {
      // let imageEagerOptions = [{ fetch_format: 'auto' }, { quality: 'auto' }]; // Logic removed
      // imageEagerOptions.push(overlayStep); // Logic removed
      uploadOptions.eager = [{ raw_transformation: IMAGE_OVERLAY_TRANSFORMATION_STRING }];
    } else if (resourceType === 'video') {
      // let videoEagerOptions = [{ fetch_format: 'auto' }, { quality: 'auto' }]; // Logic removed
      // videoEagerOptions.push(overlayStep); // Logic removed
      uploadOptions.eager = [{ raw_transformation: SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING }];
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[CloudinaryRequest] POST /upload', JSON.stringify({
        resource_type: resourceType,
        folder: 'messages',
        ...options,
        eager: uploadOptions.eager,
      }));
    }

    const result = await new Promise((resolve, reject) => { // Removed 'any' type
      cloudinary.uploader.upload(
        dataUri,
        uploadOptions,
        (error, result) => {
          if (error) reject(error);
          else {
            if (process.env.NODE_ENV === 'development') {
              if (result && result.eager && Array.isArray(result.eager)) {
                console.log('[uploadToCloudinarymedia] Eager transformation results:');
                result.eager.forEach((eager_result, index) => {
                  console.log(`  Eager[${index}]: Processed. URL: ${eager_result.secure_url}, Bytes: ${eager_result.bytes}, Format: ${eager_result.format}`);
                });
              } else if (result) {
                console.log('[uploadToCloudinarymedia] No eager transformations found in result or result.eager is not an array. Result:', result);
              }
            }
            resolve(result);
          }
        }
      );
    });

    return { secure_url: result.secure_url, moderation: result.moderation };
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

exports.generateDownloadUrl = (cloudinaryUrl, filename) => {
  if (typeof cloudinaryUrl !== 'string') return '';

  try {
    const parsed = new URL(cloudinaryUrl);

    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

    const extracted = exports.extractPublicIdAndResourceType(cloudinaryUrl);
    if (extracted) {
      const versionMatch = parsed.pathname.match(/\/v(\d+)\//);
      const options = {
        resource_type: extracted.resource_type,
        type: 'upload',
        flags: `attachment:${nameWithoutExt}`,
        sign_url: true,
        secure: true
      };
      if (versionMatch) options.version = versionMatch[1];
      return cloudinary.url(extracted.public_id, options);
    }

    const segments = parsed.pathname.split('/');
    const uploadIndex = segments.indexOf('upload');
    if (uploadIndex !== -1) {
      segments.splice(uploadIndex + 1, 0, `fl_attachment:${nameWithoutExt}`);
      parsed.pathname = segments.join('/');
    }
    return parsed.toString();
  } catch (err) {
    console.error('Failed to generate download URL:', err);
    return cloudinaryUrl;
  }
};
