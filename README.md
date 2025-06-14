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
    The `npm run dev` script sets `NODE_ENV=development` so debug logs (such as profile update logging) are printed.
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
CLOUDINARY_OVERLAY_PUBLIC_ID=Reactlyve_Logo_bi78md
CLOUDINARY_OVERLAY_WIDTH_PERCENT=0.15

# Notification URL for Cloudinary to POST moderation results
# This value is included with each upload and manual review request so
# callbacks are sent directly to your server. If unset, Cloudinary will
# use any account-level webhook you have configured.
CLOUDINARY_NOTIFICATION_URL=http://localhost:3000/api/webhooks/cloudinary

# The URL must be publicly accessible. Check the Cloudinary dashboard for
# failed webhook attempts when debugging callbacks.

# Cloudinary's AWS Rekognition add-on handles moderation, so no additional AWS keys are required

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
    *   Updating profile settings, including moderation preferences.
*   **`/api/admin`**: Admin-specific operations.
    *   Listing users.
    *   Modifying user roles.
    *   Removing users.
*   Setting user message/reaction limits and moderation preferences.
*   Retrieving detailed user information, including moderation settings.
*   Getting pending moderation counts for all users via `GET /api/admin/moderation/pending-counts`.
    The response for each user contains `messages_pending`, `reactions_pending`,
    and `pending_manual_reviews` (the sum of the two). Example:

    ```json
    [
      {
        "id": "<user-id>",
        "email": "user@example.com",
        "name": "Jane",
        "messages_pending": 1,
        "reactions_pending": 0,
        "pending_manual_reviews": 1
      }
    ]
    ```
*   Fetching Cloudinary IDs of items awaiting manual review for a specific user.
    Use `GET /api/admin/users/:userId/pending-moderation`, which returns:

    ```json
    {
      "messages": [ { "id": "<uuid>", "publicId": "messages/abc123" } ],
      "reactions": [ { "id": "<uuid>", "publicId": "reactions/def456" } ]
    }
    ```
*   **`/api/webhooks`**: Endpoints for third-party callbacks, currently handling Cloudinary moderation results.

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

## Moderation Workflow

Image and video uploads can be automatically checked for inappropriate content.
Users may enable or disable moderation from the frontend. Guest accounts start
with both image and video moderation enabled by default. When enabled, uploads
are scanned using Cloudinary's AWS Rekognition add-on (`aws_rek` for images and
`aws_rek_video` for videos) and the results are stored
in the new `moderation_status` and `moderation_details` columns on the
`messages` and `reactions` tables. Assets that are flagged are marked as
`rejected` and can be submitted for manual review via the
`/messages/:id/manual-review` or `/reactions/:id/manual-review` endpoints.
When moderation is turned off for a user, the stored status is `not_required`.
These endpoints now simply mark the record as `manual_review` without
re-submitting the asset to Cloudinary. Moderators can override the rejection
directly from the AWS Rekognition tab in the Cloudinary console.
If a webhook is configured in Cloudinary, the final decision will be posted back
to the backend. When a moderation decision is returned with status `approved`,
the webhook handler calls Cloudinary's `explicit` API to generate the overlay
and thumbnail derivatives so they appear alongside the original asset. The
overlay image used can be customized via the `CLOUDINARY_OVERLAY_PUBLIC_ID`
environment variable. The width of the overlay is relative to the underlying
asset and can be adjusted via `CLOUDINARY_OVERLAY_WIDTH_PERCENT` (defaults to
`0.15`).
To avoid race conditions where Cloudinary reports the asset too soon,
the server now retries the `explicit` request several times with a short
delay. Rejected assets will not have derivatives until they are manually
approved.

Video moderation results may arrive asynchronously via Cloudinary. The
`/api/webhooks/cloudinary` endpoint receives these callbacks and updates the
database once moderation is complete.

If callbacks do not appear, confirm the endpoint is publicly reachable and check
the "Webhooks" log in your Cloudinary dashboard for delivery attempts.

When running in development mode, both upload requests and incoming webhook
payloads are printed to the console so you can verify Cloudinary is attempting
to reach the backend. The logged upload output now includes the complete POST
body sent to Cloudinary for easier debugging of moderation settings.
The webhook handler also logs the response from Cloudinary's `explicit` API,
so you can confirm derived assets were generated.

Database changes required for these features are located in the
`migrations` folder and include additional moderation columns and indexes.

If you run the server from the compiled `dist` folder, remember to execute
`npm run build` after pulling updates so the moderation queries are included.

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
