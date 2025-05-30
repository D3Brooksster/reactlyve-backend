import { updateMessage } from './messageController';
import { query } from '../config/database.config';
import { Request, Response } from 'express';
import { AppUser } from '../entity/User';

// Mock the database query function
jest.mock('../config/database.config', () => ({
  query: jest.fn(),
}));

// Mock Express Request and Response
const mockRequest = (params = {}, body = {}, user: AppUser | null = null) => {
  const req = {} as Request;
  req.params = params as any;
  req.body = body;
  if (user) {
    req.user = user;
  }
  return req;
};

const mockResponse = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('updateMessage Controller', () => {
  let req: Request;
  let res: Response;
  const mockQuery = query as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks(); // Clear mocks before each test
    res = mockResponse();
  });

  describe('Authentication', () => {
    it('should return 401 if user is not authenticated', async () => {
      req = mockRequest({ id: 'test-message-id' }, { passcode: 'new-pass' });
      // req.user is intentionally not set
      await updateMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required to update messages.' });
    });
  });

  describe('Error Handling - Message Ownership/Existence', () => {
    const mockUser: AppUser = { id: 'user-123', name: 'Test User', email: 'test@example.com', role: 'user', blocked: false, created_at: new Date(), updated_at: new Date() };
    const messageId = 'message-abc';

    it('should return 404 if the message to update is not found', async () => {
      req = mockRequest({ id: messageId }, { passcode: 'new-pass' }, mockUser);
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // No message found

      await updateMessage(req, res);
      expect(mockQuery).toHaveBeenCalledTimes(1); // Only initial fetch attempt
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Message not found' });
    });

    it('should return 403 if the user is not the sender of the message', async () => {
      const originalMessageFromOtherUser = {
        id: messageId,
        senderid: 'other-user-id', // Different sender
        content: 'Original content',
        passcode: 'old-pass',
        reaction_length: 15,
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      req = mockRequest({ id: messageId }, { passcode: 'new-pass' }, mockUser);
      mockQuery.mockResolvedValueOnce({ rows: [originalMessageFromOtherUser], rowCount: 1 });

      await updateMessage(req, res);
      expect(mockQuery).toHaveBeenCalledTimes(1); // Only initial fetch attempt
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: You can only update your own messages' });
    });

    it('should return 404 if update query affects 0 rows (e.g. message deleted between fetch and update)', async () => {
      const originalMessage = {
        id: messageId,
        senderid: mockUser.id,
        content: 'Original content',
        passcode: 'old-pass',
        reaction_length: 15,
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      };
      req = mockRequest({ id: messageId }, { passcode: 'new-pass' }, mockUser);

      mockQuery
        .mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 }) // Initial fetch succeeds
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Update affects 0 rows

      await updateMessage(req, res);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Message not found or update failed due to ownership mismatch.' });
    });
  });

  describe('Error Handling - Invalid Input', () => {
    const mockUser: AppUser = { id: 'user-123', name: 'Test User', email: 'test@example.com', role: 'user', blocked: false, created_at: new Date(), updated_at: new Date() };
    const messageId = 'message-abc';
     const originalMessage = { // Needed for cases where initial fetch occurs
      id: messageId,
      senderid: mockUser.id,
      content: 'Original content',
      passcode: 'old-pass',
      reaction_length: 15,
      createdat: new Date().toISOString(),
      updatedat: new Date().toISOString(),
    };

    it('should return 400 if no fields to update are provided', async () => {
      req = mockRequest({ id: messageId }, {}, mockUser); // Empty body

      // Mock initial fetch because ownership check happens before body validation in the code
      mockQuery.mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 });


      await updateMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'At least one field (passcode or reaction_length) must be provided for update.' });
    });

    it('should return 400 if reaction_length is too small', async () => {
      req = mockRequest({ id: messageId }, { reaction_length: 5 }, mockUser);
      mockQuery.mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 });
      await updateMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid reaction_length. Must be an integer between 10 and 30.' });
    });

    it('should return 400 if reaction_length is too large', async () => {
      req = mockRequest({ id: messageId }, { reaction_length: 35 }, mockUser);
      mockQuery.mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 });
      await updateMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid reaction_length. Must be an integer between 10 and 30.' });
    });

    it('should return 400 if reaction_length is not an integer', async () => {
      req = mockRequest({ id: messageId }, { reaction_length: 'not-a-number' }, mockUser);
      mockQuery.mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 });
      await updateMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid reaction_length. Must be an integer between 10 and 30.' });
    });
  });

  describe('Successful Updates', () => {
    const mockUser: AppUser = { id: 'user-123', name: 'Test User', email: 'test@example.com', role: 'user', blocked: false, created_at: new Date(), updated_at: new Date() };
    const messageId = 'message-abc';
    const originalMessage = {
      id: messageId,
      senderid: mockUser.id,
      content: 'Original content',
      imageurl: null,
      mediatype: null,
      shareablelink: 'http://share.link/abc',
      passcode: 'old-pass',
      reaction_length: 15,
      createdat: new Date().toISOString(),
      updatedat: new Date().toISOString(),
    };

    it('should update only passcode successfully', async () => {
      req = mockRequest({ id: messageId }, { passcode: 'new-pass' }, mockUser);
      const updatedDbMessage = { ...originalMessage, passcode: 'new-pass', updatedat: new Date().toISOString() };

      mockQuery
        .mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 }) // Initial fetch
        .mockResolvedValueOnce({ rows: [updatedDbMessage], rowCount: 1 }); // Update returning

      await updateMessage(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1][0]).toContain('SET passcode = $1, updatedat = NOW() WHERE id = $2 AND senderid = $3');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        id: messageId,
        passcode: 'new-pass',
        reactionLength: originalMessage.reaction_length, // Should remain unchanged
        updatedAt: updatedDbMessage.updatedat,
      }));
    });

    it('should update only reaction_length successfully', async () => {
      req = mockRequest({ id: messageId }, { reaction_length: 25 }, mockUser);
      const updatedDbMessage = { ...originalMessage, reaction_length: 25, updatedat: new Date().toISOString() };

      mockQuery
        .mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedDbMessage], rowCount: 1 });

      await updateMessage(req, res);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1][0]).toContain('SET reaction_length = $1, updatedat = NOW() WHERE id = $2 AND senderid = $3');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        id: messageId,
        passcode: originalMessage.passcode, // Should remain unchanged
        reactionLength: 25,
        updatedAt: updatedDbMessage.updatedat,
      }));
    });

    it('should update both passcode and reaction_length successfully', async () => {
      req = mockRequest({ id: messageId }, { passcode: 'new-pass-both', reaction_length: 22 }, mockUser);
      const updatedDbMessage = { ...originalMessage, passcode: 'new-pass-both', reaction_length: 22, updatedat: new Date().toISOString() };

      mockQuery
        .mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedDbMessage], rowCount: 1 });

      await updateMessage(req, res);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1][0]).toContain('SET passcode = $1, reaction_length = $2, updatedat = NOW() WHERE id = $3 AND senderid = $4');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        id: messageId,
        passcode: 'new-pass-both',
        reactionLength: 22,
        updatedAt: updatedDbMessage.updatedat,
      }));
    });

    it('should update passcode to null successfully', async () => {
      req = mockRequest({ id: messageId }, { passcode: null }, mockUser);
      const updatedDbMessage = { ...originalMessage, passcode: null, updatedat: new Date().toISOString() };

      mockQuery
        .mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updatedDbMessage], rowCount: 1 });

      await updateMessage(req, res);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1][0]).toContain('SET passcode = $1, updatedat = NOW() WHERE id = $2 AND senderid = $3');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        id: messageId,
        passcode: null,
        updatedAt: updatedDbMessage.updatedat,
      }));
    });
  });

  describe('Security - Unintended Updates', () => {
    const mockUser: AppUser = { id: 'user-123', name: 'Test User', email: 'test@example.com', role: 'user', blocked: false, created_at: new Date(), updated_at: new Date() };
    const messageId = 'message-sec';
    const originalMessage = {
      id: messageId,
      senderid: mockUser.id,
      content: 'Original Secure Content',
      imageurl: 'http://example.com/original.jpg',
      mediatype: 'image',
      shareablelink: 'http://share.link/sec',
      passcode: 'secure-old-pass',
      reaction_length: 12,
      createdat: new Date().toISOString(),
      updatedat: new Date().toISOString(),
    };

    it('should not update content or other non-allowed fields even if provided', async () => {
      req = mockRequest(
        { id: messageId },
        {
          passcode: 'secure-new-pass',
          reaction_length: 28,
          content: 'Maliciously trying to change content', // Should be ignored
          imageurl: 'http://hacker.com/new.jpg', // Should be ignored
          senderid: 'other-user-trying-to-steal' // Should be ignored by WHERE clause logic
        },
        mockUser
      );

      const expectedDbUpdate = {
        ...originalMessage,
        passcode: 'secure-new-pass',
        reaction_length: 28,
        updatedat: new Date().toISOString()
      };

      mockQuery
        .mockResolvedValueOnce({ rows: [originalMessage], rowCount: 1 }) // Initial fetch
        .mockResolvedValueOnce({ rows: [expectedDbUpdate], rowCount: 1 }); // Update returning

      await updateMessage(req, res);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      // Check that the SQL query only contains passcode and reaction_length in SET
      const updateQueryString = mockQuery.mock.calls[1][0] as string;
      expect(updateQueryString).toContain('SET passcode = $1, reaction_length = $2, updatedat = NOW()');
      const setClause = updateQueryString.substring(0, updateQueryString.indexOf(' WHERE '));
      expect(setClause).not.toContain('content =');
      expect(setClause).not.toContain('imageurl =');
      expect(setClause).not.toContain('senderid ='); // Ensure senderid is not in the SET part

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        id: messageId,
        passcode: 'secure-new-pass',
        reactionLength: 28,
        content: originalMessage.content, // Should remain original
        imageUrl: originalMessage.imageurl, // Should remain original
        senderId: originalMessage.senderid, // Should remain original
        updatedAt: expectedDbUpdate.updatedat,
      }));
    });
  });
});
