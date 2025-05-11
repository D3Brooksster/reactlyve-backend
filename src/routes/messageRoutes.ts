// src/routes/message.routes.ts
//@ts-nocheck
import { Router } from 'express';
import { sendMessage, getMessageByShareableLink, getMessageById, getAllMessages, verifyMessagePasscode, recordReaction, skipReaction } from '../controllers/messageController'
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
  
// export const uploadVideoToCloudinary = (buffer: Buffer): Promise<string> => {
//     return new Promise((resolve, reject) => {
//         const stream = cloudinary.uploader.upload_stream(
//         { resource_type: 'video', folder: 'reactions' },
//         (error, result) => {
//             if (error) return reject(error);
//             resolve(result?.secure_url || '');
//         }
//         );

//         Readable.from(buffer).pipe(stream);
//     });
//     };

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
        // Add additional options if needed
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


router.post('/messages/send', requireAuth, sendMessage);
router.get('/messages', requireAuth, getAllMessages);
router.get('/messages/:id', getMessageById);
router.get('/messages/view/:linkId', getMessageByShareableLink);
router.post('/messages/:id/verify-passcode', verifyMessagePasscode);
router.post('/reactions/:id', upload.single('video'), recordReaction);
router.post('/reactions/:id/skip', skipReaction);




export default router;