import { Request, Response, NextFunction } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { query } from '../config/database.config';
import { extractPublicIdAndResourceType } from '../utils/cloudinaryUtils';

// Ensure Cloudinary is configured (it should be from the main app, but good practice)
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error("Cloudinary environment variables are not set.");
  // Potentially throw an error or exit if essential for the controller's operation
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export const handleCloudinaryModerationWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const signature = req.headers['x-cld-signature'] as string;
    const timestampHeader = req.headers['x-cld-timestamp'] as string;
    
    if (!(req.body instanceof Buffer)) {
      // This case should ideally not be hit if express.raw() is correctly configured for the route
      console.error("Webhook body is not a Buffer. Check middleware configuration.");
      res.status(500).json({ error: "Internal server error: Invalid body type." });
      return;
    }
    const bodyString = req.body.toString();


    if (!signature || !timestampHeader || !bodyString) {
        console.warn('Missing signature, timestamp, or body for webhook verification.');
        res.status(400).json({ error: 'Missing signature or timestamp or body' });
        return;
    }

    const numericTimestamp = parseInt(timestampHeader, 10);
    if (isNaN(numericTimestamp)) {
        console.warn('Invalid timestamp header received for webhook.');
        res.status(400).json({ error: 'Invalid timestamp format' });
        return;
    }

    // Assuming the globally configured api_secret is used by default.
    // The error TS2345 indicated the 4th parameter was expected as a number (valid_for_seconds).
    const oneHourInSeconds = 3600;
    const isValidSignature = cloudinary.utils.verifyNotificationSignature(
      bodyString,         // 1st: body string
      numericTimestamp,   // 2nd: timestamp (number)
      signature,          // 3rd: signature (string)
      oneHourInSeconds    // 4th: valid_for_seconds (number)
    );
    
    if (!isValidSignature) {
      console.warn('Invalid Cloudinary webhook signature.');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Signature is valid, proceed with processing the payload
    const payload = JSON.parse(bodyString); // req.body would already be parsed if using express.json() before this

    const public_id = payload.public_id;
    const cloudinaryModerationStatus = payload.moderation_status; // Cloudinary's status: 'approved', 'rejected', 'pending', 'failed'
    const resource_type = payload.resource_type; // 'image' or 'video'
    const moderationResponse = payload.moderation_response || {}; // Full response from Rekognition or other moderation service

    let internalStatus: string;
    let moderationDetailsText: string | null = null;

    if (cloudinaryModerationStatus === 'approved') {
      internalStatus = 'approved';
    } else if (cloudinaryModerationStatus === 'rejected') {
      internalStatus = 'rejected';
      moderationDetailsText = JSON.stringify(moderationResponse.moderation_labels || moderationResponse);
    } else if (cloudinaryModerationStatus === 'pending') {
      // This case might occur if a notification is sent while still pending,
      // or if it's an initial notification before final status.
      // We generally expect final status notifications ('approved', 'rejected', 'failed').
      console.log(`Webhook received for pending moderation: ${public_id}. No DB update needed yet.`);
      res.status(200).json({ message: 'Pending notification received, no action taken.' });
      return;
    } else { // 'failed' or any other status
      internalStatus = 'failed';
      moderationDetailsText = JSON.stringify(moderationResponse || { error: 'Cloudinary moderation process failed' });
    }
    
    console.log(`Processing webhook for public_id: ${public_id}, status: ${internalStatus}, resource_type: ${resource_type}`);

    let dbResult;
    if (resource_type === 'image' && public_id) {
      // We need to search using the public_id from the original_imageurl.
      // The original_imageurl might be a full URL.
      // We will assume original_imageurl stores the full URL and extract public_id from it,
      // or more simply, if we know the original_imageurl IS the public_id or contains it in a predictable way.
      // For now, using LIKE based on the subtask description, but this might need refinement
      // if original_imageurl is just the public_id, then `original_imageurl = $3` would be better.
      dbResult = await query(
        `UPDATE messages 
         SET moderation_status = $1, moderation_details = $2, imageurl = CASE WHEN $1 = 'approved' THEN original_imageurl ELSE NULL END
         WHERE original_imageurl LIKE '%' || $3 || '%'
         RETURNING id;`,
        [internalStatus, moderationDetailsText, public_id]
      );
      if (dbResult && typeof dbResult.rowCount === 'number' && dbResult.rowCount > 0) {
        console.log(`Updated message moderation status for public_id: ${public_id}. Rows affected: ${dbResult.rowCount}`);
      } else {
        console.log(`No message found with original_imageurl containing public_id: ${public_id} (or DB result/rowCount was unusual).`);
      }
    } else if (resource_type === 'video' && public_id) {
      dbResult = await query(
        `UPDATE reactions 
         SET moderation_status = $1, moderation_details = $2, videourl = CASE WHEN $1 = 'approved' THEN original_videourl ELSE NULL END
         WHERE original_videourl LIKE '%' || $3 || '%'
         RETURNING id;`,
        [internalStatus, moderationDetailsText, public_id]
      );
      if (dbResult && typeof dbResult.rowCount === 'number' && dbResult.rowCount > 0) {
        console.log(`Updated reaction moderation status for public_id: ${public_id}. Rows affected: ${dbResult.rowCount}`);
      } else {
        console.log(`No reaction found with original_videourl containing public_id: ${public_id} (or DB result/rowCount was unusual).`);
      }
    } else {
      console.warn(`Webhook for unhandled resource_type or missing public_id: ${resource_type}, ${public_id}`);
    }

    res.status(200).json({ message: 'Webhook received and processed' });

  } catch (error: any) {
    console.error('Error handling Cloudinary webhook:', error);
    // Pass the error to the Express error handling middleware
    next(error); 
  }
};
