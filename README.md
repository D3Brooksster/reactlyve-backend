# Project Title (Reactly App Backend - Assuming)

A brief description of the project.

## Features

*   User authentication (Google OAuth)
*   Messaging functionality
*   User profiles
*   Admin panel
*   Etc.

## Getting Started

### Prerequisites

*   Node.js
*   npm or yarn
*   PostgreSQL
*   Cloudinary Account

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd <repository-name>
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Set up environment variables:
    Create a `.env` file in the root directory and populate it with necessary configuration (database credentials, Cloudinary keys, JWT secrets, etc.). Refer to `.env.example` if available.
    ```env
    DATABASE_HOST=localhost
    DATABASE_PORT=5432
    DATABASE_NAME=your_db_name
    DATABASE_USER=your_db_user
    DATABASE_PASSWORD=your_db_password
    CLOUDINARY_CLOUD_NAME=your_cloud_name
    CLOUDINARY_API_KEY=your_api_key
    CLOUDINARY_API_SECRET=your_api_secret
    JWT_SECRET=your_jwt_secret
    PORT=3000
    # Add other variables as needed
    ```
4.  Run database migrations (if applicable). The project includes a migration for adding `last_login` to the `users` table (`migrations/V1__add_last_login_to_users.sql`). Tools like Flyway or node-pg-migrate can be used.

### Running the Application

*   **Development:**
    ```bash
    npm run dev
    ```
*   **Production:**
    ```bash
    npm run build
    npm start
    ```

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

## API Endpoints

(Details about API endpoints would go here)

## Contributing

(Guidelines for contributing to the project)

## License

(Project license information, e.g., ISC as per package.json)
