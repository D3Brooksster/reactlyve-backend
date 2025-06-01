import S3 from 'aws-sdk/clients/s3';
import dotenv from 'dotenv';
import sharp from 'sharp';

dotenv.config();

/**
 * @constant {string | undefined} S3_BUCKET_NAME
 * The name of the S3 bucket, sourced from the S3_BUCKET_NAME environment variable.
 * This is crucial for all S3 operations specifying the target bucket.
 */
export const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Ensure S3_BUCKET_NAME is defined at startup
if (!S3_BUCKET_NAME) {
  throw new Error("S3_BUCKET_NAME is not defined in environment variables. This is required for S3 operations.");
}

/**
 * @constant {string | undefined} S3_ENDPOINT
 * The custom endpoint for S3-compatible services (e.g., MinIO, Backblaze B2).
 * Sourced from the S3_ENDPOINT environment variable.
 * For AWS S3, this can often be omitted, and the AWS SDK will use the default regional endpoint.
 */
export const S3_ENDPOINT = process.env.S3_ENDPOINT;


/**
 * @description S3 client configuration object.
 * Configures the S3 client with credentials and settings from environment variables.
 * - `accessKeyId`: AWS Access Key ID for S3. From `process.env.S3_ACCESS_KEY_ID`.
 * - `secretAccessKey`: AWS Secret Access Key for S3. From `process.env.S3_SECRET_ACCESS_KEY`.
 * - `region`: AWS Region for the S3 bucket. From `process.env.S3_REGION`.
 * - `endpoint`: Custom S3 endpoint (optional, for S3-compatible services). From `process.env.S3_ENDPOINT`.
 * - `s3ForcePathStyle: true`: Forces path-style URLs (e.g., `endpoint/bucket/key`) instead of virtual-hosted style (e.g., `bucket.endpoint/key`).
 *   This is often required for S3-compatible services like MinIO.
 */
const s3Config: S3.ClientConfiguration = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION,
  endpoint: S3_ENDPOINT, // Use the exported S3_ENDPOINT const
  s3ForcePathStyle: true,
};

/**
 * @description The S3 client instance.
 * Initialized with the `s3Config`. This client is used for all S3 operations.
 */
export const s3Client = new S3(s3Config);


/**
 * @interface UploadToS3MediaParams
 * Parameters for the `uploadToS3Media` function.
 * @property {Buffer} buffer - The buffer containing the media data.
 * @property {string} fileName - The original or desired file name for the media. Used to help determine extension and S3 key.
 * @property {'image' | 'video'} resourceType - The type of media being uploaded ('image' or 'video').
 */
interface UploadToS3MediaParams {
  buffer: Buffer;
  fileName: string;
  resourceType: 'image' | 'video';
}

/**
 * Uploads media (image or video) to an S3 bucket.
 * Images are processed with `sharp` and converted to WebP format (80% quality).
 * Videos are uploaded as-is, with their ContentType determined from the fileName extension.
 * The S3 object key is generated with a "messages/" prefix and includes a timestamp.
 *
 * @async
 * @function uploadToS3Media
 * @param {UploadToS3MediaParams} params - The parameters for the media upload.
 * @returns {Promise<string>} A promise that resolves with the S3 URL (Location) of the uploaded media.
 * @throws {Error} If the upload fails, sharp processing fails, S3_BUCKET_NAME is not set, or an invalid resourceType is provided.
 */
export const uploadToS3Media = async ({
  buffer,
  fileName,
  resourceType,
}: UploadToS3MediaParams): Promise<string> => {
  let bufferToUpload: Buffer;
  let s3Key: string;
  let contentType: string;

  try {
    if (resourceType === 'image') {
      bufferToUpload = await sharp(buffer).webp({ quality: 80 }).toBuffer();
      s3Key = `messages/${Date.now()}-${fileName}.webp`; // Standardize to .webp extension
      contentType = 'image/webp';
    } else if (resourceType === 'video') {
      bufferToUpload = buffer;
      const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '.mp4';
      const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
      s3Key = `messages/${Date.now()}-${baseName}${extension}`;
      contentType = `video/${extension.replace('.', '')}`;
      if (extension.toLowerCase() === '.mov') contentType = 'video/quicktime';
      else if (extension.toLowerCase() === '.avi') contentType = 'video/x-msvideo';
      // Add more specific video content types as needed
    } else {
      throw new Error('Invalid resourceType specified. Must be "image" or "video".');
    }

    const uploadParams: S3.PutObjectRequest = {
      Bucket: S3_BUCKET_NAME!, // S3_BUCKET_NAME is checked at startup
      Key: s3Key,
      Body: bufferToUpload,
      ContentType: contentType,
    };

    const data = await s3Client.upload(uploadParams).promise();
    if (!data.Location) {
        throw new Error('S3 upload did not return a location.');
    }
    return data.Location;
  } catch (error) {
    console.error('Error in uploadToS3Media:', error);
    if (error instanceof Error) {
        throw new Error(`Failed to upload media: ${error.message}`);
    }
    throw new Error('Failed to upload media due to an unknown error.');
  }
};

