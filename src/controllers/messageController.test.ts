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
    it('should return reaction with transformed URL if moderation_status is rejected', async () => {
      const reactionData = {
        id: 'reaction-id-1',
        messageid: 'message-id-1',
        videourl: 'http://original.url/video.mp4',
        original_videourl: 'http://original.url/video.mp4',
        thumbnailurl: 'http://original.url/thumb.jpg',
        duration: 15,
        name: 'Test Reaction',
        moderation_status: 'rejected',
        moderation_details: 'unsafe content here',
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      (query as jest.Mock).mockResolvedValue({ rows: [reactionData], rowCount: 1 });
      mockRequest.params = { id: 'reaction-id-1' };

      await getReactionById(mockRequest as Request, mockResponse as Response);

      expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, messageid, videourl, thumbnailurl, duration, name, createdat, updatedat, original_videourl, moderation_status, moderation_details'), ['reaction-id-1']);
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({
        id: reactionData.id,
        videoUrl: 'moderation_failed_[unsafe content here]',
        thumbnailUrl: 'moderation_failed_thumbnail_[unsafe content here]',
        moderationStatus: 'rejected',
        moderationDetails: 'unsafe content here',
      }));
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
        id: reactionData.id,
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
        id: reactionData.id,
        videoUrl: reactionData.videourl, // Should be original_videourl if videourl was NULL
        thumbnailUrl: reactionData.thumbnailurl,
        moderationStatus: 'pending',
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
});
