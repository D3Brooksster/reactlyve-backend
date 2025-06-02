import { Request, Response } from 'express';
import { getReactionById, getMessageById, getAllMessages, getMessageByShareableLink, verifyMessagePasscode } from './messageController'; // Import other functions as needed
import { query } from '../config/database.config'; // Will be mocked

// Mock dependencies
jest.mock('../config/database.config', () => ({
  query: jest.fn(),
}));

// Mock cloudinary utilities if they were to be used directly in GET handlers (not typical for GET)
// jest.mock('../utils/cloudinaryUtils', () => ({
//   extractPublicIdAndResourceType: jest.fn(),
//   deleteFromCloudinary: jest.fn(),
//   uploadToCloudinarymedia: jest.fn(),
//   uploadVideoToCloudinary: jest.fn(),
// }));

// Mock cloudinaryUtils for upload endpoint tests
jest.mock('../utils/cloudinaryUtils', () => ({
  uploadToCloudinarymedia: jest.fn(),
  uploadVideoToCloudinary: jest.fn(),
  deleteFromCloudinary: jest.fn(), // Mock other functions if they are called by methods under test indirectly
  extractPublicIdAndResourceType: jest.fn(),
}));


describe('Message Controller GET Endpoints', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;

  beforeEach(() => {
    mockStatus = jest.fn().mockReturnThis();
    mockJson = jest.fn().mockReturnThis();
    mockRequest = {
      params: {},
      query: {},
      body: {},
      user: { id: 'test-user-id', role: 'user' } // Mock user for authenticated routes
    };
    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };
    (query as jest.Mock).mockClear();
  });

  describe('getReactionById', () => {
    it('should return reaction with formatted reason URL if moderation_status is rejected and details are valid JSON', async () => {
      const reactionData = {
        id: 'reaction-id-1',
        messageid: 'message-id-1',
        videourl: 'http://original.url/video.mp4',
        original_videourl: 'http://original.url/video.mp4',
        thumbnailurl: 'http://original.url/thumb.jpg',
        duration: 15,
        name: 'Test Reaction Rejected Valid JSON',
        moderation_status: 'rejected',
        moderation_details: JSON.stringify([{ "Name": "Explicit Nudity", "Confidence": 0.9 }]),
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      (query as jest.Mock).mockResolvedValue({ rows: [reactionData], rowCount: 1 });
      mockRequest.params = { id: 'reaction-id-1' };

      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        videoUrl: 'moderation_failed_explicit-nudity',
        thumbnailUrl: 'moderation_failed_thumbnail_explicit-nudity',
        moderationStatus: 'rejected',
        moderationDetails: reactionData.moderation_details,
      }));
    });

    it('should return reaction with default reason URL if moderation_status is rejected and details are invalid JSON', async () => {
      const reactionData = {
        id: 'reaction-id-1.1',
        messageid: 'message-id-1.1',
        videourl: 'http://original.url/video_invalid.mp4',
        original_videourl: 'http://original.url/video_invalid.mp4',
        thumbnailurl: 'http://original.url/thumb_invalid.jpg',
        duration: 16,
        name: 'Test Reaction Rejected Invalid JSON',
        moderation_status: 'rejected',
        moderation_details: 'this is not json',
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      (query as jest.Mock).mockResolvedValue({ rows: [reactionData], rowCount: 1 });
      mockRequest.params = { id: 'reaction-id-1.1' };
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); // Suppress console.warn

      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        videoUrl: 'moderation_failed_content-policy',
        thumbnailUrl: 'moderation_failed_thumbnail_content-policy',
        moderationStatus: 'rejected',
      }));
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
    
    it('should return reaction with default reason URL if moderation_status is failed', async () => {
      const reactionData = {
        id: 'reaction-id-1.2',
        messageid: 'message-id-1.2',
        videourl: 'http://original.url/video_failed.mp4',
        original_videourl: 'http://original.url/video_failed.mp4',
        thumbnailurl: 'http://original.url/thumb_failed.jpg',
        duration: 17,
        name: 'Test Reaction Failed',
        moderation_status: 'failed',
        moderation_details: JSON.stringify({ error: 'Rekognition failed processing' }),
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      (query as jest.Mock).mockResolvedValue({ rows: [reactionData], rowCount: 1 });
      mockRequest.params = { id: 'reaction-id-1.2' };
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});


      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        videoUrl: 'moderation_failed_content-policy', // Default because the error is not a label Name
        thumbnailUrl: 'moderation_failed_thumbnail_content-policy',
        moderationStatus: 'failed',
      }));
      consoleWarnSpy.mockRestore();
    });

    it('should return reaction with original URL if moderation_status is approved', async () => {
      const reactionData = {
        id: 'reaction-id-2',
        messageid: 'message-id-2',
        videourl: 'http://original.url/video2.mp4',
        original_videourl: 'http://original.url/video2.mp4',
        thumbnailurl: 'http://original.url/thumb2.jpg',
        duration: 10,
        name: 'Approved Reaction',
        moderation_status: 'approved',
        moderation_details: null,
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      (query as jest.Mock).mockResolvedValue({ rows: [reactionData], rowCount: 1 });
      mockRequest.params = { id: 'reaction-id-2' };

      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        videoUrl: reactionData.videourl,
        thumbnailUrl: reactionData.thumbnailurl,
        moderationStatus: 'approved',
      }));
    });
    
    it('should return reaction with original URL if moderation_status is pending', async () => {
      const reactionData = {
        id: 'reaction-id-3',
        messageid: 'message-id-3',
        videourl: 'http://original.url/video3.mp4',
        original_videourl: 'http://original.url/video3.mp4',
        thumbnailurl: 'http://original.url/thumb3.jpg',
        duration: 12,
        name: 'Pending Reaction',
        moderation_status: 'pending',
        moderation_details: null,
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      (query as jest.Mock).mockResolvedValue({ rows: [reactionData], rowCount: 1 });
      mockRequest.params = { id: 'reaction-id-3' };

      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        videoUrl: reactionData.videourl, 
        thumbnailUrl: reactionData.thumbnailurl,
        moderationStatus: 'pending',
      }));
    });

    it('should return reaction with original URL if moderation_status is moderation_off', async () => {
      const reactionData = {
        id: 'reaction-id-4',
        messageid: 'message-id-4',
        videourl: 'http://original.url/video4.mp4', // original_videourl would be NULL
        original_videourl: null, 
        thumbnailurl: 'http://original.url/thumb4.jpg',
        duration: 18,
        name: 'Moderation Off Reaction',
        moderation_status: 'moderation_off',
        moderation_details: null,
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      (query as jest.Mock).mockResolvedValue({ rows: [reactionData], rowCount: 1 });
      mockRequest.params = { id: 'reaction-id-4' };

      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        videoUrl: reactionData.videourl,
        thumbnailUrl: reactionData.thumbnailurl,
        moderationStatus: 'moderation_off',
      }));
    });

    it('should return 404 if reaction not found', async () => {
      (query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
      mockRequest.params = { id: 'reaction-id-nonexistent' };

      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Reaction not found' });
    });
  });

  // TODO: Add similar describe blocks and tests for:
  // - getMessageById (testing imageurl transformation and moderation fields)
  // - getAllMessages (testing transformations within the mapped arrays of messages and their reactions)
  // - getMessageByShareableLink (for cases with and without passcode)
  // - verifyMessagePasscode (for the message object returned on success)

  describe('getMessageById', () => {
    it('should return message with formatted reason URL if moderation_status is rejected (image)', async () => {
      const messageData = {
        id: 'message-id-1',
        imageurl: 'http://original.url/image.jpg',
        original_imageurl: 'http://original.url/image.jpg',
        moderation_status: 'rejected',
        moderation_details: JSON.stringify([{ "Name": "Explicit Nudity", "Confidence": 0.9 }]),
        // ... other message fields
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
        reactions: [] // Assume no reactions for simplicity here, or mock them as in getAllMessages
      };
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [messageData], rowCount: 1 }) // For message query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // For reactions query

      mockRequest.params = { id: 'message-id-1' };
      await getMessageById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        imageUrl: 'moderation_failed_explicit-nudity',
        moderationStatus: 'rejected',
      }));
    });

    it('should return message with original URL if moderation_status is moderation_off (image)', async () => {
      const messageData = {
        id: 'message-id-2',
        imageurl: 'http://original.url/image2.jpg',
        original_imageurl: null, // Should be null if moderation is off from the start
        moderation_status: 'moderation_off',
        moderation_details: null,
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
        reactions: []
      };
      (query as jest.Mock)
        .mockResolvedValueOnce({ rows: [messageData], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      mockRequest.params = { id: 'message-id-2' };
      await getMessageById(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        imageUrl: messageData.imageurl,
        moderationStatus: 'moderation_off',
      }));
    });
     // TODO: Add tests for approved, pending, not found, and cases with reactions for getMessageById
  });
});

