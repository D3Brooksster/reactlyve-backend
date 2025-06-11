import { Request, Response } from 'express';
import { query } from '../config/database.config';

export const handleCloudinaryModeration = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[CloudinaryWebhook] incoming payload:', JSON.stringify(req.body));
    if (process.env.NODE_ENV === 'development') {
      console.log('[CloudinaryWebhook] headers:', JSON.stringify(req.headers));
    }
    const { public_id, moderation_status, moderation_response } = req.body;
    if (!public_id || !moderation_status) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const details = moderation_response ? JSON.stringify(moderation_response) : null;

    const msgUpdate = await query(
      `UPDATE messages SET moderation_status = $1, moderation_details = $2
       WHERE original_imageurl LIKE '%' || $3 || '%'`,
      [moderation_status, details, public_id]
    );

    const reactUpdate = await query(
      `UPDATE reactions SET moderation_status = $1, moderation_details = $2
       WHERE original_videourl LIKE '%' || $3 || '%'`,
      [moderation_status, details, public_id]
    );

    if (process.env.NODE_ENV === 'development') {
      console.log('[CloudinaryWebhook] updated messages:', msgUpdate.rowCount,
                  'reactions:', reactUpdate.rowCount);
    }

    res.status(200).json({ received: true });
    return;
  } catch (err) {
    console.error('Error handling Cloudinary webhook:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
    return;
  }
};

