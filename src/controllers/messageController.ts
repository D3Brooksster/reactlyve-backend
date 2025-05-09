import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { query } from '../config/database.config';
import crypto from 'crypto';
import "dotenv/config";

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
    };
  }

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
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
        senderId: message.senderId,
        content: message.content,
        imageUrl: message.imageUrl,
        shareableLink: message.shareableLink,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
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
  
      // Optional query parameters for pagination
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;
  
      // Query for messages count
      const countResult = await query(
        'SELECT COUNT(*) FROM messages WHERE senderId = $1',
        [senderId]
      );
      const totalMessages = parseInt(countResult.rows[0].count);
      
      // Query for messages with pagination
      const { rows: messages } = await query(
        `SELECT id, content, imageUrl, shareableLink, passcode, viewed, 
                createdAt, updatedAt
         FROM messages 
         WHERE senderId = $1 
         ORDER BY createdAt DESC 
         LIMIT $2 OFFSET $3`,
        [senderId, limit, offset]
      );
  
      // Calculate pagination metadata
      const totalPages = Math.ceil(totalMessages / limit);
      
      return res.status(200).json({
        messages,
        pagination: {
          totalMessages,
          totalPages,
          currentPage: page,
          limit
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
      const shareableLink = `${process.env.BASE_URL || 'https://yourdomain.com'}/m/${linkId}`;
      
      // Query the database
      const { rows } = await query(
        'SELECT * FROM messages WHERE shareableLink = $1',
        [shareableLink]
      );
  
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }
  
      const message = rows[0];
      
      // Check if message is password protected
      if (message.passcode) {
        const { passcode } = req.query;
        
        // If no passcode provided or incorrect passcode
        if (!passcode || passcode !== message.passcode) {
          return res.status(403).json({ 
            error: 'This message is password protected',
            requiresPasscode: true
          });
        }
      }
  
      // Mark message as viewed if not already
      if (!message.viewed) {
        await query(
          'UPDATE messages SET viewed = TRUE, updatedAt = NOW() WHERE id = $1',
          [message.id]
        );
      }
  
      // Return message without sensitive information
      return res.status(200).json({
        id: message.id,
        content: message.content,
        imageUrl: message.imageUrl,
        createdAt: message.createdAt,
        viewed: message.viewed
      });
    } catch (error) {
      console.error('Error getting message by shareable link:', error);
      return res.status(500).json({ error: 'Failed to get message' });
    }
  };