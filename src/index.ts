import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { Pool } from 'pg';
import { dbConfig } from './config/database.config';
import passport from './config/passport';
import authRoutes from './routes/authRoutes';
import messageRoutes from './routes/messageRoutes';
import userProfileRoutes from './routes/userProfileRoutes';
import adminRoutes from './routes/adminRoutes';
import webhookRoutes from './routes/webhookRoutes';

// Import for cron job
import cron from 'node-cron';
import { deleteInactiveAccounts } from './jobs/accountCleanupJob';

const app = express();
app.set('trust proxy', 2);

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(passport.initialize());

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('Incoming request:', req.method, req.originalUrl);
  }
  next();
});

// Create a connection pool
const pool = new Pool(dbConfig);

// Test the connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Connected to database:', res.rows[0]);
  }
});
app.use('/api/auth', authRoutes);
app.use('/api', messageRoutes); // Assuming this is for general messages, e.g. /api/messages
app.use('/api/profile', userProfileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);

app.get(
  "/",
  (req, res) => {
    res.send("its working");
  }
);

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT} in ${process.env.NODE_ENV}`);

  if (process.env.NODE_ENV === 'development') {
    console.log('Cloudinary notification URL (if any):', process.env.CLOUDINARY_NOTIFICATION_URL || 'using account webhook');
  }

  // Schedule the inactive account cleanup job
  cron.schedule('0 0 * * *', async () => {
    console.log('Running scheduled job: deleteInactiveAccounts at midnight');
    try {
      await deleteInactiveAccounts();
      console.log('Scheduled job: deleteInactiveAccounts completed successfully.');
    } catch (error) {
      console.error('Scheduled job: deleteInactiveAccounts encountered an error:', error);
    }
  }, {
    timezone: "UTC" // Explicitly setting UTC, can be adjusted as needed
  });
  console.log('Inactive account cleanup job scheduled to run daily at midnight UTC.');
});
server.setTimeout(300000); // 300,000 milliseconds = 5 minutes
