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

const app = express();

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
  console.log('Incoming request:', req.method, req.originalUrl);
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

app.get(
  "/",
  (req, res) => {
    res.send("its working");
  }
);

app.listen(process.env.PORT, async () => {
  console.log(`Server listening on port ${process.env.PORT} in ${process.env.NODE_ENV}`);
});
