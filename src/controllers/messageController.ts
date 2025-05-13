import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { query } from '../config/database.config';
import crypto from 'crypto';
import "dotenv/config";
import { uploadVideoToCloudinary } from '../routes/messageRoutes';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
    };
}

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for messages (separate from reactions/replies)
}).single('image');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadToCloudinary = (buffer: Buffer): Promise<string> => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'message_images' },
        (error, result) => {
            if (error) return reject(error);
            return resolve(result?.secure_url || '');
        }
        );
        
        const readableStream = new Readable();
        readableStream.push(buffer);
        readableStream.push(null);
        readableStream.pipe(uploadStream);
    });
};

const generateShareableLink = (): string => {
    const baseUrl = process.env.FRONTEND_URL || '';
    const uniqueId = crypto.randomBytes(8).toString('hex');
    return `${baseUrl}/m/${uniqueId}`;
};

export const sendMessage = (req: AuthenticatedRequest, res: Response) => {
    upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
        return res.status(500).json({ error: `Server error: ${err.message}` });
    }

    try {
        const { content, passcode } = req.body;
        
        const senderId = req.user?.id;

        // Validate input
        if (!content) {
            return res.status(400).json({ error: 'Message content is required' });
        }

        // Handle image upload if present
        let imageUrl = null;
        if (req.file) {
            imageUrl = await uploadToCloudinary(req.file.buffer);
        }

        // Generate shareable link
        const shareableLink = generateShareableLink();

        // Store message in database
        const { rows } = await query(
            `INSERT INTO messages (
            senderId, content, imageUrl, passcode, shareableLink
            ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [senderId, content, imageUrl, passcode || null, shareableLink]
        );

        const message = rows[0];

        return res.status(201).json({
            id: message.id,
            senderId: message.senderid,
            content: message.content,
            imageUrl: message.imageurl,
            shareableLink: message.shareablelink,
            createdAt: message.createdat,
            updatedAt: message.updatedat
        });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json({ error: 'Failed to send message' });
    }
    });
};

export const getAllMessages = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const senderId = req.user?.id;

      if (!senderId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      // Total messages
      const countResult = await query(
        'SELECT COUNT(*) FROM messages WHERE senderId = $1',
        [senderId]
      );
      const totalMessages = parseInt(countResult.rows[0].count);

      // Total viewed messages
      const viewedResult = await query(
        'SELECT COUNT(*) FROM messages WHERE senderId = $1 AND viewed = true',
        [senderId]
      );
      const viewedMessages = parseInt(viewedResult.rows[0].count);

      // Total reactions (linked to user's messages)
      const reactionResult = await query(
        `SELECT COUNT(*) 
         FROM reactions r
         INNER JOIN messages m ON r.messageId = m.id
         WHERE m.senderId = $1`,
        [senderId]
      );
      const totalReactions = parseInt(reactionResult.rows[0].count);

      // Paginated message list
      const { rows: messages } = await query(
        `SELECT id, content, imageUrl, shareableLink, passcode, viewed, 
                createdAt, updatedAt
         FROM messages 
         WHERE senderId = $1 
         ORDER BY createdAt DESC 
         LIMIT $2 OFFSET $3`,
        [senderId, limit, offset]
      );

      const totalPages = Math.ceil(totalMessages / limit);
      const viewRate = totalMessages > 0 ? (viewedMessages / totalMessages) * 100 : 0;
      const reactionRate = totalMessages > 0 ? (totalReactions / totalMessages) * 100 : 0;

      return res.status(200).json({
        messages,
        pagination: {
          totalMessages,
          totalPages,
          currentPage: page,
          limit
        },
        stats: {
          totalMessages,
          viewedMessages,
          viewRate: viewRate.toFixed(2) + '%',
          totalReactions,
          reactionRate: reactionRate.toFixed(2) + '%'
        }
      });
    } catch (error) {
      console.error('Error getting all messages:', error);
      return res.status(500).json({ error: 'Failed to get all messages' });
    }
};

export const getMessageById = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const senderId = req.user?.id;

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({ error: 'Invalid message ID format' });
      }

      // Query the database
      const { rows } = await query(
        'SELECT * FROM messages WHERE id = $1 AND senderId = $2',
        [id, senderId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const message = rows[0];
      
      return res.status(200).json(message);
    } catch (error) {
      console.error('Error getting message by ID:', error);
      return res.status(500).json({ error: 'Failed to get message' });
    }
};

export const getMessageByShareableLink = async (req: Request, res: Response) => {
    try {
        const { linkId } = req.params;
        const shareableLink = `${process.env.FRONTEND_URL}/m/${linkId}`;
        // Query the database
        const { rows } = await query(
          'SELECT * FROM messages WHERE shareableLink = $1',
          [shareableLink]
        );

        if (rows.length === 0) {
          return res.status(404).json({ error: 'Message not found' });
        }

        const message = rows[0];

        const hasPasscode = !!message.passcode;

        if (hasPasscode) {
          return res.status(200).json({
            id: message.id,
            hasPasscode: true,
            createdAt: message.createdat
          });
        }

        // Return message without sensitive information
        return res.status(200).json({
          id: message.id,
          content: message.content,
          imageUrl: message.imageurl,
          hasPasscode: false,
          createdAt: message.createdat,
        });
    } catch (error) {
      console.error('Error getting message by shareable link:', error);
      return res.status(500).json({ error: 'Failed to get message' });
    }
};

export const verifyMessagePasscode = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { passcode } = req.body;
      
      const shareableLink = `${process.env.FRONTEND_URL}/m/${id}`;

      if (!passcode) {
        return res.status(400).json({ error: 'Passcode is required' });
      }
      
      // Query the database
      const { rows } = await query(
        'SELECT * FROM messages WHERE shareableLink = $1 AND passcode LIKE $2',
        [shareableLink, `%${passcode}`]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const message = rows[0];
      
      // Verify passcode
      if (message.passcode !== passcode) {
        return res.status(403).json({ 
          error: 'Invalid passcode',
          verified: false
        });
      }
      
      // Return successful response with message data
      return res.status(200).json({
        verified: true,
        message: {
          id: message.id,
          content: message.content,
          imageUrl: message.imageurl,
          hasPasscode: true,
          passcodeVerified: true,
          createdAt: message.createdat,
        }
      });
    } catch (error) {
      console.error('Error verifying passcode:', error);
      return res.status(500).json({ error: 'Failed to verify passcode' });
    }
};

export const recordReaction = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Check if we received a video file
      if (!req.file) {
        return res.status(400).json({ error: 'No reaction video provided' });
      }

      console.log('File details:', {
        mimetype: req.file.mimetype,
        size: req.file.size,
        bufferLength: req.file.buffer.length
      });
      
      // Get message to confirm it exists
      const { rows } = await query(
        'SELECT id FROM messages WHERE id = $1 OR shareableLink LIKE $2',
        [id, `%${id}`]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const messageId = rows[0].id;
      
      // Process the video (upload to Cloudinary)
      let videoUrl;
      try {
        videoUrl = await uploadVideoToCloudinary(req.file.buffer);
        console.log('Video uploaded successfully:', videoUrl);
      } catch (uploadError) {
        console.error('Error uploading to Cloudinary:', uploadError);
        return res.status(500).json({ error: 'Failed to upload video', details: uploadError });
      }
      // Generate thumbnail (mock for this example)
      const thumbnailUrl = videoUrl;
      
      // Calculate video duration (mock for this example - in reality would extract from video metadata)
      const duration = Math.floor(Math.random() * 30) + 5; // Mock 5-35 seconds
      
      // Save reaction in database with all required fields
      await query(
        `INSERT INTO reactions 
          (messageId, videoUrl, thumbnailUrl, duration, createdAt, updatedAt) 
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [messageId, videoUrl, thumbnailUrl, duration]
      );
      
      // Notify sender that there's a new reaction (implementation depends on your notification system)
      try {
        // Get sender info
        const { rows: senderRows } = await query(
          'SELECT senderId FROM messages WHERE id = $1',
          [messageId]
        );
        
        if (senderRows.length > 0) {
          const senderId = senderRows[0].senderId;
          // Here you would trigger any notification logic
          console.log(`Notifying user ${senderId} about new reaction to message ${messageId}`);
        }
      } catch (notificationError) {
        console.error('Error sending notification:', notificationError);
        // Don't fail the request if notification fails
      }
      
      return res.status(201).json({ 
        success: true,
        message: 'Reaction recorded successfully'
      });
    } catch (error) {
      console.error('Error recording reaction:', error);
      return res.status(500).json({ error: 'Failed to record reaction' });
    }
};

