// Import functions to be tested
const { uploadToCloudinarymedia, uploadVideoToCloudinary } = require('./cloudinaryUtils');
const cloudinaryNodeModule = require('cloudinary'); // Changed import
// Note: { Readable } is NOT imported at the top level here

jest.mock('cloudinary', () => {
  const originalCloudinary = jest.requireActual('cloudinary');
  const { Readable: FactoryScopedReadable } = require('stream');

  // This function is now defined and scoped entirely within jest.mock
  const mockUploadStream = jest.fn((options, callback) => {
    if (callback) {
      callback(null, {
        secure_url: 'mock_video_secure_url',
        public_id: 'mock_public_id',
        version: '123456',
        duration: 10.0
      });
    }
    const mockStream = new FactoryScopedReadable();
    mockStream._read = () => {};
    mockStream.on('data', () => {});
    mockStream.on('end', () => {});
    return mockStream;
  });

  return {
    ...originalCloudinary, // Spread original exports if any are used directly and not v2
    v2: {
      ...originalCloudinary.v2,
      uploader: {
        ...originalCloudinary.v2.uploader,
        upload: jest.fn((_dataUri, options, callback) => {
          if (callback) {
            callback(null, { secure_url: 'mock_image_secure_url' });
          }
          return Promise.resolve({ secure_url: 'mock_image_secure_url' });
        }),
        upload_stream: mockUploadStream, // Use the locally defined mock function
      },
      config: jest.fn().mockImplementation(() => ({ cloud_name: 'default_test_cloud' })),
    },
  };
});

describe('uploadToCloudinarymedia', () => {
  const mockBuffer = Buffer.from('test-image-buffer');

  beforeEach(() => {
    cloudinaryNodeModule.v2.uploader.upload.mockClear(); // Use new import
    cloudinaryNodeModule.v2.config.mockClear();         // Use new import
    cloudinaryNodeModule.v2.config.mockReturnValue({ cloud_name: 'media_test_cloud' });
  });

  test('should include eager transformations for image uploads', async () => {
    await uploadToCloudinarymedia(mockBuffer, 'image');
    expect(cloudinaryNodeModule.v2.uploader.upload).toHaveBeenCalledTimes(1);
    const callOptions = cloudinaryNodeModule.v2.uploader.upload.mock.calls[0][1];
    expect(callOptions.resource_type).toBe('image');
    expect(callOptions.eager).toEqual([{ fetch_format: 'auto' }, { quality: 'auto' }]);
    expect(callOptions.folder).toBe('messages');
  });

  test('should not include eager transformations for video uploads by default in this function', async () => {
    await uploadToCloudinarymedia(mockBuffer, 'video');
    expect(cloudinaryNodeModule.v2.uploader.upload).toHaveBeenCalledTimes(1);
    const callOptions = cloudinaryNodeModule.v2.uploader.upload.mock.calls[0][1];
    expect(callOptions.resource_type).toBe('video');
    expect(callOptions.eager).toBeUndefined();
    expect(callOptions.folder).toBe('messages');
  });

  test('should throw an error if Cloudinary image upload fails', async () => {
    const errorMessage = 'Cloudinary image error';
    cloudinaryNodeModule.v2.uploader.upload.mockImplementationOnce((_dataUri, _options, callback) => {
      if (callback) {
        callback(new Error(errorMessage), null);
      }
    });
    await expect(uploadToCloudinarymedia(mockBuffer, 'image')).rejects.toThrow('Failed to upload file to Cloudinary');
  });
});


