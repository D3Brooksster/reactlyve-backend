import { Request, Response } from 'express';
import { query } from '../config/database.config';
import { v2 as cloudinary } from 'cloudinary';
import {
  SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING,
  IMAGE_OVERLAY_TRANSFORMATION_STRING
} from '../utils/cloudinaryUtils';

const explicitWithRetry = async (
  publicId: string,
  options: Record<string, any>,
  retries = 3,
  delayMs = 2000
) => {
  try {
    const result = await cloudinary.uploader.explicit(publicId, options);
    if (process.env.NODE_ENV === 'development') {
      console.log('[explicitWithRetry] result:', JSON.stringify(result));
    }
    return result;
  } catch (err: any) {
    if (
      err &&
      (err.http_code === 404 || err.http_code >= 500 || err.http_code === 409 || err.http_code === 423) &&
      retries > 0
    ) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[explicitWithRetry] ${err.message || 'Error'} (code ${err.http_code}), retrying in ${delayMs}ms...`
        );
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return explicitWithRetry(publicId, options, retries - 1, delayMs);
    }
    throw err;
  }
};

export const handleCloudinaryModeration = async (req: Request, res: Response): Promise<void> => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[CloudinaryWebhook] incoming payload:', JSON.stringify(req.body));
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
      console.log(
        '[CloudinaryWebhook] updated messages:',
        msgUpdate.rowCount,
        'reactions:',
        reactUpdate.rowCount
      );
      if ((msgUpdate.rowCount ?? 0) === 0 && (reactUpdate.rowCount ?? 0) === 0) {
        console.warn(
          '[CloudinaryWebhook] no database rows matched for public_id',
          public_id
        );
      }
    }

    // Generate derived assets only once moderation approves the asset
    if (moderation_status === 'approved') {
      let resourceType = req.body.resource_type as string | undefined;

      if (!resourceType && (msgUpdate.rowCount ?? 0) > 0) {
        const mtRes = await query(
          `SELECT mediatype FROM messages WHERE original_imageurl LIKE '%' || $1 || '%' LIMIT 1`,
          [public_id]
        );
        if (mtRes.rows.length) {
          resourceType = mtRes.rows[0].mediatype === 'video' ? 'video' : 'image';
        }
      } else if (!resourceType && (reactUpdate.rowCount ?? 0) > 0) {
        resourceType = 'video';
      }

      const explicitOpts: any = {
        type: 'upload',
        resource_type: resourceType || 'image',
        eager_async: true,
        eager:
          resourceType === 'video'
            ? [
                { raw_transformation: SMALL_FILE_VIDEO_OVERLAY_TRANSFORMATION_STRING },
                { format: 'jpg', crop: 'thumb', width: 200, height: 150, start_offset: '0', quality: 'auto' }
              ]
            : [{ raw_transformation: IMAGE_OVERLAY_TRANSFORMATION_STRING }],
        invalidate: true
      };

      if (process.env.CLOUDINARY_NOTIFICATION_URL) {
        explicitOpts.notification_url = process.env.CLOUDINARY_NOTIFICATION_URL;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[CloudinaryWebhook] generating derived assets:', {
          public_id,
          explicitOpts
        });
      }

      try {
        const explicitResult = await explicitWithRetry(public_id, explicitOpts);
        if (process.env.NODE_ENV === 'development') {
          console.log('[CloudinaryWebhook] explicit result:', JSON.stringify(explicitResult));
        }

        if (explicitResult && Array.isArray(explicitResult.eager) && explicitResult.eager.length > 0) {
          const overlayUrl = explicitResult.eager[0].secure_url as string | undefined;
          const thumbnailUrl = explicitResult.eager.length > 1 ? (explicitResult.eager[1].secure_url as string | undefined) : undefined;

          if (overlayUrl && (msgUpdate.rowCount ?? 0) > 0) {
            await query(
              `UPDATE messages SET imageurl = $1 WHERE original_imageurl LIKE '%' || $2 || '%'`,
              [overlayUrl, public_id]
            );
          }

          if (overlayUrl && (reactUpdate.rowCount ?? 0) > 0) {
            const updateFields = ['videourl = $1'];
            const params: any[] = [overlayUrl];
            let paramIdx = 2;
            if (thumbnailUrl) {
              updateFields.push(`thumbnailurl = $${paramIdx++}`);
              params.push(thumbnailUrl);
            }
            params.push(public_id);
            await query(
              `UPDATE reactions SET ${updateFields.join(', ')} WHERE original_videourl LIKE '%' || $${paramIdx} || '%'`,
              params
            );
          }
        }
      } catch (genErr) {
        console.error('[CloudinaryWebhook] failed to generate derivatives:', genErr);
      }
    }

    res.status(200).json({ received: true });
    return;
  } catch (err) {
    console.error('Error handling Cloudinary webhook:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
    return;
  }
};

