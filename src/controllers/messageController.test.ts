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
        max_reactions_authored_per_month: 100,
        reactions_authored_this_month: 5,
        last_usage_reset_date: new Date(),
      };
      mockRequest.user = reactorUser;
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
      // 3. Fetch Reactor's Details (already part of reactorUser, but function fetches fresh)
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...reactorUser }], // Simulate fetching fresh reactor details
        rowCount: 1,
      });
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
      // 8. Increment Reactor's reactions_authored_this_month
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
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
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM messages WHERE id = $1 OR shareablelink LIKE $2'), ['message-uuid-456', '%message-uuid-456%']); // Message fetch
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM users WHERE id = $1'), ['sender-uuid-789']); // Sender fetch
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM users WHERE id = $1'), ['reactor-uuid-123']); // Reactor fetch
      expect(mockQuery).toHaveBeenCalledWith('SELECT COUNT(*) FROM reactions WHERE messageid = $1', ['message-uuid-456']); // Count reactions for message
      expect(mockUploadVideoToCloudinary).toHaveBeenCalledWith(mockRequest.file?.buffer, mockRequest.file?.size);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO reactions'), expect.any(Array)); // Insert reaction
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET reactions_received_this_month = (COALESCE(reactions_received_this_month, 0) + 1) WHERE id = $1"), ['sender-uuid-789']); // Increment sender
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE users SET reactions_authored_this_month = (COALESCE(reactions_authored_this_month, 0) + 1) WHERE id = $1"), ['reactor-uuid-123']); // Increment reactor
      expect(mockQuery).toHaveBeenCalledWith('UPDATE messages SET isreply = true WHERE id = $1', ['message-uuid-456']); // Update isreply
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
      // 3. Fetch Reactor's Details
       mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'reactor-uuid-123', max_reactions_authored_per_month: 100, reactions_authored_this_month: 0, last_usage_reset_date: new Date() } as AppUser],
        rowCount: 1,
      });

      // 4. Per-Message Limit Check - Current count is 5 (equal to max_reactions_allowed)
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 });

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Reaction limit reached for this message.' });

      // Verify calls up to the point of failure
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM messages'), expect.any(Array)); // Message fetch
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM users WHERE id = $1'), ['sender-uuid-789']); // Sender fetch
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM users WHERE id = $1'), ['reactor-uuid-123']); // Reactor fetch
      expect(mockQuery).toHaveBeenCalledWith('SELECT COUNT(*) FROM reactions WHERE messageid = $1', ['message-uuid-limit']); // Count reactions
      expect(mockUploadVideoToCloudinary).not.toHaveBeenCalled(); // Should not attempt upload
      expect(mockQuery.mock.calls.length).toBe(4); // Message, Sender, Reactor, Count for message
    });
  });

  describe("Message Sender's Monthly Received Reaction Limit Exceeded", () => {
    it("should return 403 if sender's monthly received reaction limit is reached", async () => {
      const reactorUser: AppUser = { id: 'reactor-uuid-123', max_reactions_authored_per_month: 100, reactions_authored_this_month: 0, last_usage_reset_date: new Date() } as AppUser;
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
      // 3. Fetch Reactor's Details
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...reactorUser, last_usage_reset_date: currentDate }], // No reset needed
        rowCount: 1,
      });
      // 4. Per-Message Limit Check (COUNT reactions for message) - not reached
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'This user can no longer receive reactions this month (limit reached).' });

      // Verify calls up to the point of failure
      expect(mockQuery.mock.calls[0][0]).toContain('FROM messages');
      expect(mockQuery.mock.calls[1][0]).toContain('FROM users WHERE id = $1'); // Sender fetch
      expect(mockQuery.mock.calls[1][1]).toEqual(['sender-limited-uuid']);
      expect(mockQuery.mock.calls[2][0]).toContain('FROM users WHERE id = $1'); // Reactor fetch
      expect(mockQuery.mock.calls[3][0]).toContain('SELECT COUNT(*) FROM reactions WHERE messageid = $1'); // Count for message
      expect(mockUploadVideoToCloudinary).not.toHaveBeenCalled();
      // Expected calls: Message, Sender, Reactor, Per-Message Count. Reset logic for sender is checked inline.
      // If last_usage_reset_date was old, there would be an UPDATE query for reset.
      // In this case, date is current, so no reset query.
      expect(mockQuery.mock.calls.length).toBe(4);
    });
  });

  describe("Reactor's Monthly Authored Reaction Limit Exceeded", () => {
    it("should return 403 if reactor's monthly authored reaction limit is reached", async () => {
      const reactorUser: AppUser = {
        id: 'reactor-limited-uuid',
        email: 'reactor@example.com',
        name: 'Reactor User',
        role: 'user',
        blocked: false,
        created_at: new Date(),
        updated_at: new Date(),
        max_reactions_authored_per_month: 30,
        reactions_authored_this_month: 30, // Limit is reached
        last_usage_reset_date: new Date(), // No reset needed for this test
      };
      mockRequest.user = reactorUser; // Reactor is authenticated
      mockRequest.params = { id: 'message-uuid-reactor-limit' };
      mockRequest.body = { name: 'Test Reaction' };
      const currentDate = new Date();

      // 1. Fetch Message Details
      mockQuery.mockResolvedValueOnce({
        rows: [{ actual_message_id: 'message-uuid-reactor-limit', senderid: 'sender-uuid-789', max_reactions_allowed: 10 }],
        rowCount: 1,
      });
      // 2. Fetch Message Sender's Details
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'sender-uuid-789',
          max_reactions_per_month: 200,
          reactions_received_this_month: 10,
          last_usage_reset_date: currentDate, // No reset
        } as AppUser],
        rowCount: 1,
      });
      // 3. Fetch Reactor's Details (this is where the limit is checked)
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...reactorUser }], // Fetches fresh data for reactor
        rowCount: 1,
      });
      // Per-Message Limit Check (COUNT reactions for message) - not reached, will not be called if reactor limit is hit first
      // mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 });


      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(403);
      expect(mockJson).toHaveBeenCalledWith({ error: 'You have reached your reaction authoring limit for this month.' });

      // Verify calls up to the point of failure
      expect(mockQuery.mock.calls[0][0]).toContain('FROM messages'); // Message
      expect(mockQuery.mock.calls[1][0]).toContain('FROM users WHERE id = $1'); // Sender
      expect(mockQuery.mock.calls[1][1]).toEqual(['sender-uuid-789']);
      expect(mockQuery.mock.calls[2][0]).toContain('FROM users WHERE id = $1'); // Reactor
      expect(mockQuery.mock.calls[2][1]).toEqual(['reactor-limited-uuid']);
      // Per-message count and Cloudinary upload should not be called
      expect(mockUploadVideoToCloudinary).not.toHaveBeenCalled();
      expect(mockQuery.mock.calls.length).toBe(3); // Message, Sender, Reactor. Reset for reactor checked inline.
    });
  });

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
        max_reactions_authored_per_month: 100,
        reactions_authored_this_month: 5,
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
      // 4. Fetch Reactor's Details
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...reactorUser }],
        rowCount: 1,
      });
      // 5. Per-Message Limit Check (COUNT) - assuming not hit
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });
      // 6. Cloudinary Upload
      mockUploadVideoToCloudinary.mockResolvedValueOnce({
        secure_url: 'http://fake.cloudinary.com/video.mp4',
        thumbnail_url: 'http://fake.cloudinary.com/thumb.jpg',
        duration: 10,
      });
      // 7. Insert Reaction
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'reaction-reset-test-id' }], rowCount: 1 });
      // 8. Increment Sender's reactions_received_this_month (will be 0 + 1)
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      // 9. Increment Reactor's reactions_authored_this_month
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });
      // 10. Update message isreply
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await recordReaction(mockRequest as Request, mockResponse as Response);

      expect(mockStatus).toHaveBeenCalledWith(201); // Successful reaction
      expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({ reactionId: 'reaction-reset-test-id' }));

      // Check that sender reset query was called
      const senderResetQuery = mockQuery.mock.calls.find(call => call[0].includes('UPDATE users SET current_messages_this_month = 0, reactions_received_this_month = 0, last_usage_reset_date = NOW() WHERE id = $1'));
      expect(senderResetQuery).toBeDefined();
      expect(senderResetQuery[1]).toEqual(['sender-needs-reset-uuid']);

      // Check that sender's reaction increment was based on reset value (0 + 1)
      // The actual check for `reactions_received_this_month = 1` in DB happens in the controller logic based on `messageSender` object state after reset.
      // Here, we confirm the reset happened, and then an increment was called.
       const senderIncrementQuery = mockQuery.mock.calls.find(call => call[0].includes('UPDATE users SET reactions_received_this_month = (COALESCE(reactions_received_this_month, 0) + 1) WHERE id = $1') && call[1][0] === 'sender-needs-reset-uuid');
      expect(senderIncrementQuery).toBeDefined();
    });
  });

  // More test cases will follow

  it("should reset reactor's authored reactions count if last reset was in a previous month", async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const reactorUserNeedsReset: AppUser = {
      id: 'reactor-needs-reset-uuid',
      email: 'reactor-reset@example.com',
      name: 'Reactor Reset User',
      role: 'user',
      blocked: false,
      created_at: new Date(),
      updated_at: new Date(),
      max_reactions_authored_per_month: 100,
      reactions_authored_this_month: 90, // High count that should be reset
      last_usage_reset_date: lastMonth, // Needs reset
      current_messages_this_month: 5, // This will also be reset by the shared query
    };
    mockRequest.user = reactorUserNeedsReset; // This is the user whose counts will be reset
    mockRequest.params = { id: 'message-for-reactor-reset' };
    mockRequest.body = { name: 'Reactor Reset Test Reaction' };

    // 1. Fetch Message Details
    mockQuery.mockResolvedValueOnce({
      rows: [{ actual_message_id: 'message-for-reactor-reset', senderid: 'sender-uuid-normal', max_reactions_allowed: 10 }],
      rowCount: 1,
    });
    // 2. Fetch Message Sender's Details (current, no reset needed for sender)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'sender-uuid-normal',
        max_reactions_per_month: 200,
        reactions_received_this_month: 10,
        last_usage_reset_date: new Date(),
      } as AppUser],
      rowCount: 1,
    });
    // 3. Fetch Reactor's Details (this is reactorUserNeedsReset, will trigger reset)
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...reactorUserNeedsReset }], // Simulate fetching this user
      rowCount: 1,
    });
    // 4. DB Update for Reactor Reset (RETURNING new values)
    // This query is crucial as it resets multiple counts due to shared last_usage_reset_date.
    mockQuery.mockResolvedValueOnce({
      rows: [{
        reactions_authored_this_month: 0,
        current_messages_this_month: 0,
        reactions_received_this_month: 0, // Assuming this would also be reset for the reactor if they also receive reactions
        last_usage_reset_date: new Date(),
      }],
      rowCount: 1,
    });
    // 5. Per-Message Limit Check (COUNT) - assuming not hit
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });
    // 6. Cloudinary Upload
    mockUploadVideoToCloudinary.mockResolvedValueOnce({
      secure_url: 'http://fake.cloudinary.com/video.mp4',
      thumbnail_url: 'http://fake.cloudinary.com/thumb.jpg',
      duration: 10,
    });
    // 7. Insert Reaction
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'reaction-reactor-reset-id' }], rowCount: 1 });
    // 8. Increment Sender's reactions_received_this_month
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 9. Increment Reactor's reactions_authored_this_month (will be 0 + 1)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 10. Update message isreply
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await recordReaction(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(201);
    expect(mockJson).toHaveBeenCalledWith(expect.objectContaining({ reactionId: 'reaction-reactor-reset-id' }));

    // Check that reactor reset query was called
    // The query resets multiple fields due to shared last_usage_reset_date
    const reactorResetQuery = mockQuery.mock.calls.find(call => call[0].includes('UPDATE users SET reactions_authored_this_month = 0, current_messages_this_month = 0, reactions_received_this_month = 0, last_usage_reset_date = NOW() WHERE id = $1'));
    expect(reactorResetQuery).toBeDefined();
    expect(reactorResetQuery[1]).toEqual([reactorUserNeedsReset.id]);

    // Check that reactor's reaction increment was based on reset value (0 + 1)
    const reactorIncrementQuery = mockQuery.mock.calls.find(call => call[0].includes('UPDATE users SET reactions_authored_this_month = (COALESCE(reactions_authored_this_month, 0) + 1) WHERE id = $1') && call[1][0] === reactorUserNeedsReset.id);
    expect(reactorIncrementQuery).toBeDefined();
  });
});
