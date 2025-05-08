// src/routes/message.routes.ts
import { Router } from 'express';
import { sendMessage } from '../controllers/messageController'
import { requireAuth } from '../middlewares/middleware';

const router = Router();


router.post('/send', requireAuth, sendMessage);

export default router;