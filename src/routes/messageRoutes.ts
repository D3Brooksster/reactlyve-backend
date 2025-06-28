// src/routes/message.routes.ts
//@ts-nocheck
import { Router } from 'express';
import {
  sendMessage,
  getMessageByShareableLink,
  getMessageById,
  getAllMessages,
  updateMessage, // Added import for updateMessage
  verifyMessagePasscode,
  recordReaction,
  deleteMessageAndReaction,
  recordTextReply,
  recordMediaReply,
  initReaction,         
  uploadReactionVideo,
  getReactionsByMessageId,
  getReactionById,
  deleteReactionById,
  deleteAllReactionsForMessage,
  submitMessageForManualReview,
  submitReactionForManualReview,
  createMessageLink,
  getMessageLinks,
  deleteMessageLink
} from '../controllers/messageController';
import { requireAuth } from '../middlewares/middleware';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
// Readable import removed as functions using it are moved

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

// Multer setup for reply media (video or audio)
const replyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video or audio files are allowed!') as any, false);
    }
  }
});

// Cloudinary utility functions uploadVideoToCloudinary and uploadToCloudinarymedia moved to utils/cloudinaryUtils.ts

// === Routes ===

router.post('/messages/send', requireAuth, sendMessage);
router.get('/messages', requireAuth, getAllMessages);
router.get('/messages/:id', getMessageById);
router.put('/messages/:id', requireAuth, updateMessage); // Added PUT route for updating messages
router.get('/messages/view/:linkId', getMessageByShareableLink);
router.post('/messages/:id/verify-passcode', verifyMessagePasscode);
router.post('/messages/:id/links', requireAuth, createMessageLink);
router.get('/messages/:id/links', requireAuth, getMessageLinks);
router.delete('/messages/links/:linkId', requireAuth, deleteMessageLink);
router.post('/reactions/init/:messageId', initReaction);
router.put('/reactions/:reactionId/video', upload.single('video'), uploadReactionVideo);
router.post('/reactions/:id', upload.single('video'), recordReaction);
router.get('/reactions/message/:messageId', getReactionsByMessageId);
router.post('/reactions/:id/reply', recordTextReply);
router.post('/reactions/:id/reply/media', replyUpload.single('media'), recordMediaReply);
router.delete('/messages/:id/delete', deleteMessageAndReaction);
router.get('/reactions/:id', getReactionById);
router.delete('/reactions/:reactionId/delete', requireAuth, deleteReactionById);
router.delete('/messages/:messageId/reactions/delete', requireAuth, deleteAllReactionsForMessage);
router.post('/messages/:id/manual-review', submitMessageForManualReview);
router.post('/reactions/:id/manual-review', submitReactionForManualReview);

export default router;
