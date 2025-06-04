import { Request, Response } from 'express';
import { recordReaction } from './messageController';
import { query } from '../config/database.config';
import { uploadVideoToCloudinary } from '../utils/cloudinaryUtils';
import { AppUser } from '../entity/User';

// Mock dependencies
jest.mock('../config/database.config');
jest.mock('../utils/cloudinaryUtils');

const mockQuery = query as jest.Mock;
const mockUploadVideoToCloudinary = uploadVideoToCloudinary as jest.Mock;

describe('recordReaction Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockStatus = jest.fn().mockReturnThis();
    mockJson = jest.fn().mockReturnThis();
    mockSend = jest.fn().mockReturnThis(); // For cases that might use send

    mockResponse = {
      status: mockStatus,
      json: mockJson,
      send: mockSend,
    };

    mockRequest = {
      params: {},
      body: {},
      file: {
        buffer: Buffer.from('fakevideo'),
        size: 12345,
        mimetype: 'video/mp4',
      } as Express.Multer.File, // Added type assertion
      user: undefined, // Default to no user
    };
    mockQuery.mockClear();
    mockUploadVideoToCloudinary.mockClear();
  });

  describe('Successful Reaction Recording', () => {
    it('should record a reaction successfully and return 201', async () => {
      const reactorUser: AppUser = {
        id: 'reactor-uuid-123',
        email: 'reactor@example.com',
        name: 'Reactor User',
        role: 'user',
        blocked: false,
        created_at: new Date(),
        updated_at: new Date(),
        // max_reactions_authored_per_month and reactions_authored_this_month are removed from AppUser for this test
        last_usage_reset_date: new Date(),
      };
      mockRequest.user = reactorUser as AppUser; // Cast to AppUser, actual fields removed are not used by req.user directly in controller
      mockRequest.params = { id: 'message-uuid-456' };
      mockRequest.body = { name: 'Test Reaction' };

      // 1. Fetch Message Details
      mockQuery.mockResolvedValueOnce({
        rows: [{ actual_message_id: 'message-uuid-456', senderid: 'sender-uuid-789', max_reactions_allowed: 10 }],
        rowCount: 1,
      });
      // 2. Fetch Message Sender's Details
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sender-uuid-789',
          max_reactions_per_month: 200,
          reactions_received_this_month: 10,
          last_usage_reset_date: new Date(),
        } as AppUser],
        rowCount: 1,
      });
      // 3. Fetch Reactor's Details - THIS IS REMOVED FROM THE CONTROLLER
      // 4. Per-Message Limit Check (COUNT reactions for message)
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

      // 5. Cloudinary Upload
      mockUploadVideoToCloudinary.mockResolvedValueOnce({
        secure_url: 'http://fake.cloudinary.com/video.mp4',
        thumbnail_url: 'http://fake.cloudinary.com/thumb.jpg',
        duration: 15.5,
      });

      // 6. Insert Reaction
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'reaction-uuid-abc' }], rowCount: 1 });

      // 7. Increment Sender's reactions_received_this_month
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      // 8. Increment Reactor's reactions_authored_this_month - THIS IS REMOVED
      // 9. Update message isreply (async, no await in controller)
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });


      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(201);
      expect(mockJson).toHaveBeenCalledWith({
        success: true,
        message: 'Reaction recorded successfully',
        reactionId: 'reaction-uuid-abc',
      });

      // Check DB calls
      // Call to fetch reactor details is removed.
      // Call to increment reactor's authored count is removed.
      const calls = mockQuery.mock.calls;
      expect(calls[0][0]).toContain('FROM messages WHERE id = $1 OR shareablelink LIKE $2'); // Message fetch
      expect(calls[0][1]).toEqual(['message-uuid-456', '%message-uuid-456%']);
      expect(calls[1][0]).toContain('FROM users WHERE id = $1'); // Sender fetch
      expect(calls[1][1]).toEqual(['sender-uuid-789']);
      // The next call is Per-Message Limit Check
      expect(calls[2][0]).toEqual('SELECT COUNT(*) FROM reactions WHERE messageid = $1'); // Count reactions for message
      expect(calls[2][1]).toEqual(['message-uuid-456']);
      expect(mockUploadVideoToCloudinary).toHaveBeenCalledWith(mockRequest.file?.buffer, mockRequest.file?.size);
      expect(calls[3][0]).toContain('INSERT INTO reactions'); // Insert reaction
      expect(calls[4][0]).toContain("UPDATE users SET reactions_received_this_month = (COALESCE(reactions_received_this_month, 0) + 1) WHERE id = $1"); // Increment sender
      expect(calls[4][1]).toEqual(['sender-uuid-789']);
      expect(calls[5][0]).toEqual('UPDATE messages SET isreply = true WHERE id = $1'); // Update isreply

      // Ensure no call to fetch reactor details for author limits or increment reactor's authored count
      calls.forEach(call => {
        expect(call[0]).not.toContain('reactions_authored_this_month');
         // Check if it's a SELECT from users for the reactor ID, which was for author limits
        if (call[0].includes('SELECT') && call[0].includes('FROM users WHERE id = $1') && call[1][0] === 'reactor-uuid-123') {
            // This specific query for reactor details for limits should not exist.
            // However, the AppUser object for reactorUser still has an id, so a generic check like this might be too broad
            // if other valid fetches for reactor (not for author limits) were to exist.
            // Given the current controller logic, NO separate fetch for reactor details should occur.
            throw new Error("A separate fetch for reactor details for author limits should not occur.");
        }
      });
       expect(mockQuery.mock.calls.length).toBe(6); // Message, Sender, CountForMessage, InsertReaction, IncrementSender, UpdateIsReply
    });
  });

  describe('Message Not Found', () => {
    it('should return 404 if the message does not exist', async () => {
      const reactorUser: AppUser = { id: 'reactor-uuid-123' } as AppUser; // Simplified for this test
      mockRequest.user = reactorUser;
      mockRequest.params = { id: 'non-existent-message-uuid' };
      mockRequest.body = { name: 'Test Reaction' };

      // 1. Fetch Message Details - returns no rows
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(404);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Message not found.' });
      expect(mockQuery).toHaveBeenCalledTimes(1); // Only the message fetch should occur
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM messages WHERE id = $1 OR shareablelink LIKE $2'), ['non-existent-message-uuid', '%non-existent-message-uuid%']);
    });
  });

  describe('Per-Message Reaction Limit Exceeded', () => {
    it('should return 403 if per-message reaction limit is reached', async () => {
      const reactorUser: AppUser = { id: 'reactor-uuid-123' } as AppUser;
      mockRequest.user = reactorUser;
      mockRequest.params = { id: 'message-uuid-limit' };
      mockRequest.body = { name: 'Test Reaction' };

      // 1. Fetch Message Details - Max reactions allowed is 5
      mockQuery.mockResolvedValueOnce({
        rows: [{ actual_message_id: 'message-uuid-limit', senderid: 'sender-uuid-789', max_reactions_allowed: 5 }],
        rowCount: 1,
      });
      // 2. Fetch Message Sender's Details (still needed before per-message check)
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sender-uuid-789',
          max_reactions_per_month: 200,
          reactions_received_this_month: 10,
          last_usage_reset_date: new Date(),
        } as AppUser],
        rowCount: 1,
      });
      // 3. Fetch Reactor's Details - REMOVED FROM CONTROLLER

      // 4. Per-Message Limit Check - Current count is 5 (equal to max_reactions_allowed)
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 });

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Reaction limit reached for this message.' });

      // Verify calls up to the point of failure
      const calls = mockQuery.mock.calls;
      expect(calls[0][0]).toContain('FROM messages'); // Message fetch
      expect(calls[1][0]).toContain('FROM users WHERE id = $1'); // Sender fetch
      expect(calls[2][0]).toEqual('SELECT COUNT(*) FROM reactions WHERE messageid = $1'); // Count reactions for message
      expect(mockUploadVideoToCloudinary).not.toHaveBeenCalled(); // Should not attempt upload
      expect(mockQuery.mock.calls.length).toBe(3); // Message, Sender, Count for message. Reactor detail fetch removed.
    });
  });

  describe("Message Sender's Monthly Received Reaction Limit Exceeded", () => {
    it("should return 403 if sender's monthly received reaction limit is reached", async () => {
      const reactorUser: AppUser = { id: 'reactor-uuid-123', last_usage_reset_date: new Date() } as AppUser;
      mockRequest.user = reactorUser;
      mockRequest.params = { id: 'message-uuid-sender-limit' };
      mockRequest.body = { name: 'Test Reaction' };
      const currentDate = new Date();

      // 1. Fetch Message Details
      mockQuery.mockResolvedValueOnce({
        rows: [{ actual_message_id: 'message-uuid-sender-limit', senderid: 'sender-limited-uuid', max_reactions_allowed: 10 }],
        rowCount: 1,
      });
      // 2. Fetch Message Sender's Details - Limit reached
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sender-limited-uuid',
          max_reactions_per_month: 50,
          reactions_received_this_month: 50, // Limit is reached
          last_usage_reset_date: currentDate, // No reset needed for this test
        } as AppUser],
        rowCount: 1,
      });
      // 3. Fetch Reactor's Details - REMOVED FROM CONTROLLER
      // 4. Per-Message Limit Check (COUNT reactions for message) - not reached
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'This user can no longer receive reactions this month (limit reached).' });

      // Verify calls up to the point of failure
      const calls = mockQuery.mock.calls;
      expect(calls[0][0]).toContain('FROM messages');
      expect(calls[1][0]).toContain('FROM users WHERE id = $1'); // Sender fetch
      expect(calls[1][1]).toEqual(['sender-limited-uuid']);
      expect(calls[2][0]).toContain('SELECT COUNT(*) FROM reactions WHERE messageid = $1'); // Count for message
      expect(mockUploadVideoToCloudinary).not.toHaveBeenCalled();
      expect(mockQuery.mock.calls.length).toBe(3); // Message, Sender, Per-Message Count. Reactor detail fetch removed.
    });
  });

  // "Reactor's Monthly Authored Reaction Limit Exceeded" describe block will be removed entirely.

  describe('Reactor Not Authenticated', () => {
    it('should return 401 if the reactor (user) is not authenticated', async () => {
      mockRequest.user = undefined; // No user on request
      mockRequest.params = { id: 'some-message-id' };

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Authentication required to record reactions.' });
      expect(mockQuery).not.toHaveBeenCalled(); // No DB calls should be made
      expect(mockUploadVideoToCloudinary).not.toHaveBeenCalled();
    });
  });

  describe('Monthly Reset Logic', () => {
    it("should reset message sender's received reactions count if last reset was in a previous month", async () => {
      const reactorUser: AppUser = {
        id: 'reactor-uuid-123',
        last_usage_reset_date: new Date(), // Reactor is current
      } as AppUser;
      mockRequest.user = reactorUser;
      mockRequest.params = { id: 'message-needs-sender-reset' };
      mockRequest.body = { name: 'Reset Test Reaction' };

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      // 1. Fetch Message Details
      mockQuery.mockResolvedValueOnce({
        rows: [{ actual_message_id: 'message-needs-sender-reset', senderid: 'sender-needs-reset-uuid', max_reactions_allowed: 10 }],
        rowCount: 1,
      });
      // 2. Fetch Message Sender's Details - last_usage_reset_date is old
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sender-needs-reset-uuid',
          max_reactions_per_month: 200,
          reactions_received_this_month: 150, // High count that should be reset
          last_usage_reset_date: lastMonth,
          current_messages_this_month: 10, // This will also be reset
        } as AppUser],
        rowCount: 1,
      });
      // 3. DB Update for Sender Reset (RETURNING new values)
      mockQuery.mockResolvedValueOnce({
        rows: [{
          reactions_received_this_month: 0,
          current_messages_this_month: 0,
          last_usage_reset_date: new Date(),
          // reactions_authored_this_month would also be reset if this user was also the reactor
          // but here we are testing sender reset.
        }],
        rowCount: 1,
      });
      // 4. Fetch Reactor's Details - REMOVED FROM CONTROLLER
      // 5. Per-Message Limit Check (COUNT) - assuming not hit
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 }); // This becomes call index 3
      // 6. Cloudinary Upload
      mockUploadVideoToCloudinary.mockResolvedValueOnce({
        secure_url: 'http://fake.cloudinary.com/video.mp4',
        thumbnail_url: 'http://fake.cloudinary.com/thumb.jpg',
        duration: 10,
      });
      // 7. Insert Reaction
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'reaction-reset-test-id' }], rowCount: 1 });
      // 8. Increment Sender's reactions_received_this_month (will be 0 + 1)
      mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // This becomes call index 4
      // 9. Increment Reactor's reactions_authored_this_month - REMOVED
      // 10. Update message isreply
      mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // This becomes call index 5

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(201); // Successful reaction
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({ reactionId: 'reaction-reset-test-id' }));

      const calls = mockQuery.mock.calls;
      // Check that sender reset query was called (call index 2)
      expect(calls[2][0]).toContain('UPDATE users SET current_messages_this_month = 0, reactions_received_this_month = 0, last_usage_reset_date = NOW() WHERE id = $1');
      expect(calls[2][1]).toEqual(['sender-needs-reset-uuid']);

      // Check that sender's reaction increment was based on reset value (0 + 1) (call index 5 after insert)
       const senderIncrementQuery = calls.find(call => call[0].includes('UPDATE users SET reactions_received_this_month = (COALESCE(reactions_received_this_month, 0) + 1) WHERE id = $1') && call[1][0] === 'sender-needs-reset-uuid');
      expect(senderIncrementQuery).toBeDefined();
      // Expected calls: Message, Sender, SenderReset, PerMessageCount, InsertReaction, IncrementSender, UpdateIsReply
      expect(calls.length).toBe(7);
    });

    // The test case "should reset reactor's authored reactions count" will be removed entirely.
  });
});
