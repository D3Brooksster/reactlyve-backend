import { Router } from 'express';
import { handleCloudinaryModeration } from '../controllers/cloudinaryWebhookController';

const router = Router();

router.post('/cloudinary', handleCloudinaryModeration);

export default router;

