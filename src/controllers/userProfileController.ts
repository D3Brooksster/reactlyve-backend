import { Request, Response } from 'express';
import { query } from '../config/database.config';
import { AppUser } from '../entity/User'; // Changed User to AppUser
import { 
  // deleteFromCloudinary, // Keep if needed elsewhere, or remove if fully replaced
  extractPublicIdAndResourceType, 
  deleteMultipleFromCloudinary 
} from '../utils/cloudinaryUtils';
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

      // 6. Cloudinary Deletion
      const imagePublicIds: string[] = [];
      allMessageImageUrls.forEach(url => {
        const extracted = extractPublicIdAndResourceType(url);
        // Ensure resource_type is 'image' if that's a strict requirement for this array
        if (extracted && extracted.resource_type === 'image') { 
          imagePublicIds.push(extracted.public_id);
        } else if (extracted) {
          // Log if a messageImageUrl doesn't yield an image resource_type
          if (process.env.NODE_ENV === 'development') {
            console.warn(`Expected image resource type but got ${extracted.resource_type} for URL: ${url}`);
          }
        }
      });

      const videoPublicIds: string[] = [];
      allReactionVideoUrls.forEach(url => {
        const extracted = extractPublicIdAndResourceType(url);
        // Ensure resource_type is 'video'
        if (extracted && extracted.resource_type === 'video') {
          videoPublicIds.push(extracted.public_id);
        } else if (extracted) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`Expected video resource type but got ${extracted.resource_type} for URL: ${url}`);
          }
        }
      });

      if (imagePublicIds.length > 0) {
        try {
          if (process.env.NODE_ENV === 'development') {
            console.log(`Attempting to bulk delete ${imagePublicIds.length} images from Cloudinary.`);
          }
          await deleteMultipleFromCloudinary(imagePublicIds, 'image');
          if (process.env.NODE_ENV === 'development') {
            console.log(`Successfully initiated bulk deletion for ${imagePublicIds.length} images.`);
          }
        } catch (cloudinaryError) {
          console.error(`Failed to bulk delete images from Cloudinary:`, cloudinaryError);
        }
      }

      if (videoPublicIds.length > 0) {
        try {
          if (process.env.NODE_ENV === 'development') {
            console.log(`Attempting to bulk delete ${videoPublicIds.length} videos from Cloudinary.`);
          }
          await deleteMultipleFromCloudinary(videoPublicIds, 'video');
          if (process.env.NODE_ENV === 'development') {
            console.log(`Successfully initiated bulk deletion for ${videoPublicIds.length} videos.`);
          }
        } catch (cloudinaryError) {
          console.error(`Failed to bulk delete videos from Cloudinary:`, cloudinaryError);
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