/**
 * @interface UploadVideoToS3Params
 * Parameters for the `uploadVideoToS3` function.
 * @property {Buffer} buffer - The buffer containing the video data.
 * @property {string} fileName - The original or desired file name for the video. Used to determine extension and S3 key.
 * @property {string} [folder='reactions'] - Optional S3 folder (prefix) to upload the video to. Defaults to 'reactions'.
 */
interface UploadVideoToS3Params {
  buffer: Buffer;
  fileName: string;
  folder?: string;
}

/**
 * @interface UploadVideoToS3Result
 * Result of the `uploadVideoToS3` function.
 * @property {string} secure_url - The S3 URL (Location) of the uploaded video.
 * @property {number} duration - The duration of the video in seconds.
 *   Currently, this is a placeholder value (0) as ffmpeg/ffprobe integration is needed for actual duration extraction.
 */
interface UploadVideoToS3Result {
  secure_url: string;
  duration: number;
}

/**
 * Uploads a video to an S3 bucket.
 * The video is uploaded as-is without transformations.
 * Video duration is currently returned as a placeholder (0).
 * The S3 object key is generated with a specified folder prefix (defaults to "reactions/") and includes a timestamp.
 *
 * @async
 * @function uploadVideoToS3
 * @param {UploadVideoToS3Params} params - The parameters for the video upload.
 * @returns {Promise<UploadVideoToS3Result>} A promise that resolves with an object containing the S3 URL and placeholder duration.
 * @throws {Error} If the upload fails or S3_BUCKET_NAME is not set.
 */
export const uploadVideoToS3 = async ({
  buffer,
  fileName,
  folder = 'reactions',
}: UploadVideoToS3Params): Promise<UploadVideoToS3Result> => {
  try {
    // TODO: Implement video processing (e.g., resizing, quality adjustment) here
    // using a library like ffmpeg if needed in the future.
    // For now, the video is uploaded as-is.

    const originalFileName = fileName;
    const extension = originalFileName.includes('.') ? originalFileName.substring(originalFileName.lastIndexOf('.')) : '.mp4';
    const baseFileName = originalFileName.includes('.') ? originalFileName.substring(0, originalFileName.lastIndexOf('.')) : originalFileName;

    const s3Key = `${folder}/${Date.now()}-${baseFileName}${extension}`;

    let videoContentType = `video/${extension.replace('.', '').toLowerCase()}`;
    if (extension.toLowerCase() === '.mov') {
      videoContentType = 'video/quicktime';
    } else if (extension.toLowerCase() === '.mp4') {
      videoContentType = 'video/mp4';
    } else if (extension.toLowerCase() === '.webm') {
      videoContentType = 'video/webm';
    } else if (extension.toLowerCase() === '.avi') {
      videoContentType = 'video/x-msvideo';
    }
    // Add more content types as needed

    const uploadParams: S3.PutObjectRequest = {
      Bucket: S3_BUCKET_NAME!, // S3_BUCKET_NAME is checked at startup
      Key: s3Key,
      Body: buffer,
      ContentType: videoContentType,
    };

    const data = await s3Client.upload(uploadParams).promise();

    if (!data.Location) {
      throw new Error('S3 upload did not return a location for the video.');
    }

    // Placeholder for duration. Proper duration extraction would require a library
    // like ffmpeg or ffprobe to inspect the video buffer.
    const duration = 0;

    return {
      secure_url: data.Location,
      duration,
    };
  } catch (error) {
    console.error('Error in uploadVideoToS3:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to upload video: ${error.message}`);
    }
    throw new Error('Failed to upload video due to an unknown error.');
  }
};

/**
 * Deletes an object from an S3 bucket.
 * If the object key does not exist in the bucket (AWS S3 error 'NoSuchKey'),
 * the function treats this as a success and resolves, logging the event.
 * This behavior is to mimic some cloud providers that don't error on "delete if not exists".
 *
 * @function deleteFromS3
 * @param {string} objectKey - The key of the object to delete in the S3 bucket.
 * @returns {Promise<S3.DeleteObjectOutput>} A promise that resolves with the S3 deleteObject data on success,
 *   or an empty object if the key was not provided or if 'NoSuchKey' error occurred.
 * @throws {Error} If S3_BUCKET_NAME is not set or if an S3 error (other than 'NoSuchKey') occurs.
 */