// Import sendMessage and uploadReactionVideo for testing upload endpoints
import { sendMessage, uploadReactionVideo } from './messageController'; 
import { uploadToCloudinarymedia, uploadVideoToCloudinary } from '../utils/cloudinaryUtils'; // To access the mock

describe('Message Controller Upload Endpoints', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;
  let mockNext: jest.Mock;


  beforeEach(() => {
    mockStatus = jest.fn().mockReturnThis();
    mockJson = jest.fn().mockReturnThis();
    mockNext = jest.fn(); // For error handling if any
    mockRequest = {
      body: {},
      file: {
        buffer: Buffer.from('testfile'),
        mimetype: 'image/jpeg', // Default, can be overridden
        size: 12345,
      } as Express.Multer.File, // Cast to satisfy type, actual properties depend on test
      user: { id: 'test-user-id', role: 'user' }
    };
    mockResponse = {
      status: mockStatus,
      json: mockJson,
    };
    (query as jest.Mock).mockClear();
    (uploadToCloudinarymedia as jest.Mock).mockClear().mockResolvedValue('mock-media-url');
    (uploadVideoToCloudinary as jest.Mock).mockClear().mockResolvedValue({ secure_url: 'mock-video-url', thumbnail_url: 'mock-thumbnail-url', duration: 10 });
  });

  describe('sendMessage', () => {
    it('should call uploadToCloudinarymedia with aws_rek when enableModeration is true for image', async () => {
      mockRequest.body = { content: 'Test message', enableModeration: true };
      (query as jest.Mock).mockResolvedValue({ rows: [{ id: 'new-message-id', moderation_status: 'pending' }], rowCount: 1 });
      
      // Need to simulate the multer middleware behavior
      // For simplicity, directly call the async callback that multer would invoke
      const multerUpload = sendMessage; // sendMessage is already the (req, res, (err) => {...}) structure
      await new Promise<void>(resolve => {
        multerUpload(mockRequest as Request, mockResponse as Response, (err?:any) => {
          resolve();
        });
      });

      expect(uploadToCloudinarymedia).toHaveBeenCalledWith(expect.any(Buffer), 'image', 'aws_rek');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO messages'),
        expect.arrayContaining([expect.anything(), 'pending']) // Check moderation_status
      );
      expect(mockStatus).toHaveBeenCalledWith(201);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({ moderationStatus: 'pending' }));
    });

    it('should call uploadToCloudinarymedia without moderation when enableModeration is false for image', async () => {
      mockRequest.body = { content: 'Test message no mod', enableModeration: false };
       (query as jest.Mock).mockResolvedValue({ rows: [{ id: 'new-message-id-no-mod', moderation_status: 'moderation_off' }], rowCount: 1 });

      const multerUpload = sendMessage;
      await new Promise<void>(resolve => {
        multerUpload(mockRequest as Request, mockResponse as Response, (err?:any) => {
          resolve();
        });
      });
      
      expect(uploadToCloudinarymedia).toHaveBeenCalledWith(expect.any(Buffer), 'image', undefined);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO messages'),
        expect.arrayContaining([expect.anything(), 'moderation_off']) // Check moderation_status
      );
      expect(mockStatus).toHaveBeenCalledWith(201);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({ moderationStatus: 'moderation_off' }));
    });
  });

  describe('uploadReactionVideo', () => {
    beforeEach(() => {
        mockRequest.params = { reactionId: 'test-reaction-id' };
    });

    it('should call uploadVideoToCloudinary with aws_rek when enableModeration is true', async () => {
        mockRequest.body = { enableModeration: true };
        (query as jest.Mock).mockResolvedValue({ rowCount: 1 }); // For the UPDATE query

        await uploadReactionVideo(mockRequest as Request, mockResponse as Response);

        expect(uploadVideoToCloudinary).toHaveBeenCalledWith(expect.any(Buffer), expect.any(Number), 'reactions', 'aws_rek');
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE reactions'),
            expect.arrayContaining([expect.anything(), 'pending']) // Checks original_videourl, moderation_status
        );
        expect(mockStatus).toHaveBeenCalledWith(200);
    });

    it('should call uploadVideoToCloudinary without moderation when enableModeration is false', async () => {
        mockRequest.body = { enableModeration: false };
        (query as jest.Mock).mockResolvedValue({ rowCount: 1 });

        await uploadReactionVideo(mockRequest as Request, mockResponse as Response);

        expect(uploadVideoToCloudinary).toHaveBeenCalledWith(expect.any(Buffer), expect.any(Number), 'reactions', undefined);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE reactions'),
            expect.arrayContaining([expect.anything(), 'moderation_off']) // Checks original_videourl, moderation_status
        );
        expect(mockStatus).toHaveBeenCalledWith(200);
    });
  });
});
