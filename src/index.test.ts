import cron from 'node-cron';
// Import the function that is supposed to be scheduled
import { deleteInactiveAccounts } from './jobs/accountCleanupJob';

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

// Mock the job function itself, as we're testing scheduling, not execution
jest.mock('./jobs/accountCleanupJob', () => ({
  deleteInactiveAccounts: jest.fn(),
}));

// Mock app.listen to prevent the actual server from starting during tests
// and to allow us to control its callback execution.
const mockAppListen = jest.fn((port, callback) => {
  if (callback) {
    callback(); // Immediately invoke the callback for app.listen
  }
});

jest.mock('express', () => {
  const originalExpress = jest.requireActual('express');
  const app = originalExpress();
  // Mock app.listen for the default export of express (which is the app instance)
  // This is a bit tricky because app is both a function and an object.
  // We are essentially replacing the app instance that index.ts uses with a mocked one.
  const mockApp = () => app; // Return the original app instance for other uses
  mockApp.listen = mockAppListen; // Add the mock listen to our app function/object
  
  // Need to mock other methods used by index.ts on the app object if they are called before listen
  // or if their absence causes errors.
  // For this specific index.ts, express(), express.json(), express.urlencoded(), app.use, app.get are used.
  // The actual express() will create an app that has .use, .get etc.
  // We only need to control .listen()
  const mockExpress = () => ({
    use: jest.fn(),
    json: jest.fn(() => jest.fn()), // express.json() returns a middleware
    urlencoded: jest.fn(() => jest.fn()), // express.urlencoded() returns a middleware
    get: jest.fn(),
    listen: mockAppListen, // Key part: mock listen on the app instance
    // Add other methods if index.ts uses them before listen and they cause issues
  });
  mockExpress.json = originalExpress.json;
  mockExpress.urlencoded = originalExpress.urlencoded;
  // ... any other static methods of express if needed

  return mockExpress;
});


describe('Cron job scheduling in src/index.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset NODE_ENV if it affects execution path; assuming 'development' or 'production'
    // process.env.NODE_ENV = 'development'; 
  });

  test('should schedule deleteInactiveAccounts job correctly', async () => {
    // Dynamically import src/index.ts to execute its top-level code
    // which includes setting up the cron job inside app.listen's callback.
    // The import needs to be inside the test or a setup function that runs after mocks are established.
    await import('./index');

    // Check that app.listen was called, which triggers the cron scheduling
    expect(mockAppListen).toHaveBeenCalled();

    // Verify cron.schedule was called
    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(cron.schedule).toHaveBeenCalledWith(
      '0 0 * * *', // Correct cron string: daily at midnight
      expect.any(Function), // The wrapper function that calls deleteInactiveAccounts
      {
        scheduled: true,
        timezone: "UTC" // Correct timezone
      }
    );

    // Optionally, execute the scheduled function to test its behavior (e.g., error handling)
    const scheduledFn = (cron.schedule as jest.Mock).mock.calls[0][1];
    await scheduledFn(); // Execute the function passed to cron.schedule

    // Check that deleteInactiveAccounts was called by the scheduled function
    expect(deleteInactiveAccounts).toHaveBeenCalledTimes(1);
  });

  test('scheduled function handles errors from deleteInactiveAccounts', async () => {
    // Import src/index again or ensure it's imported in a way that mocks apply per test
    await import('./index');
    
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (deleteInactiveAccounts as jest.Mock).mockRejectedValueOnce(new Error('Test job error'));

    const scheduledFn = (cron.schedule as jest.Mock).mock.calls[0][1];
    await scheduledFn();

    expect(deleteInactiveAccounts).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Scheduled job: deleteInactiveAccounts encountered an error:',
      expect.any(Error)
    );
    
    consoleErrorSpy.mockRestore();
  });
});
