// Set up default environment variables for tests
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud-name';
process.env.CLOUDINARY_API_KEY = 'test-api-key';
process.env.CLOUDINARY_API_SECRET = 'test-api-secret';

process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';

process.env.DATABASE_HOST = 'localhost';
process.env.DATABASE_PORT = '5432';
process.env.DATABASE_NAME = 'test_reactlye_db';
process.env.DATABASE_USER = 'test_user';
process.env.DATABASE_PASSWORD = 'test_password';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.FRONTEND_URL = 'http://localhost:3001';
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';

// You can add other global setup here if needed, e.g., jest.setTimeout
jest.setTimeout(30000); // Increase timeout if tests are slow, especially DB or network related (though we mock these)
