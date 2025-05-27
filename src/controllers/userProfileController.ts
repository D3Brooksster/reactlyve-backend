import { Request, Response } from 'express';
import { query } from '../config/database.config';
import { AppUser } from '../entity/User'; // Changed User to AppUser
import { deleteFromCloudinary } from '../utils/cloudinaryUtils';
// import { deleteFromCloudinary } from './messageController'; // Not exported, so cannot be directly used

// AuthenticatedRequest interface removed, relying on global Express.Request augmentation

export const getMyProfile = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  const user = req.user as AppUser; // Changed User to AppUser

  // Extract user details from req.user and map to camelCase for the response
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    googleId: user.google_id, // Map google_id to googleId
    lastLogin: user.last_login ? new Date(user.last_login).toISOString() : null, // Map last_login to lastLogin
    role: user.role,
    createdAt: user.created_at ? new Date(user.created_at).toISOString() : null, // Map created_at to createdAt
    updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null, // Map updated_at to updatedAt
    blocked: user.blocked
  });
  return;
};

export const deleteMyAccount = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { // The req.user.id check is implicitly covered by this
    res.status(401).json({ error: 'Not authenticated or user ID missing' });
    return;
  }
  const user = req.user as AppUser; // Changed User to AppUser
  const userId = user.id; // Use asserted user

  try {
    await query('BEGIN', []);

    // 1. Fetch all messages by the user to get their IDs and imageURLs for Cloudinary deletion
    const { rows: messages } = await query('SELECT id, imageurl FROM messages WHERE senderid = $1', [userId]);

    for (const message of messages) {
      const messageId = message.id;
      const messageImageUrl = message.imageurl; // Corrected casing from 'imageurl'

      // 2. Fetch reactions for each message to get their IDs and videoURLs for Cloudinary deletion
      const { rows: reactions } = await query('SELECT id, videourl FROM reactions WHERE messageid = $1', [messageId]);
      const reactionIds = reactions.map(r => r.id);
      const reactionVideoUrls = reactions.map(r => r.videourl).filter(url => url); // Corrected casing and filter nulls

      // 3. Delete replies associated with these reactions (if any reactionIds)
      if (reactionIds.length > 0) {
        await query('DELETE FROM replies WHERE reactionid = ANY($1::uuid[])', [reactionIds]);
      }

      // 4. Delete reactions associated with the message
      // This must happen AFTER deleting replies due to foreign key constraints
      await query('DELETE FROM reactions WHERE messageid = $1', [messageId]);
      
      // 5. Delete the message itself
      // This must happen AFTER deleting reactions
      await query('DELETE FROM messages WHERE id = $1', [messageId]);

      // 6. Cloudinary Deletion
      if (messageImageUrl) {
        try {
          console.log(`Attempting to delete message image from Cloudinary: ${messageImageUrl}`);
          await deleteFromCloudinary(messageImageUrl);
          console.log(`Successfully deleted message image: ${messageImageUrl}`);
        } catch (cloudinaryError) {
          console.error(`Failed to delete message image ${messageImageUrl} from Cloudinary:`, cloudinaryError);
          // Do not re-throw, allow the process to continue
        }
      }

      for (const videoUrl of reactionVideoUrls) {
        if (videoUrl) {
          try {
            console.log(`Attempting to delete reaction video from Cloudinary: ${videoUrl}`);
            await deleteFromCloudinary(videoUrl);
            console.log(`Successfully deleted reaction video: ${videoUrl}`);
          } catch (cloudinaryError) {
            console.error(`Failed to delete reaction video ${videoUrl} from Cloudinary:`, cloudinaryError);
            // Do not re-throw, allow the process to continue
          }
        }
      }
    }

    // 7. Delete the user record from the users table
    // This should be one of the last steps
    await query('DELETE FROM users WHERE id = $1', [userId]);

    await query('COMMIT', []);

    // It's good practice to clear the cookie or session on the client-side after successful deletion.
    // For stateless (JWT) auth, the token becomes invalid once the user is deleted.
    // For session-based, you might call req.logout() or req.session.destroy().
    // Since passport.deserializeUser will fail for subsequent requests with this user's ID,
    // this server-side deletion is generally sufficient.

    res.status(200).json({ message: 'Account deleted successfully. All associated data has been removed.' });
    return;
  } catch (error) {
    await query('ROLLBACK', []);
    console.error('Error deleting account:', error);
    // It's good to log the specific userId for which deletion failed, if possible and safe (no PII in logs).
    res.status(500).json({ error: 'Failed to delete account. An internal error occurred.' });
    return;
  }
};

// Helper function (conceptual) to extract public_id from Cloudinary URL
// This is a simplified example. Real implementation might be more robust.
// const extractPublicIdFromUrl = (url: string): string | null => {
//   try {
//     const parts = url.split('/');
//     const publicIdWithExtension = parts.pop();
//     if (publicIdWithExtension) {
//       return publicIdWithExtension.split('.')[0];
//     }
//     return null;
//   } catch (e) {
//     console.error('Error extracting public_id:', e);
//     return null;
//   }
// };