describe('uploadVideoToCloudinary', () => {
  const { Readable } = require('stream');
  const mockVideoBuffer = Buffer.from('test-video-buffer');
  const smallFileSize = 5 * 1024 * 1024;
  const largeFileSize = 15 * 1024 * 1024;
  const defaultFolder = 'reactions';

  const expectedThumbnailTransformation = {
    format: "jpg", crop: "thumb", width: 200, height: 150, start_offset: "0", quality: "auto"
  };

  beforeEach(() => {
    cloudinaryNodeModule.v2.uploader.upload_stream.mockClear(); // Use new import
    cloudinaryNodeModule.v2.config.mockClear();                // Use new import
    cloudinaryNodeModule.v2.config.mockReturnValue({ cloud_name: 'video_test_cloud' });

    cloudinaryNodeModule.v2.uploader.upload_stream.mockImplementation((options, callback) => {
      if (callback) {
        callback(null, {
          secure_url: 'default_video_url',
          public_id: 'default_public_id',
          version: 'def123',
          duration: 10.5
        });
      }
      const stream = new Readable();
      stream._read = () => {};
      process.nextTick(() => {
        stream.emit('data', mockVideoBuffer);
        stream.emit('end');
      });
      return stream;
    });
  });

  test('should include correct eager transformations for small videos', async () => {
    await uploadVideoToCloudinary(mockVideoBuffer, smallFileSize, defaultFolder);
    expect(cloudinaryNodeModule.v2.uploader.upload_stream).toHaveBeenCalledTimes(1);
    const callOptions = cloudinaryNodeModule.v2.uploader.upload_stream.mock.calls[0][0];
    const expectedSmallVideoTransformations = [{ fetch_format: 'auto' }];
    expect(callOptions.eager).toEqual(expect.arrayContaining([
      ...expectedSmallVideoTransformations,
      expectedThumbnailTransformation
    ]));
    expect(callOptions.eager.length).toBe(expectedSmallVideoTransformations.length + 1);
  });

  test('should include correct eager transformations for large videos', async () => {
    await uploadVideoToCloudinary(mockVideoBuffer, largeFileSize, defaultFolder);
    expect(cloudinaryNodeModule.v2.uploader.upload_stream).toHaveBeenCalledTimes(1);
    const callOptions = cloudinaryNodeModule.v2.uploader.upload_stream.mock.calls[0][0];
    const expectedLargeVideoTransformations = [
      { width: 1280, crop: "limit" }, { quality: 'auto' }, { fetch_format: 'auto' }
    ];
    expect(callOptions.eager).toEqual(expect.arrayContaining([
      ...expectedLargeVideoTransformations,
      expectedThumbnailTransformation
    ]));
    expect(callOptions.eager.length).toBe(expectedLargeVideoTransformations.length + 1);
  });

  test('should resolve with secure_url, thumbnail_url, and duration', async () => {
    const result = await uploadVideoToCloudinary(mockVideoBuffer, smallFileSize, defaultFolder);
    expect(result).toHaveProperty('secure_url', 'default_video_url');
    expect(result).toHaveProperty('thumbnail_url');
    expect(result.duration).toBe(11);
  });

  test('should construct thumbnail_url correctly', async () => {
    const specificPublicId = 'thumb_test_id';
    const specificVersion = 'thumb_v1';
    const specificCloudName = 'thumb_cloud';

    cloudinaryNodeModule.v2.config.mockReturnValue({ cloud_name: specificCloudName }); // Use new import
    cloudinaryNodeModule.v2.uploader.upload_stream.mockImplementation((options, callback) => { // Use new import
      callback(null, {
        secure_url: 'video_url_for_thumb_test',
        public_id: specificPublicId,
        version: specificVersion,
        duration: 5.2
      });
      const stream = new Readable();
      stream._read = () => {};
      process.nextTick(() => {
        stream.emit('data', mockVideoBuffer);
        stream.emit('end');
      });
      return stream;
    });

    const result = await uploadVideoToCloudinary(mockVideoBuffer, smallFileSize, defaultFolder);
    const expectedThumbnailUrl = `https://res.cloudinary.com/${specificCloudName}/video/upload/c_thumb,f_jpg,h_150,q_auto,so_0,w_200/v${specificVersion}/${specificPublicId}.jpg`;
    expect(result.thumbnail_url).toBe(expectedThumbnailUrl);
    expect(result.duration).toBe(5);
  });

  test('should handle missing public_id or version for thumbnail URL construction', async () => {
    cloudinaryNodeModule.v2.uploader.upload_stream.mockImplementation((options, callback) => { // Use new import
      callback(null, { secure_url: 'missing_param_video_url', duration: 3.8 });
      const stream = new Readable();
      stream._read = () => {};
      process.nextTick(() => {
        stream.emit('data', mockVideoBuffer);
        stream.emit('end');
      });
      return stream;
    });

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await uploadVideoToCloudinary(mockVideoBuffer, smallFileSize, defaultFolder);

    expect(result.thumbnail_url).toBe('');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Could not construct thumbnail URL: public_id or version missing from Cloudinary result.',
      expect.any(Object)
    );
    consoleWarnSpy.mockRestore();
  });

  test('should reject if upload_stream returns an error', async () => {
    const errorMessage = 'Cloudinary stream error test';
    cloudinaryNodeModule.v2.uploader.upload_stream.mockImplementation((options, callback) => { // Use new import
      callback(new Error(errorMessage), null);
      const stream = new Readable();
      stream._read = () => {};
      return stream;
    });

    await expect(uploadVideoToCloudinary(mockVideoBuffer, smallFileSize, defaultFolder))
      .rejects.toThrow(errorMessage);
  });
});
