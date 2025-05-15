import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { query } from '../config/database.config';
import crypto from 'crypto';
import "dotenv/config";
import { uploadToCloudinarymedia, uploadVideoToCloudinary } from '../routes/messageRoutes';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
    };
}

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only images and videos
    const allowedTypes = [
      'image/jpeg', 
      'image/png', 
      'image/gif', 
      'image/webp',
      'video/mp4',
      'video/webm',
      'video/quicktime' // .mov files
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and videos are allowed'));
    }
  }
}).single('media'); 



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
      
      // Handle media upload if present
      let mediaUrl = null;
      let mediaType = null;
      
      if (req.file) {
        // Determine if it's an image or video based on MIME type
        mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
        
        // Upload to Cloudinary with proper resource_type
        mediaUrl = await uploadToCloudinarymedia(
          req.file.buffer, 
          mediaType as 'image' | 'video'
        );
      }
      
      // Generate shareable link
      const shareableLink = generateShareableLink();
      
      // Store message in database
      const { rows } = await query(
        `INSERT INTO messages (
          senderId, content, imageUrl, passcode, shareableLink, mediaType
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [senderId, content, mediaUrl, passcode || null, shareableLink, mediaType]
      );
      
      const message = rows[0];
      
      return res.status(201).json({
        id: message.id,
        senderId: message.senderid,
        content: message.content,
        imageUrl: message.imageurl,
        mediaType: message.mediatype,
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

      const reactionResult = await query(
        `SELECT COUNT(*) 
         FROM reactions r
         INNER JOIN messages m ON r.messageId = m.id
         WHERE m.senderId = $1`,
        [senderId]
      );
      const totalReactions = parseInt(reactionResult.rows[0].count);

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
      const { id } = req.params
  
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({ error: 'Invalid message ID format' });
      }

      // Query the database
      // const { rows } = await query(
      //   'SELECT * FROM messages WHERE id = $1',
      //   [id]
      // );
      // let messageid = id
      // const {rows} = await query(
      //   'SELECT * FROM reactions where id = $1',
      //   [messageid ]
      // ) 

      const { rows } = await query(
      `SELECT m.*, r.id as reactionId, r.videoUrl, r.thumbnailUrl, r.duration, r.createdAt as reactionCreatedAt, r.updatedAt as reactionUpdatedAt
      FROM messages m
      LEFT JOIN reactions r ON m.id = r.messageId
      WHERE m.id = $1`,
      [id]
    );
  
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const message = rows[0];
      console.log(message,'get message by id')
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
      
      const { rows } = await query(
        'SELECT * FROM messages WHERE shareableLink = $1 AND passcode LIKE $2',
        [shareableLink, `%${passcode}`]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const message = rows[0];
      
      if (message.passcode !== passcode) {
        return res.status(403).json({ 
          error: 'Invalid passcode',
          verified: false
        });
      }
      
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

    if (!req.file) {
      return res.status(400).json({ error: 'No reaction video provided' });
    }

    // Get message to confirm it exists
    const { rows } = await query(
      'SELECT id FROM messages WHERE id = $1 OR shareableLink LIKE $2',
      [id, `%${id}`]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const messageId = rows[0].id;

    let videoUrl;
    try {
      videoUrl = await uploadVideoToCloudinary(req.file.buffer);
      console.log('Video uploaded successfully:', videoUrl);
    } catch (uploadError) {
      console.error('Error uploading to Cloudinary:', uploadError);
      return res.status(500).json({ error: 'Failed to upload video', details: uploadError });
    }

    const thumbnailUrl = videoUrl;
    const duration = Math.floor(Math.random() * 30) + 5;

    // Check if a reaction already exists for the message
    const { rows: existingReactions } = await query(
      'SELECT id FROM reactions WHERE messageId = $1',
      [messageId]
    );

    if (existingReactions.length > 0) {
      // Update existing reaction
      await query(
        `UPDATE reactions 
         SET videoUrl = $1, thumbnailUrl = $2, duration = $3, updatedAt = NOW() 
         WHERE messageId = $4`,
        [videoUrl, thumbnailUrl, duration, messageId]
      );
    } else {
      // Insert new reaction
      await query(
        `INSERT INTO reactions 
          (messageId, videoUrl, thumbnailUrl, duration, createdAt, updatedAt) 
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [messageId, videoUrl, thumbnailUrl, duration]
      );
    }

    // Notify sender
    try {
      const { rows: senderRows } = await query(
        'SELECT senderId FROM messages WHERE id = $1',
        [messageId]
      );

      if (senderRows.length > 0) {
        const senderId = senderRows[0].senderId;
        console.log(`Notifying user ${senderId} about new reaction to message ${messageId}`);
      }
    } catch (notificationError) {
      console.error('Error sending notification:', notificationError);
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

export const recordTextReply = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    // validate
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Reply text is required' });
    }
    if (text.length > 500) {
      return res
        .status(400)
        .json({ error: 'Reply text cannot exceed 500 characters' });
    }
    console.log('Incoming reply text:', text);
    console.log('Replying to message ID:', id);
      
    // make sure message exists
    const { rows } = await query(
      'SELECT id FROM messages WHERE id = $1',
      [id]
    );
    console.log('Message fetch result:', rows);
      
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // update that row's isReply column with the reply text
    await query(
      `UPDATE messages
         SET isReply = $1,
             updatedAt = NOW()
       WHERE id = $2`,
      [text.trim(), id]
    );

    return res.status(200).json({
      success: true,
      message: 'Reply saved in isReply column',
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
      const { rows } = await query(
        'SELECT * FROM messages WHERE shareableLink = $1',
        [shareableLink]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const messageId = rows[0].id;
      
      return res.status(200).json({ 
        success: true,
        message: 'Reaction skipped'
      });
    } catch (error) {
      console.error('Error skipping reaction:', error);
      return res.status(500).json({ error: 'Failed to skip reaction' });
    }
  };
  
  export const deleteMessageAndReaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // First, find the message ID (in case it's from shareableLink)
    const { rows } = await query(
      'SELECT id FROM messages WHERE id = $1 OR shareableLink LIKE $2',
      [id, `%${id}`]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const messageId = rows[0].id;

    // Delete reaction if exists
    await query('DELETE FROM reactions WHERE messageId = $1', [messageId]);

    // Delete the message itself
    await query('DELETE FROM messages WHERE id = $1', [messageId]);

    return res.status(200).json({
      success: true,
      message: `Message and related reaction deleted successfully.`,
    });

  } catch (error) {
    console.error('Error deleting message and reaction:', error);
    return res.status(500).json({ error: 'Failed to delete message and reaction' });
  }
};