export const recordReply = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Check if we received a video file
      if (!req.file) {
        return res.status(400).json({ error: 'No reply video provided' });
      }

      console.log('File details:', {
        mimetype: req.file.mimetype,
        size: req.file.size,
        bufferLength: req.file.buffer.length
      });
      
      // Get message to confirm it exists
      const { rows } = await query(
        'SELECT id FROM messages WHERE id = $1 OR shareableLink LIKE $2',
        [id, `%${id}`]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const messageId = rows[0].id;
      
      // Process the video (upload to Cloudinary)
      let videoUrl;
      try {
        videoUrl = await uploadVideoToCloudinary(req.file.buffer);
        console.log('Reply video uploaded successfully:', videoUrl);
      } catch (uploadError) {
        console.error('Error uploading reply to Cloudinary:', uploadError);
        return res.status(500).json({ error: 'Failed to upload reply video', details: uploadError });
      }
      
      // Generate thumbnail (mock for this example)
      const thumbnailUrl = videoUrl;
      
      // Calculate video duration (mock for this example - in reality would extract from video metadata)
      const duration = Math.floor(Math.random() * 180) + 5; // Mock 5-185 seconds (up to 3 minutes)
      
      // Save reply in database with all required fields
      await query(
        `INSERT INTO replies 
          (messageId, videoUrl, thumbnailUrl, duration, createdAt, updatedAt) 
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [messageId, videoUrl, thumbnailUrl, duration]
      );
      
      // Notify sender that there's a new reply (implementation depends on your notification system)
      try {
        const { rows: senderRows } = await query(
          'SELECT senderId FROM messages WHERE id = $1',
          [messageId]
        );
        
        if (senderRows.length > 0) {
          const senderId = senderRows[0].senderId;
          console.log(`Notifying user ${senderId} about new reply to message ${messageId}`);
        }
      } catch (notificationError) {
        console.error('Error sending notification:', notificationError);
        // Don't fail the request if notification fails
      }
      
      return res.status(201).json({ 
        success: true,
        message: 'Reply recorded successfully'
      });
    } catch (error) {
      console.error('Error recording reply:', error);
      return res.status(500).json({ error: 'Failed to record reply' });
    }
};

export const skipReaction = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const shareableLink = `${process.env.FRONTEND_URL}/m/${id}`;
      // Get message to confirm it exists
      const { rows } = await query(
        'SELECT * FROM messages WHERE shareableLink = $1',
        [shareableLink]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const messageId = rows[0].id;
      
      // Optionally log that reaction was skipped
      // await query(
      //   'INSERT INTO reaction_skips (messageId, createdAt) VALUES ($1, NOW())',
      //   [messageId]
      // );
      
      return res.status(200).json({ 
        success: true,
        message: 'Reaction skipped'
      });
    } catch (error) {
      console.error('Error skipping reaction:', error);
      return res.status(500).json({ error: 'Failed to skip reaction' });
    }
};