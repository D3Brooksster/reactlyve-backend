# Reactlyve Backend

This is the backend service for the Reactlyve application, providing API endpoints for user authentication, messaging, profile management, and administrative tasks. It features Google OAuth 2.0 integration, a robust messaging system with media support via Cloudinary, and user role management.

## Features

*   **Authentication:**
    *   Google OAuth 2.0 for user sign-up and login.
    *   JWT (JSON Web Tokens) for securing API access.
*   **User Management:**
    *   User roles: `user`, `admin`, `guest`.
    *   Users can view their profile and delete their own account.
    *   Users can update profile settings such as `lastUsageResetDate`.
*   **Messaging System:**
    *   Send text messages.
    *   Upload and send image and video messages (stored on Cloudinary).
    *   Shareable message links (with optional passcode protection).
    *   Video reactions to messages.
    *   Text replies to messages/reactions.
*   **Admin Panel:**
    *   View all registered users.
    *   Update user roles.
    *   Remove users from the system.
    *   Set user message and reaction limits.
    *   View detailed user information.
*   **Automated Jobs:**
    *   Daily cleanup of inactive user accounts (and their associated data, including Cloudinary assets) after 12 months of inactivity.

## Getting Started

### Prerequisites

*   Node.js (LTS version recommended, e.g., v18.x or v20.x)
*   PostgreSQL (e.g., version 12 or higher)
*   A Cloudinary account for media storage.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    ```
2.  **Navigate to the project directory:**
    ```bash
    cd reactlyve-backend
    ```
    (Or the actual name of the directory if different)
3.  **Install dependencies:**
    ```bash
    npm install
    ```

### Database Setup

1.  **Ensure PostgreSQL is running** and you have access to create a database and user.
2.  **Create a database** for the application (e.g., `reactlyve_db`).
3.  **Set up the database schema:**
    *   The initial database schema (tables like users, messages, etc.) can be set up using the `migration.sql` file located in the project root. This file should be executed against your newly created database.
        ```bash
        psql -U your_postgres_user -d your_database_name -f migration.sql
        ```
    *   The project also uses incremental migrations located in the `migrations/` directory. For example, `migrations/V1__add_last_login_to_users.sql` adds the `last_login` column to the `users` table. These should be applied in order after the base schema.
    *   *Note:* For a more robust migration management system, consider integrating tools like Flyway or `node-pg-migrate` if not already implicitly used. The current setup requires manual application or a custom script.

### Running the Application

*   **Development Mode:**
    The application uses `ts-node-dev` for live reloading during development.
    ```bash
    npm run dev
    ```
    This will typically start the server on the port specified in your `.env` file (e.g., 3000).

*   **Production Mode:**
    1.  Build the TypeScript code:
        ```bash
        npm run build
        ```
        This compiles the TypeScript files into JavaScript in the `dist/` directory.
    2.  Start the server:
        ```bash
        npm start
        ```

## Configuration (Environment Variables)

Create a `.env` file in the root directory of the project and populate it with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development # or 'production'
FRONTEND_URL=http://localhost:3001 # URL of your frontend application for CORS and redirects

# Administrative Accounts
ADMIN_EMAILS=admin1@example.com,admin2@example.com # Comma-separated list

# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=your_database_name # e.g., reactlyve_db
DATABASE_USER=your_postgres_user
DATABASE_PASSWORD=your_postgres_password

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback # Adjust if your port or path differs

# Cloudinary Credentials
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# AWS Credentials (for future file storage features)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1

# File Uploads
UPLOAD_DIR=uploads

# JWT Configuration
JWT_SECRET=your_very_strong_and_secret_jwt_key # Secret for signing JWTs
JWT_EXPIRES_IN=1h # Token expiry, e.g., 1h or 7d
```

**Note:** Ensure `GOOGLE_CALLBACK_URL` matches the redirect URI configured in your Google Cloud Console for the OAuth client.

## API Endpoints

The API provides several route groups for different functionalities:

*   **`/api/auth`**: Handles user authentication.
    *   Google login initiation and callback.
    *   Fetching current authenticated user details.
*   **`/api/messages`** (and related routes for reactions/replies): Manages the messaging system.
    *   Creating, retrieving, updating, and deleting messages.
    *   Managing message reactions and replies.
*   **`/api/profile`**: User profile operations.
    *   Viewing user's own profile.
    *   Deleting user's own account.
    *   Updating profile settings.
*   **`/api/admin`**: Admin-specific operations.
    *   Listing users.
    *   Modifying user roles.
    *   Removing users.
    *   Setting user message/reaction limits.
    *   Retrieving detailed user information.

For detailed information on specific endpoints, request/response formats, and parameters, please refer to the route definitions in `src/routes/` and the corresponding controller logic in `src/controllers/`.

## Scheduled Tasks

This section describes automated jobs that run as part of the application.

### Inactive Account Cleanup Job

*   **Purpose:** This job automatically deletes user accounts that have been inactive for a period of 12 months. Inactivity is determined by the `last_login` timestamp. If `last_login` is null, the `created_at` timestamp is used. This helps maintain data hygiene, manage database size, and comply with potential data retention policies.
*   **Schedule:** The job runs daily at midnight UTC.
*   **Data Deletion:** When an account is identified as inactive, the following data associated with the user is deleted:
    *   The user's account from the `users` table.
    *   All messages sent by the user from the `messages` table.
        *   Any images associated with these messages stored on Cloudinary are also deleted.
    *   All reactions made by the user from the `reactions` table.
        *   Any videos associated with these reactions stored on Cloudinary are also deleted.
    *   All replies related to the user's reactions.
    *   The user's profile picture, if stored on Cloudinary.
*   **Technical Implementation:**
    *   The core logic for the job is implemented in `src/jobs/accountCleanupJob.ts`.
    *   The job is scheduled using `node-cron` within the main application file `src/index.ts`.

## Project Structure

A brief overview of key directories within the `src/` folder:

*   `src/config`: Contains configuration files, such as database connection settings (`database.config.ts`) and Passport.js strategy setup (`passport.ts`).
*   `src/controllers`: Houses the controller functions that handle incoming API requests, process data, and send responses.
*   `src/entity`: Defines data models or interfaces (e.g., `AppUser.ts`) representing the structure of data entities.
*   `src/jobs`: Includes modules for scheduled tasks or background jobs, like the `accountCleanupJob.ts`.
*   `src/middlewares`: Contains custom middleware functions used in the request-response cycle (e.g., for authentication, authorization, error handling).
*   `src/routes`: Defines the API routes and maps them to controller functions.
*   `src/utils`: Utility functions and helper modules (e.g., `cloudinaryUtils.ts` for Cloudinary interactions).
*   `migrations/`: Contains SQL migration files for evolving the database schema over time.

## Running Tests

The project is set up with Jest for unit and integration testing.

To run the tests:

```bash
npm test
```

This command will execute all test files (typically `*.test.ts` or `*.spec.ts`) found in the project. Ensure your test environment is configured correctly (e.g., separate test database if needed, environment variables for tests).

## Contributing

(Placeholder: Guidelines for contributing to the project would go here. e.g., coding standards, branch strategy, pull request process)

## License

This project is licensed under the ISC License (as per `package.json`).
