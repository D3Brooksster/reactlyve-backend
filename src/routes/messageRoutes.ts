// src/routes/message.routes.ts
//@ts-nocheck
import { Router } from 'express';
import {
  sendMessage,
  getMessageByShareableLink,
  getMessageById,
  getAllMessages,
  verifyMessagePasscode,
  recordReaction,
  skipReaction,
  deleteMessageAndReaction,
  recordTextReply,
  initReaction,         
  uploadReactionVideo,
  getReactionsByMessageId
} from '../controllers/messageController';
import { requireAuth } from '../middlewares/middleware';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

const router = Router();

// === Cloudinary setup ===
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

// === Multer setup for video uploads ===
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!') as any, false);
    }
  }
});

// === Cloudinary upload utilities ===
export const uploadVideoToCloudinary = (buffer: Buffer): Promise<{ secure_url: string; duration: number }> => {
  return new Promise((resolve, reject) => {
    console.log('Buffer size:', buffer.length);
    if (buffer.length === 0) return reject(new Error('Empty buffer received'));

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
        
        const secure_url = result?.secure_url || '';
        let duration = 0;
        if (result && typeof result.duration === 'number') {
          duration = Math.round(result.duration);
        } else if (result && result.video && typeof result.video.duration === 'number') {
          duration = Math.round(result.video.duration);
        }
        
        resolve({ secure_url, duration });
      }
    );

    Readable.from(buffer).pipe(stream);
  });
};

export const uploadToCloudinarymedia = async (buffer: Buffer, resourceType: 'image' | 'video'): Promise<string> => {
  try {
    const base64Data = buffer.toString('base64');
    const prefix = resourceType === 'image' ? 'data:image/jpeg;base64,' : 'data:video/mp4;base64,';
    const dataUri = `${prefix}${base64Data}`;

    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload(
        dataUri,
        {
          resource_type: resourceType,
          folder: 'messages',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
    });

    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload file to Cloudinary');
  }
};

// === Routes ===
router.post('/messages/send', requireAuth, sendMessage);
router.get('/messages', requireAuth, getAllMessages);
router.get('/messages/:id', getMessageById);
router.get('/messages/view/:linkId', getMessageByShareableLink);
router.post('/messages/:id/verify-passcode', verifyMessagePasscode);
router.post('/reactions/init/:messageId', initReaction);
router.put('/reactions/:reactionId/video', upload.single('video'), uploadReactionVideo);
router.post('/reactions/:id', upload.single('video'), recordReaction);
router.get('/reactions/message/:messageId', getReactionsByMessageId);
router.post('/reactions/:id/reply', recordTextReply);
router.post('/reactions/:id/skip', skipReaction);
router.delete('/messages/:id/delete', deleteMessageAndReaction);

export default router;