export const deleteFromS3 = (objectKey: string): Promise<S3.DeleteObjectOutput> => {
  return new Promise((resolve, reject) => {
    if (!S3_BUCKET_NAME) { // Should have been caught at startup, but good for robustness
      console.error("deleteFromS3: S3_BUCKET_NAME is not defined.");
      return reject(new Error("S3_BUCKET_NAME is not defined."));
    }
    if (!objectKey) {
      console.warn("deleteFromS3: No objectKey provided. Nothing to delete.");
      return resolve({}); // Resolve with empty object as success-like indicator
    }

    const params: S3.DeleteObjectRequest = {
      Bucket: S3_BUCKET_NAME,
      Key: objectKey,
    };

    s3Client.deleteObject(params, (err, data) => {
      if (err) {
        if (err.code === 'NoSuchKey') {
          console.log(`deleteFromS3: Object not found (NoSuchKey), but resolving as success for key: ${objectKey}`);
          resolve(data || {});
        } else {
          console.error(`deleteFromS3: Error deleting object ${objectKey}:`, err);
          reject(err);
        }
      } else {
        console.log(`deleteFromS3: Successfully deleted object ${objectKey}`);
        resolve(data);
      }
    });
  });
};

/**
 * @interface DeleteMultipleResult
 * Result of the `deleteMultipleFromS3` function, mirroring S3's `DeleteObjectsOutput` structure.
 * @property {S3.DeletedObjects | undefined} Deleted - Array of successfully deleted objects.
 * @property {S3.Errors | undefined} Errors - Array of objects that failed to delete, with error details.
 */
interface DeleteMultipleResult {
    Deleted?: S3.DeletedObjects;
    Errors?: S3.Errors;
}

/**
 * Deletes multiple objects from an S3 bucket.
 * If some objects fail to delete, errors are logged to the console, but the promise still resolves
 * with details of successfully deleted objects and errors for failed ones.
 *
 * @function deleteMultipleFromS3
 * @param {string[]} objectKeys - An array of S3 object keys to delete.
 * @returns {Promise<DeleteMultipleResult>} A promise that resolves with an object containing arrays of
 *   `Deleted` objects and `Errors` (if any).
 * @throws {Error} If S3_BUCKET_NAME is not set or if the entire batch deletion operation encounters a major S3 error.
 */
export const deleteMultipleFromS3 = (objectKeys: string[]): Promise<DeleteMultipleResult> => {
  return new Promise((resolve, reject) => {
    if (!S3_BUCKET_NAME) { // Should have been caught at startup
      console.error("deleteMultipleFromS3: S3_BUCKET_NAME is not defined.");
      return reject(new Error("S3_BUCKET_NAME is not defined."));
    }

    if (!objectKeys || objectKeys.length === 0) {
      console.log("deleteMultipleFromS3: No object keys provided for deletion. Nothing to delete.");
      return resolve({ Deleted: [], Errors: [] });
    }

    const objectsToDelete: S3.ObjectIdentifierList = objectKeys.map(key => ({ Key: key }));

    const params: S3.DeleteObjectsRequest = {
      Bucket: S3_BUCKET_NAME,
      Delete: {
        Objects: objectsToDelete,
        Quiet: false, // We want the list of deleted objects and errors in the response
      },
    };

    s3Client.deleteObjects(params, (err, data) => {
      if (err) {
        console.error("deleteMultipleFromS3: Error during batch deletion operation:", err);
        reject(err); // This is an error with the overall S3 operation
      } else {
        if (data.Errors && data.Errors.length > 0) {
          console.warn("deleteMultipleFromS3: Some objects could not be deleted (see details below):");
          data.Errors.forEach(error => {
            console.warn(`  Key: ${error.Key}, Code: ${error.Code}, Message: ${error.Message}`);
          });
        }
        if (data.Deleted && data.Deleted.length > 0) {
            console.log(`deleteMultipleFromS3: Successfully deleted ${data.Deleted.length} objects (or they were already not found).`);
        }
        // Resolve with the data from S3, which includes both Deleted and Errors arrays
        resolve({ Deleted: data.Deleted, Errors: data.Errors });
      }
    });
  });
};


