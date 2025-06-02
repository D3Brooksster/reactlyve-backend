import { Request, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { handleCloudinaryModerationWebhook } from './webhookController';
import { query } from '../config/database.config'; // Will be mocked

// Mock dependencies
jest.mock('../config/database.config', () => ({
  query: jest.fn(),
}));

jest.mock('cloudinary', () => {
  const originalCloudinary = jest.requireActual('cloudinary');
  return {
    ...originalCloudinary,
    v2: {
      ...originalCloudinary.v2,
      utils: {
        ...originalCloudinary.v2.utils,
        verifyNotificationSignature: jest.fn(),
      },
      config: jest.fn(), // Mock config if it's called within the controller
    },
  };
});


describe('handleCloudinaryModerationWebhook', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockStatus = jest.fn().mockReturnThis();
    mockJson = jest.fn().mockReturnThis();
    mockSend = jest.fn().mockReturnThis();
    mockRequest = {
      headers: {
        'x-cld-signature': 'test-signature',
        'x-cld-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      // rawBody will be set per test
    };
    mockResponse = {
      status: mockStatus,
      json: mockJson,
      send: mockSend,
    };
    // Reset mocks for each test
    (query as jest.Mock).mockClear();
    (cloudinary.utils.verifyNotificationSignature as jest.Mock).mockClear();
    // Ensure cloudinary.config is also mocked if it's being called inside controller
     if (typeof cloudinary.config === 'function') {
        (cloudinary.config as jest.Mock).mockClear();
     }
  });

  it('should return 400 if signature, timestamp, or body is missing', async () => {
    const testCases = [
      { ...mockRequest, headers: { ...mockRequest.headers, 'x-cld-signature': undefined } },
      { ...mockRequest, headers: { ...mockRequest.headers, 'x-cld-timestamp': undefined } },
      { ...mockRequest, rawBody: undefined },
    ];

    for (const req of testCases) {
      await handleCloudinaryModerationWebhook(req as Request, mockResponse as Response);
      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    }
  });

  it('should return 401 if signature verification fails', async () => {
    (cloudinary.utils.verifyNotificationSignature as jest.Mock).mockReturnValue(false);
    mockRequest.rawBody = Buffer.from(JSON.stringify({ test: 'body' }));

    await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

    expect(cloudinary.utils.verifyNotificationSignature).toHaveBeenCalled();
    expect(mockStatus).toHaveBeenCalledWith(401);
    expect(mockJson).toHaveBeenCalledWith({ error: 'Invalid signature' });
  });

  describe('Valid Signature', () => {
    beforeEach(() => {
      (cloudinary.utils.verifyNotificationSignature as jest.Mock).mockReturnValue(true);
    });

    it('Image Approved: should update messages table and return 200', async () => {
      const payload = {
        public_id: 'test_image_approved',
        moderation_status: 'approved',
        resource_type: 'image',
        moderation_response: {}, // Empty for approved
      };
      mockRequest.rawBody = Buffer.from(JSON.stringify(payload));
      (query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [{ id: 'message_id_1' }] });

      await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE messages'),
        ['approved', null, payload.public_id]
      );
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ message: 'Webhook received and processed' });
    });

    it('Image Rejected: should update messages table with details and imageurl NULL, return 200', async () => {
      const payload = {
        public_id: 'test_image_rejected',
        moderation_status: 'rejected',
        resource_type: 'image',
        moderation_response: { moderation_labels: [{ name: 'Explicit Nudity', confidence: 0.9 }] },
      };
      mockRequest.rawBody = Buffer.from(JSON.stringify(payload));
      (query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [{ id: 'message_id_2' }] });

      await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE messages'),
        ['rejected', JSON.stringify(payload.moderation_response.moderation_labels), payload.public_id]
      );
      // Check that imageurl is set to NULL: "imageurl = CASE WHEN $1 = 'approved' THEN original_imageurl ELSE NULL END"
      // The query itself handles this, so we check the status passed ('rejected')
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ message: 'Webhook received and processed' });
    });

    it('Video Approved: should update reactions table and return 200', async () => {
      const payload = {
        public_id: 'test_video_approved',
        moderation_status: 'approved',
        resource_type: 'video',
        moderation_response: {},
      };
      mockRequest.rawBody = Buffer.from(JSON.stringify(payload));
      (query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [{ id: 'reaction_id_1' }] });

      await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reactions'),
        ['approved', null, payload.public_id]
      );
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ message: 'Webhook received and processed' });
    });

    it('Video Rejected: should update reactions table with details and videourl NULL, return 200', async () => {
      const payload = {
        public_id: 'test_video_rejected',
        moderation_status: 'rejected',
        resource_type: 'video',
        moderation_response: { moderation_labels: [{ name: 'Violence', confidence: 0.8 }] },
      };
      mockRequest.rawBody = Buffer.from(JSON.stringify(payload));
      (query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [{ id: 'reaction_id_2' }] });

      await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reactions'),
        ['rejected', JSON.stringify(payload.moderation_response.moderation_labels), payload.public_id]
      );
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ message: 'Webhook received and processed' });
    });

    it('should return 200 if moderation_status is pending', async () => {
      const payload = {
        public_id: 'test_pending',
        moderation_status: 'pending',
        resource_type: 'image',
      };
      mockRequest.rawBody = Buffer.from(JSON.stringify(payload));

      await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

      expect(query).not.toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ message: 'Pending notification received, no action taken.' });
    });


    it('Error during DB update: should return 500', async () => {
      const payload = {
        public_id: 'test_db_error',
        moderation_status: 'approved',
        resource_type: 'image',
      };
      mockRequest.rawBody = Buffer.from(JSON.stringify(payload));
      (query as jest.Mock).mockRejectedValue(new Error('DB connection error'));

      await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

      expect(query).toHaveBeenCalled();
      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Failed to process webhook' });
    });

    it('Public ID not found in DB: should log and return 200', async () => {
      const payload = {
        public_id: 'test_not_found',
        moderation_status: 'approved',
        resource_type: 'image',
      };
      mockRequest.rawBody = Buffer.from(JSON.stringify(payload));
      (query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] }); // Simulate 0 rows affected
      const consoleLogSpy = jest.spyOn(console, 'log'); // Spy on console.log

      await handleCloudinaryModerationWebhook(mockRequest as Request, mockResponse as Response);

      expect(query).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(`No message found with original_imageurl containing public_id: ${payload.public_id}`));
      expect(mockStatus).toHaveBeenCalledWith(200);
      expect(mockJson).toHaveBeenCalledWith({ message: 'Webhook received and processed' });

      consoleLogSpy.mockRestore();
    });
  });
});
