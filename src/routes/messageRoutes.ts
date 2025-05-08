// src/routes/message.routes.ts
//@ts-nocheck
import { Router } from 'express';
import { sendMessage,getAllMessage, getMessageByShareableLink, getMessageById, getAllMessages } from '../controllers/messageController'
import { requireAuth } from '../middlewares/middleware';

const router = Router();


router.post('/messages/send', requireAuth, sendMessage);
router.get('/messages', requireAuth, getAllMessages);
router.get('/messages/:id', requireAuth, getMessageById);
router.get('/messages/shared/:linkId', getMessageByShareableLink);



export default router;