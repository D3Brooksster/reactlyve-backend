import { Request, Response } from 'express';
import { recordReaction } from './messageController';
import { query } from '../config/database.config';
import { uploadVideoToCloudinary } from '../utils/cloudinaryUtils';

jest.mock('../config/database.config');
jest.mock('../utils/cloudinaryUtils');

const mockQuery = query as jest.Mock;
const mockUploadVideo = uploadVideoToCloudinary as jest.Mock;

describe('recordReaction', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let status: jest.Mock;
  let json: jest.Mock;

  beforeEach(() => {
    status = jest.fn().mockReturnThis();
    json = jest.fn().mockReturnThis();
    mockRes = { status, json };

    mockReq = {
      params: { id: 'message-1' },
      file: { buffer: Buffer.from('data'), size: 100 } as Express.Multer.File,
      body: {},
    };
    jest.clearAllMocks();
  });

  it('returns 404 when message is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await recordReaction(mockReq as Request, mockRes as Response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Message not found.' });
    expect(mockUploadVideo).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is provided', async () => {
    mockReq.file = undefined;
    mockQuery.mockResolvedValueOnce({ rows: [{ actual_message_id: 'm1', senderid: 's1' }], rowCount: 1 });

    await recordReaction(mockReq as Request, mockRes as Response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'No reaction video provided' });
  });

  it('records reaction and responds with 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ actual_message_id: 'm1', senderid: 's1' }], rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [{ moderate_videos: false }], rowCount: 1 });
    mockUploadVideo.mockResolvedValueOnce({ secure_url: 'http://v', thumbnail_url: 'http://t', duration: 5 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'reaction-1' }], rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await recordReaction(mockReq as Request, mockRes as Response);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Reaction recorded successfully',
      reactionId: 'reaction-1',
    });
    expect(mockUploadVideo).toHaveBeenCalledWith(mockReq.file!.buffer, mockReq.file!.size, 'reactions', {});
  });
});
