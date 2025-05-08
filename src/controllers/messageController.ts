import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { query } from '../config/database.config';
import crypto from 'crypto';
import "dotenv/config";

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

export const sendMessage = (req: Request, res: Response) => {

    console.log('Request body:', req.body);
upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
    }

    try {
    const { content, passcode } = req.body;
    //@ts-ignore
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
