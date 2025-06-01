import { Request, Response } from 'express';
import { query } from '../config/database.config';
import { AppUser } from '../entity/User'; // Changed User to AppUser
import { 
  extractKeyFromS3Url,
  deleteMultipleFromS3
} from '../utils/s3Utils';
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

    // 1. Fetch all message IDs and imageURLs by the user
    const { rows: messages } = await query(
      'SELECT id, imageurl FROM messages WHERE senderid = $1',
      [userId]
    );

    let allMessageIds: string[] = [];
    let allMessageImageUrls: string[] = [];

    if (messages.length > 0) {
      allMessageIds = messages.map(m => m.id);
      allMessageImageUrls = messages.map(m => m.imageurl).filter(url => url);

      // 2. Fetch all reaction IDs and videoURLs associated with the user's messages
      const { rows: reactions } = await query(
        'SELECT id, videourl FROM reactions WHERE messageid = ANY($1::uuid[])',
        [allMessageIds]
      );

      let allReactionIds: string[] = [];
      let allReactionVideoUrls: string[] = [];

      if (reactions.length > 0) {
        allReactionIds = reactions.map(r => r.id);
        allReactionVideoUrls = reactions.map(r => r.videourl).filter(url => url);

        // 3. Delete replies associated with these reactions
        if (allReactionIds.length > 0) {
          await query('DELETE FROM replies WHERE reactionid = ANY($1::uuid[])', [allReactionIds]);
        }

        // 4. Delete reactions associated with the messages
        // This must happen AFTER deleting replies due to foreign key constraints
        await query('DELETE FROM reactions WHERE id = ANY($1::uuid[])', [allReactionIds]);
      }
      
      // 5. Delete the messages themselves
      // This must happen AFTER deleting reactions
      await query('DELETE FROM messages WHERE id = ANY($1::uuid[])', [allMessageIds]);

      // 6. S3 Deletion
      const allObjectKeysToDelete: string[] = [];
      allMessageImageUrls.forEach(url => {
        const key = extractKeyFromS3Url(url);
        if (key) {
          allObjectKeysToDelete.push(key);
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`Could not extract S3 key from message image URL: ${url}`);
          }
        }
      });

      allReactionVideoUrls.forEach(url => {
        const key = extractKeyFromS3Url(url);
        if (key) {
          allObjectKeysToDelete.push(key);
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`Could not extract S3 key from reaction video URL: ${url}`);
          }
        }
      });

      if (allObjectKeysToDelete.length > 0) {
        try {
          if (process.env.NODE_ENV === 'development') {
            console.log(`Attempting to bulk delete ${allObjectKeysToDelete.length} objects from S3.`);
          }
          // The deleteMultipleFromS3 function internally handles logging of partial failures.
          await deleteMultipleFromS3(allObjectKeysToDelete);
          if (process.env.NODE_ENV === 'development') {
            console.log(`Successfully initiated bulk deletion for ${allObjectKeysToDelete.length} objects from S3.`);
          }
        } catch (s3Error) {
          // This catch block might be for errors in the deleteMultipleFromS3 call itself,
          // not for individual object deletion failures, which are logged by the utility.
          console.error(`Failed to initiate bulk delete from S3:`, s3Error);
        }
      }
    }

    // 7. Delete the user record from the users table
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
