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
  const actual = jest.requireActual('express');
  const mockExpress = () => ({
    use: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    listen: mockAppListen,
  });
  // Attach json and urlencoded middleware creators
  mockExpress.json = actual.json;
  mockExpress.urlencoded = actual.urlencoded;
  // Expose Router for routers imported from express
  mockExpress.Router = actual.Router;
  return {
    __esModule: true,
    default: mockExpress,
    Router: actual.Router,
  };
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
