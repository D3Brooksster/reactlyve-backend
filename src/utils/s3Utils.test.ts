import S3 from 'aws-sdk/clients/s3'; // Import S3 type for mock typing
import sharp from 'sharp'; // Import sharp type for mock typing
import {
  uploadToS3Media,
  uploadVideoToS3,
  deleteFromS3,
  deleteMultipleFromS3,
  extractKeyFromS3Url,
} from './s3Utils'; // Import the functions to be tested

// Mock environment variables
const mockS3BucketName = 'test-bucket';
const mockS3Endpoint = 'https://s3.example.com';
const mockAwsRegion = 'us-east-1';

process.env.S3_BUCKET_NAME = mockS3BucketName;
process.env.S3_ENDPOINT = mockS3Endpoint;
process.env.S3_REGION = mockAwsRegion; // Though not directly used by extractKey, good to have for consistency

// Mock implementations for S3 client methods
const mockS3Upload = jest.fn();
const mockS3DeleteObject = jest.fn();
const mockS3DeleteObjects = jest.fn();

// Mock aws-sdk
jest.mock('aws-sdk', () => {
  // We need to retain the S3 class structure for `new S3()` to work.
  // The actual S3 methods will be mocked.
  class MockS3 {
    upload(...args: any[]) { // Use any[] for flexible arguments
      return { promise: () => mockS3Upload(...args) };
    }
    deleteObject(...args: any[]) { // Use any[] for flexible arguments
      // For deleteObject, the callback pattern is used in s3Utils, not promise() directly on deleteObject call
      // So, the mock needs to call the callback.
      const params = args[0];
      const callback = args[1];
      // Simulate callback behavior based on mockS3DeleteObject's configured behavior
      const promise = mockS3DeleteObject(params);
      promise.then((data: any) => callback(null, data)).catch((err: any) => callback(err, null));
      // deleteObject itself doesn't return a promise in the v2 SDK when a callback is provided.
      // The return here is mostly for Jest's mock tracking if needed, not for s3Utils' consumption.
      return { promise: () => promise };
    }
    deleteObjects(...args: any[]) { // Use any[] for flexible arguments
      const params = args[0];
      const callback = args[1];
      const promise = mockS3DeleteObjects(params);
      promise.then((data: any) => callback(null, data)).catch((err: any) => callback(err, null));
      return { promise: () => promise };
    }
  }
  return { // Return the S3 class under the S3 key
    ...jest.requireActual('aws-sdk'), // Keep other aws-sdk parts if any are used (unlikely for these utils)
    S3: MockS3,
  };
});


// Mock sharp
const mockSharpToBuffer = jest.fn();
const mockSharpWebp = jest.fn().mockReturnThis(); // .webp() returns 'this' for chaining
const mockSharpInstance = {
  webp: mockSharpWebp,
  toBuffer: mockSharpToBuffer,
};
jest.mock('sharp', () => jest.fn(() => mockSharpInstance));


