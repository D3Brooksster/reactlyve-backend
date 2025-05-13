// src/routes/message.routes.ts
//@ts-nocheck
import { Router } from 'express';
import { sendMessage, getMessageByShareableLink, getMessageById, getAllMessages, verifyMessagePasscode, recordReaction, skipReaction, deleteMessageAndReaction, recordReply } from '../controllers/messageController'
import { requireAuth } from '../middlewares/middleware';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

const router = Router();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
    api_key: process.env.CLOUDINARY_API_KEY!,
    api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const upload = multer({
  storage: multer.memoryStorage(), // 👈 this allows access to file.buffer
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!') as any, false);
    }
  }
});

export const uploadVideoToCloudinary = (buffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Add logging to verify buffer content
    console.log('Buffer size:', buffer.length);
    if (buffer.length === 0) {
      return reject(new Error('Empty buffer received'));
    }

    const stream = cloudinary.uploader.upload_stream(
      { 
        resource_type: 'video', 
        folder: 'reactions',
        format: 'mp4',
        transformation: [
          { quality: 'auto' },
          { fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          return reject(error);
        }
        resolve(result?.secure_url || '');
      }
    );

    // Stream the buffer to Cloudinary
    Readable.from(buffer).pipe(stream);
  });
};

export const uploadToCloudinarymedia = async (buffer: Buffer, resourceType: 'image' | 'video'): Promise<string> => {
  try {
    // Convert buffer to Base64 string
    const base64Data = buffer.toString('base64');
    
    // Determine file format and prefix based on resource type
    const prefix = resourceType === 'image' ? 'data:image/jpeg;base64,' : 'data:video/mp4;base64,';
    
    // Create data URI
    const dataUri = `${prefix}${base64Data}`;
    
    // Upload to Cloudinary
    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload(
        dataUri,
        {
          resource_type: resourceType, // 'image' or 'video'
          folder: 'messages',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
    });
    
    // Return the URL
    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload file to Cloudinary');
  }
};


router.post('/messages/send', requireAuth, sendMessage);
router.get('/messages', requireAuth, getAllMessages);
router.get('/messages/:id', getMessageById);
router.get('/messages/view/:linkId', getMessageByShareableLink);
router.post('/messages/:id/verify-passcode', verifyMessagePasscode);
router.post('/reactions/:id', upload.single('video'), recordReaction);
router.post('/replies/:id', upload.single('video'), recordReply);
router.post('/reactions/:id/skip', skipReaction);
router.delete('/messages/:id/delete', deleteMessageAndReaction);

export default router;