// Mock for database.config
const mockGlobalQuery = jest.fn(); // For the initial user fetch
const mockClientQuery = jest.fn(); // For queries within a transaction
const mockConnect = jest.fn();
const mockRelease = jest.fn();
// BEGIN, COMMIT, ROLLBACK will be mocked via client.query calls
// const mockBegin = jest.fn();
// const mockCommit = jest.fn();
// const mockRollback = jest.fn();


jest.mock('../config/database.config', () => ({
  __esModule: true,
  query: mockGlobalQuery, // Used for the initial SELECT * FROM users
  default: { // Represents the 'pool' export
    connect: mockConnect,
  },
}));

// Mock for cloudinaryUtils
const mockDeleteFromCloudinary = jest.fn();
jest.mock('../utils/cloudinaryUtils', () => ({
  __esModule: true,
  deleteFromCloudinary: mockDeleteFromCloudinary,
}));

// Import the function to test AFTER setting up mocks
import { deleteInactiveAccounts } from './accountCleanupJob';
import { AppUser } from '../entity/User'; // Assuming AppUser is correctly typed

// Helper to create a date string for 'X months ago'
const getDateMonthsAgo = (months: number): Date => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
};

describe('deleteInactiveAccounts', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock implementations for successful operations
    mockGlobalQuery.mockReset();
    mockClientQuery.mockReset();
    mockDeleteFromCloudinary.mockReset().mockResolvedValue({ result: 'ok' });

    mockConnect.mockReset().mockImplementation(() => Promise.resolve({
      query: mockClientQuery,
      release: mockRelease,
      // Simulating transaction control via query calls
    }));
    
    // Default successful transaction flow for client.query
    // Specific tests can override mockClientQuery for specific statements
    mockClientQuery.mockImplementation(async (sql: string) => {
        if (sql.toUpperCase() === 'BEGIN') return Promise.resolve();
        if (sql.toUpperCase() === 'COMMIT') return Promise.resolve();
        if (sql.toUpperCase() === 'ROLLBACK') return Promise.resolve();
        // Default for SELECT or DELETE queries within transaction
        return Promise.resolve({ rows: [], rowCount: 0 }); 
    });
  });

  test('Test Case 1: No inactive users found', async () => {
    mockGlobalQuery.mockResolvedValue({ rows: [], rowCount: 0 }); // No users returned

    await deleteInactiveAccounts();

    expect(mockGlobalQuery).toHaveBeenCalledTimes(1); // Initial fetch
    expect(mockConnect).not.toHaveBeenCalled(); // No users, so no transactions
    expect(mockDeleteFromCloudinary).not.toHaveBeenCalled();
    // Check console logs (optional, but good for confirming behavior)
    // console.log statements should indicate no users found
  });

  test('Test Case 2: One inactive user with full data cascade', async () => {
    const inactiveUser: AppUser = {
      id: 'user-1',
      email: 'inactive@example.com',
      name: 'Inactive User',
      last_login: getDateMonthsAgo(13),
      created_at: getDateMonthsAgo(14),
      updated_at: new Date(), // Added
      picture: 'http://cloudinary.com/user-1-pic.jpg',
      role: 'user',
      blocked: false,
    };
    const message = { id: 'msg-1', senderid: 'user-1', imageurl: 'http://cloudinary.com/msg-1-img.jpg' };
    const reaction = { id: 'react-1', messageid: 'msg-1', videourl: 'http://cloudinary.com/react-1-vid.mp4' };

    mockGlobalQuery.mockResolvedValueOnce({ rows: [inactiveUser], rowCount: 1 });

    // Mock DB calls within the transaction
    mockClientQuery
      .mockImplementationOnce(async (sql: string) => { if (sql.toUpperCase() === 'BEGIN') return Promise.resolve() }) // BEGIN
      .mockResolvedValueOnce({ rows: [message], rowCount: 1 }) // SELECT messages
      .mockResolvedValueOnce({ rows: [reaction], rowCount: 1 }) // SELECT reactions for message
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE replies for reaction
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE reaction
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE message
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE user
      .mockImplementationOnce(async (sql: string) => { if (sql.toUpperCase() === 'COMMIT') return Promise.resolve() }); // COMMIT

    await deleteInactiveAccounts();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    
    // Check message and reaction data fetching
    expect(mockClientQuery).toHaveBeenCalledWith('SELECT id, imageurl FROM messages WHERE senderid = $1', [inactiveUser.id]);
    expect(mockClientQuery).toHaveBeenCalledWith('SELECT id, videourl FROM reactions WHERE messageid = $1', [message.id]);

    // Check DB deletions
    expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM replies WHERE reactionid = $1', [reaction.id]);
    expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM reactions WHERE id = $1', [reaction.id]);
    expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM messages WHERE id = $1', [message.id]);
    expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', [inactiveUser.id]);

    // Check Cloudinary deletions
    expect(mockDeleteFromCloudinary).toHaveBeenCalledWith(inactiveUser.picture);
    expect(mockDeleteFromCloudinary).toHaveBeenCalledWith(message.imageurl);
    expect(mockDeleteFromCloudinary).toHaveBeenCalledWith(reaction.videourl);
    expect(mockDeleteFromCloudinary).toHaveBeenCalledTimes(3);

    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('Test Case 3: User inactive (never logged in, old account)', async () => {
    const oldUserNeverLoggedIn: AppUser = {
      id: 'user-2',
      email: 'old@example.com',
      name: 'Old User',
      last_login: undefined, // Never logged in
      created_at: getDateMonthsAgo(13), // Account created 13 months ago
      updated_at: new Date(), // Added
      picture: undefined,
      role: 'user',
      blocked: false,
    };

    mockGlobalQuery.mockResolvedValueOnce({ rows: [oldUserNeverLoggedIn], rowCount: 1 });
    // Mock transaction for this user (assuming no messages/reactions for simplicity here)
    mockClientQuery
        .mockImplementationOnce(async (sql) => { if (sql.toUpperCase() === 'BEGIN') return Promise.resolve(); })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // No messages
        // No need to mock reaction fetches if no messages
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE user
        .mockImplementationOnce(async (sql) => { if (sql.toUpperCase() === 'COMMIT') return Promise.resolve(); });


    await deleteInactiveAccounts();

    expect(mockGlobalQuery).toHaveBeenCalledTimes(1);
    expect(mockGlobalQuery.mock.calls[0][1][0]).toEqual(expect.any(Date)); // Check that a date is passed
    
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', [oldUserNeverLoggedIn.id]);
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('Test Case 4: Active user is not deleted', async () => {
    const activeUser: AppUser = { // This object needs to conform to AppUser for type safety at compile time
      id: 'user-3',
      email: 'active@example.com',
      name: 'Active User',
      last_login: getDateMonthsAgo(1), // Logged in 1 month ago
      created_at: getDateMonthsAgo(14),
      updated_at: new Date(), // Added
      picture: undefined,
      role: 'user',
      blocked: false,
    };
    // The global query should filter this user out based on the WHERE clause in the actual function
    // So, even though 'activeUser' is defined, it's not "used" in the deletion logic path.
    mockGlobalQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await deleteInactiveAccounts();

    expect(mockGlobalQuery).toHaveBeenCalledTimes(1);
    expect(mockConnect).not.toHaveBeenCalled(); // No inactive users, so no transaction
  });

  test('Test Case 5: Error during Cloudinary deletion', async () => {
    const userWithCloudinaryError: AppUser = {
      id: 'user-4',
      email: 'cloudinaryfail@example.com',
      name: 'Cloudinary Fail',
      last_login: getDateMonthsAgo(13),
      created_at: getDateMonthsAgo(14),
      updated_at: new Date(), // Added
      picture: 'http://cloudinary.com/user-4-pic.jpg',
      role: 'user',
      blocked: false,
    };

    mockGlobalQuery.mockResolvedValueOnce({ rows: [userWithCloudinaryError], rowCount: 1 });
    mockDeleteFromCloudinary.mockRejectedValueOnce(new Error('Cloudinary API is down'));

    // Mock transaction (assuming no messages/reactions for simplicity)
    mockClientQuery
        .mockImplementationOnce(async (sql) => { if (sql.toUpperCase() === 'BEGIN') return Promise.resolve(); })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // No messages
        .mockResolvedValueOnce({ rowCount: 1 }) // DELETE user
        .mockImplementationOnce(async (sql) => { if (sql.toUpperCase() === 'COMMIT') return Promise.resolve(); });

    // Spy on console.error
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await deleteInactiveAccounts();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockDeleteFromCloudinary).toHaveBeenCalledWith(userWithCloudinaryError.picture);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to delete profile picture from Cloudinary for user ID: ${userWithCloudinaryError.id}`),
      expect.any(Error)
    );
    expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', [userWithCloudinaryError.id]);
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT'); // DB commit should still happen
    expect(mockRelease).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });


  test('Test Case 6: Error during DB deletion (transaction rollback)', async () => {
    const userWithDbError: AppUser = {
      id: 'user-5',
      email: 'dbfail@example.com',
      name: 'DB Fail User',
      last_login: getDateMonthsAgo(13),
      created_at: getDateMonthsAgo(14),
      updated_at: new Date(), // Added
      picture: 'http://cloudinary.com/user-5-pic.jpg', // Will be called before DB error
      role: 'user',
      blocked: false,
    };
    const message = { id: 'msg-2', senderid: 'user-5', imageurl: 'http://cloudinary.com/msg-2-img.jpg' };

    mockGlobalQuery.mockResolvedValueOnce({ rows: [userWithDbError], rowCount: 1 });

    // Simulate DB error when trying to delete messages
    mockClientQuery
      .mockImplementationOnce(async (sql) => { if (sql.toUpperCase() === 'BEGIN') return Promise.resolve(); }) // BEGIN
      .mockResolvedValueOnce({ rows: [message], rowCount: 1 }) // SELECT messages - success
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT reactions - success (no reactions)
      // Attempt to delete message - this will fail
      .mockImplementationOnce(async (sql) => { 
          if (sql.startsWith('DELETE FROM messages')) throw new Error('DB error deleting message'); 
          return Promise.resolve({ rows: [], rowCount: 0 });
      })
      .mockImplementationOnce(async (sql) => { if (sql.toUpperCase() === 'ROLLBACK') return Promise.resolve(); }); // ROLLBACK
      // COMMIT should not be called

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await deleteInactiveAccounts();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    
    // Cloudinary deletion for user picture might happen before the DB error on message deletion
    // The user profile picture is deleted *before* message processing loop in the original code.
    // Cloudinary deletion for message image would happen *after* successful message DB deletion, so it won't be called.
    expect(mockDeleteFromCloudinary).toHaveBeenCalledWith(userWithDbError.picture); 
    expect(mockDeleteFromCloudinary).not.toHaveBeenCalledWith(message.imageurl);


    expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM messages WHERE id = $1', [message.id]); // This is the failing call
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClientQuery).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClientQuery).not.toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', [userWithDbError.id]); // User should not be deleted
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Error processing user ID: ${userWithDbError.id}. Transaction rolled back.`),
      expect.any(Error)
    );
    expect(mockRelease).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