describe('S3 Utility Functions', () => {
  beforeEach(() => {
    // Clear all mock implementations and calls before each test
    mockS3Upload.mockReset();
    mockS3DeleteObject.mockReset();
    mockS3DeleteObjects.mockReset();
    mockSharpToBuffer.mockReset();
    mockSharpWebp.mockReset();
    (sharp as jest.Mock).mockClear(); // Clear calls to the sharp constructor mock itself
  });

  describe('extractKeyFromS3Url', () => {
    it('should return null if S3_BUCKET_NAME is not set', () => {
      const originalBucketName = process.env.S3_BUCKET_NAME;
      delete process.env.S3_BUCKET_NAME;
      expect(extractKeyFromS3Url('https://s3.example.com/test-bucket/some/key.jpg')).toBeNull();
      process.env.S3_BUCKET_NAME = originalBucketName;
    });

    it('should return null for invalid or unparseable URLs', () => {
      expect(extractKeyFromS3Url('not a url')).toBeNull();
      expect(extractKeyFromS3Url('')).toBeNull();
    });

    // Path-style URLs
    it('should extract key from path-style S3 URL (standard AWS)', () => {
      const url = `https://s3.${mockAwsRegion}.amazonaws.com/${mockS3BucketName}/path/to/object.jpg`;
      expect(extractKeyFromS3Url(url)).toBe('path/to/object.jpg');
    });

    it('should extract key from path-style S3 URL (custom endpoint)', () => {
      const url = `${mockS3Endpoint}/${mockS3BucketName}/path/to/object.jpg`;
      expect(extractKeyFromS3Url(url)).toBe('path/to/object.jpg');
    });

    it('should extract key from path-style S3 URL with trailing slash on endpoint', () => {
      process.env.S3_ENDPOINT = 'https://s3.example.com/'; // Trailing slash
      const url = `https://s3.example.com/${mockS3BucketName}/path/to/object.jpg`;
      expect(extractKeyFromS3Url(url)).toBe('path/to/object.jpg');
      process.env.S3_ENDPOINT = mockS3Endpoint; // Reset
    });


    // Virtual-hosted style URLs
    it('should extract key from virtual-hosted S3 URL (standard AWS)', () => {
      const url = `https://${mockS3BucketName}.s3.${mockAwsRegion}.amazonaws.com/virtual/host/object.png`;
      expect(extractKeyFromS3Url(url)).toBe('virtual/host/object.png');
    });

    it('should extract key from virtual-hosted S3 URL (custom endpoint)', () => {
      // Requires S3_ENDPOINT to be just the domain, e.g., s3.example.com
      process.env.S3_ENDPOINT = 's3.customdomain.com';
      const url = `https://${mockS3BucketName}.s3.customdomain.com/virtual/custom/object.mov`;
      expect(extractKeyFromS3Url(url)).toBe('virtual/custom/object.mov');
      process.env.S3_ENDPOINT = mockS3Endpoint; // Reset
    });

    it('should extract key from custom endpoint URL where pathname is the key (MinIO like)', () => {
      const url = `${mockS3Endpoint}/direct-key/object.txt`;
       // This case relies on the fallback logic in extractKeyFromS3Url
      expect(extractKeyFromS3Url(url)).toBe('direct-key/object.txt');
    });


    it('should return null for URLs from a different bucket', () => {
      const url = `https://s3.${mockAwsRegion}.amazonaws.com/another-bucket/path/to/object.jpg`;
      expect(extractKeyFromS3Url(url)).toBeNull();
    });

    it('should handle keys with special characters (though URL encoding is browser/client responsibility)', () => {
      const key = 'path/with spaces/and !@#$%^&*().extension';
      const encodedKey = encodeURIComponent(key); // Simulate client-side encoding
      const urlPathStyle = `${mockS3Endpoint}/${mockS3BucketName}/${encodedKey}`;
      expect(extractKeyFromS3Url(urlPathStyle)).toBe(encodedKey); // Key remains URL-encoded
    });

    it('should remove leading slash if accidentally included in key extraction logic', () => {
        // This test depends on specific mock URL that might lead to double slashes internally if not handled
        const url = `${mockS3Endpoint}/${mockS3BucketName}//leading/slash/key.txt`;
        // The current implementation uses substring which should avoid this, but good to test intent
        expect(extractKeyFromS3Url(url)).toBe('leading/slash/key.txt');
    });
  });

  describe('uploadToS3Media', () => {
    const mockBuffer = Buffer.from('test-buffer');
    const mockFileName = 'test-file.jpg';

    it('should process and upload an image to S3 as webp', async () => {
      const mockProcessedBuffer = Buffer.from('processed-webp-buffer');
      mockSharpToBuffer.mockResolvedValue(mockProcessedBuffer);
      const mockS3Location = `${mockS3Endpoint}/${mockS3BucketName}/messages/timestamp-test-file.jpg.webp`;
      mockS3Upload.mockResolvedValue({ Location: mockS3Location });

      const result = await uploadToS3Media({ buffer: mockBuffer, fileName: mockFileName, resourceType: 'image' });

      expect(sharp).toHaveBeenCalledWith(mockBuffer);
      expect(mockSharpWebp).toHaveBeenCalledWith({ quality: 80 });
      expect(mockSharpToBuffer).toHaveBeenCalled();
      expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: mockS3BucketName,
        Key: expect.stringMatching(/^messages\/\d+-test-file\.jpg\.webp$/),
        Body: mockProcessedBuffer,
        ContentType: 'image/webp',
      }));
      expect(result).toBe(mockS3Location);
    });

    it('should upload a video to S3 without sharp processing', async () => {
      const mockS3Location = `${mockS3Endpoint}/${mockS3BucketName}/messages/timestamp-test-file.mp4`;
      mockS3Upload.mockResolvedValue({ Location: mockS3Location });

      const result = await uploadToS3Media({ buffer: mockBuffer, fileName: 'test-file.mp4', resourceType: 'video' });

      expect(sharp).not.toHaveBeenCalled();
      expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: mockS3BucketName,
        Key: expect.stringMatching(/^messages\/\d+-test-file\.mp4$/),
        Body: mockBuffer,
        ContentType: 'video/mp4', // Based on extension
      }));
      expect(result).toBe(mockS3Location);
    });

    it('should determine video content type from filename extension', async () => {
      mockS3Upload.mockResolvedValue({ Location: 'some-url' });
      await uploadToS3Media({ buffer: mockBuffer, fileName: 'video.mov', resourceType: 'video' });
      expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({ ContentType: 'video/quicktime' }));

      await uploadToS3Media({ buffer: mockBuffer, fileName: 'video.avi', resourceType: 'video' });
      expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({ ContentType: 'video/x-msvideo' }));
    });


    it('should throw an error if S3 upload fails', async () => {
      mockS3Upload.mockRejectedValue(new Error('S3 upload failed'));
      await expect(uploadToS3Media({ buffer: mockBuffer, fileName: mockFileName, resourceType: 'image' }))
        .rejects.toThrow('Failed to upload media: S3 upload failed');
    });

    it('should throw an error if sharp processing fails', async () => {
      mockSharpToBuffer.mockRejectedValue(new Error('Sharp processing failed'));
      await expect(uploadToS3Media({ buffer: mockBuffer, fileName: mockFileName, resourceType: 'image' }))
        .rejects.toThrow('Failed to upload media: Sharp processing failed');
    });

     it('should throw an error for invalid resourceType', async () => {
      await expect(uploadToS3Media({ buffer: mockBuffer, fileName: mockFileName, resourceType: 'document' as any }))
        .rejects.toThrow('Invalid resourceType specified. Must be "image" or "video".');
    });
  });

  describe('uploadVideoToS3', () => {
    const mockBuffer = Buffer.from('video-buffer');
    const mockFileName = 'my-reaction.mp4';

    it('should upload video to S3 with default folder "reactions"', async () => {
      const mockS3Location = `${mockS3Endpoint}/${mockS3BucketName}/reactions/timestamp-${mockFileName}`;
      mockS3Upload.mockResolvedValue({ Location: mockS3Location });

      const result = await uploadVideoToS3({ buffer: mockBuffer, fileName: mockFileName });

      expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: mockS3BucketName,
        Key: expect.stringMatching(/^reactions\/\d+-my-reaction\.mp4$/),
        Body: mockBuffer,
        ContentType: 'video/mp4',
      }));
      expect(result).toEqual({ secure_url: mockS3Location, duration: 0 });
    });

    it('should upload video to S3 with a specified folder', async () => {
      const folder = 'custom-folder';
      const mockS3Location = `${mockS3Endpoint}/${mockS3BucketName}/${folder}/timestamp-${mockFileName}`;
      mockS3Upload.mockResolvedValue({ Location: mockS3Location });

      const result = await uploadVideoToS3({ buffer: mockBuffer, fileName: mockFileName, folder });
      expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({
        Key: expect.stringMatching(/^custom-folder\/\d+-my-reaction\.mp4$/),
      }));
      expect(result).toEqual({ secure_url: mockS3Location, duration: 0 });
    });

    it('should handle various video content types by extension', async () => {
        mockS3Upload.mockResolvedValue({ Location: 'some-url' });
        await uploadVideoToS3({ buffer: mockBuffer, fileName: 'video.mov' });
        expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({ ContentType: 'video/quicktime' }));

        await uploadVideoToS3({ buffer: mockBuffer, fileName: 'video.webm' });
        expect(mockS3Upload).toHaveBeenCalledWith(expect.objectContaining({ ContentType: 'video/webm' }));
    });


    it('should throw an error if S3 upload fails', async () => {
      mockS3Upload.mockRejectedValue(new Error('S3 upload error'));
      await expect(uploadVideoToS3({ buffer: mockBuffer, fileName: mockFileName }))
        .rejects.toThrow('Failed to upload video: S3 upload error');
    });
  });

  describe('deleteFromS3', () => {
    const objectKey = 'path/to/object.jpg';

    it('should call S3 deleteObject with correct parameters', async () => {
      mockS3DeleteObject.mockResolvedValue({}); // Simulate successful deletion callback
      await deleteFromS3(objectKey);
      expect(mockS3DeleteObject).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: mockS3BucketName,
          Key: objectKey,
        })
      );
    });

    it('should resolve successfully if S3 returns NoSuchKey error', async () => {
      const noSuchKeyError = new Error('NoSuchKey');
      (noSuchKeyError as any).code = 'NoSuchKey'; // Add AWS error code property
      mockS3DeleteObject.mockRejectedValue(noSuchKeyError);

      // Spy on console.log to check for the specific log message
      const consoleSpy = jest.spyOn(console, 'log');
      await expect(deleteFromS3(objectKey)).resolves.toEqual({}); // Should resolve with empty object or AWS data
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(`Object not found (NoSuchKey), but resolving as success for key: ${objectKey}`));
      consoleSpy.mockRestore();
    });

    it('should reject if S3 deleteObject fails with an error other than NoSuchKey', async () => {
      const genericError = new Error('S3 delete failed');
      mockS3DeleteObject.mockRejectedValue(genericError);
      await expect(deleteFromS3(objectKey)).rejects.toThrow('S3 delete failed');
    });

    it('should resolve with empty object if no objectKey is provided', async () => {
        const consoleSpy = jest.spyOn(console, 'warn');
        await expect(deleteFromS3('')).resolves.toEqual({});
        expect(consoleSpy).toHaveBeenCalledWith('deleteFromS3: No objectKey provided.');
        consoleSpy.mockRestore();
    });
  });

  describe('deleteMultipleFromS3', () => {
    const objectKeys = ['key1.jpg', 'key2.png'];

    it('should call S3 deleteObjects with correctly formatted parameters', async () => {
      mockS3DeleteObjects.mockResolvedValue({ Deleted: [{ Key: 'key1.jpg'}, {Key: 'key2.png'}], Errors: [] });
      await deleteMultipleFromS3(objectKeys);
      expect(mockS3DeleteObjects).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: mockS3BucketName,
        Delete: {
          Objects: [{ Key: 'key1.jpg' }, { Key: 'key2.png' }],
          Quiet: false,
        },
      }));
    });

    it('should resolve with an empty-like result if objectKeys array is empty', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      const result = await deleteMultipleFromS3([]);
      expect(result).toEqual({ Deleted: [], Errors: [] });
      expect(mockS3DeleteObjects).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('deleteMultipleFromS3: No object keys provided for deletion.');
      consoleSpy.mockRestore();
    });

    it('should resolve and log warnings if S3 reports partial errors', async () => {
      const s3Response = {
        Deleted: [{ Key: 'key1.jpg' }],
        Errors: [{ Key: 'key2.png', Code: 'AccessDenied', Message: 'Access Denied' }],
      };
      mockS3DeleteObjects.mockResolvedValue(s3Response);
      const consoleWarnSpy = jest.spyOn(console, 'warn');

      const result = await deleteMultipleFromS3(objectKeys);
      expect(result).toEqual(s3Response);
      expect(consoleWarnSpy).toHaveBeenCalledWith('deleteMultipleFromS3: Some objects could not be deleted:');
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Key: key2.png, Code: AccessDenied, Message: Access Denied'));
      consoleWarnSpy.mockRestore();
    });

    it('should reject if the S3 deleteObjects operation itself fails', async () => {
      const operationError = new Error('S3 operation failed');
      mockS3DeleteObjects.mockRejectedValue(operationError);
      await expect(deleteMultipleFromS3(objectKeys)).rejects.toThrow('S3 operation failed');
    });
  });
});