/**
 * Extracts the S3 object key from a given S3 URL.
 * This function attempts to parse various common S3 URL formats, including:
 * - Path-style (e.g., `https://s3.REGION.amazonaws.com/BUCKET_NAME/object/key.jpg`)
 * - Virtual-hosted style (e.g., `https://BUCKET_NAME.s3.REGION.amazonaws.com/object/key.jpg`)
 * - URLs using a custom S3 endpoint (defined by `S3_ENDPOINT` and `S3_BUCKET_NAME` env vars).
 *
 * It relies on `S3_BUCKET_NAME` and `S3_ENDPOINT` (if applicable for custom endpoints)
 * environment variables to correctly identify the bucket and parse the key.
 *
 * @function extractKeyFromS3Url
 * @param {string} s3Url - The S3 URL to parse.
 * @returns {string | null} The extracted S3 object key if parsing is successful and the URL
 *   matches known patterns for the configured bucket/endpoint. Returns `null` otherwise,
 *   or if `S3_BUCKET_NAME` is not defined.
 */
export const extractKeyFromS3Url = (s3Url: string): string | null => {
  if (!s3Url) {
    console.warn("extractKeyFromS3Url: No URL provided.");
    return null;
  }
  // S3_BUCKET_NAME is checked at startup, but this provides function-level robustness.
  if (!S3_BUCKET_NAME) {
    console.error("extractKeyFromS3Url: S3_BUCKET_NAME is not defined. Cannot accurately parse URL.");
    return null;
  }

  try {
    const url = new URL(s3Url);
    let key: string | null = null;

    const hostname = url.hostname;
    const pathname = url.pathname; // Starts with a '/'

    // Check for custom endpoint if S3_ENDPOINT is defined
    if (S3_ENDPOINT) {
      // Ensure S3_ENDPOINT itself is a valid URL for parsing its hostname
      let endpointHostname: string;
      try {
        const endpointUrl = new URL(S3_ENDPOINT.startsWith('http') ? S3_ENDPOINT : `https://${S3_ENDPOINT}`);
        endpointHostname = endpointUrl.hostname;
      } catch (e) {
        console.error("extractKeyFromS3Url: Invalid S3_ENDPOINT format.", e);
        // Fallback to try standard AWS patterns if endpoint parsing fails
        endpointHostname = '';
      }

      if (endpointHostname) {
        if (hostname === endpointHostname) {
          // Path-style with custom endpoint: ENDPOINT/BUCKET_NAME/key
          if (pathname.startsWith(`/${S3_BUCKET_NAME}/`)) {
            key = pathname.substring(`/${S3_BUCKET_NAME}/`.length);
          } else if (!pathname.startsWith(`/${S3_BUCKET_NAME}`)) {
            // Fallback for custom endpoint where path might be the key directly (e.g. MinIO)
            key = pathname.substring(1); // Remove leading slash
          }
        } else if (hostname === `${S3_BUCKET_NAME}.${endpointHostname}`) {
          // Virtual-hosted style with custom endpoint: BUCKET_NAME.ENDPOINT/key
          key = pathname.substring(1); // Remove leading slash
        }
      }
    }

    // If not matched by custom endpoint logic, try standard AWS patterns
    if (key === null) {
      if (hostname.includes('s3') && hostname.includes('amazonaws.com')) { // Standard AWS S3 domain
        if (hostname.startsWith(`${S3_BUCKET_NAME}.`)) {
          // Virtual-hosted style: BUCKET_NAME.s3.REGION.amazonaws.com/key
          key = pathname.substring(1); // Remove leading slash
        } else {
          // Path-style: s3.REGION.amazonaws.com/BUCKET_NAME/key
          // or s3.amazonaws.com/BUCKET_NAME/key (region might not be in hostname for older US-East-1)
          if (pathname.startsWith(`/${S3_BUCKET_NAME}/`)) {
            key = pathname.substring(`/${S3_BUCKET_NAME}/`.length);
          }
        }
      }
    }

    return key ? key.replace(/^\/+/, '') : null; // Remove any leading slashes from the final key

  } catch (error) {
    console.error("extractKeyFromS3Url: Error parsing URL", s3Url, error);
    return null;
  }
};
// Note: s3Client and S3_BUCKET_NAME are already exported.
// No need for: export { s3Client, S3_BUCKET_NAME }; unless to be explicit about re-exporting after definition.
// However, since S3_BUCKET_NAME is defined with 'export const' and s3Client also, they are available.
// Added S3_ENDPOINT as an export for potential external use, though primarily used internally here.
// Re-exporting s3Client and S3_BUCKET_NAME for clarity is fine if preferred.
export { s3Client }; // S3_BUCKET_NAME and S3_ENDPOINT already exported with 'export const'
