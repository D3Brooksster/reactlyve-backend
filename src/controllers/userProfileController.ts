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
    blocked: user.blocked,
    // New limit and usage fields
    maxMessagesPerMonth: user.max_messages_per_month ?? null,
    currentMessagesThisMonth: user.current_messages_this_month ?? null, // For messages sent by user
    maxReactionsPerMonth: user.max_reactions_per_month ?? null, // Max reactions user's messages can receive
    reactionsReceivedThisMonth: user.reactions_received_this_month ?? 0, // Reactions received by user's messages
    lastUsageResetDate: user.last_usage_reset_date ? new Date(user.last_usage_reset_date).toISOString() : null,
    maxReactionsPerMessage: user.max_reactions_per_message ?? null, // Max reactions per message for messages sent by user
    moderateImages: user.moderate_images ?? false,
    moderateVideos: user.moderate_videos ?? false
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

export const updateMyProfile = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const userId = (req.user as AppUser).id;
  const { lastUsageResetDate, moderateImages, moderateVideos } = req.body;

  if (process.env.NODE_ENV === 'development') {
    console.log('[updateMyProfile] incoming body for user %s:', userId, req.body);
  }

  try {
    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (lastUsageResetDate) {
      fields.push(`last_usage_reset_date = $${idx++}`);
      params.push(lastUsageResetDate);
    }
    if (typeof moderateImages === 'boolean') {
      fields.push(`moderate_images = $${idx++}`);
      params.push(moderateImages);
    }
    if (typeof moderateVideos === 'boolean') {
      fields.push(`moderate_videos = $${idx++}`);
      params.push(moderateVideos);
    }
    if (fields.length === 0) {
      res.status(400).json({ error: 'No valid fields provided' });
      return;
    }
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(userId);

    const updateQuery = `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *;`;

    if (process.env.NODE_ENV === 'development') {
      console.log('[updateMyProfile] query:', updateQuery, 'params:', params);
    }

    const { rows: updatedUsers, rowCount } = await query(updateQuery, params);
    if (process.env.NODE_ENV === 'development') {
      console.log('[updateMyProfile] affected rows:', rowCount);
    }

    if (updatedUsers.length === 0) {
      // This case should ideally not happen if req.user.id is valid and comes from an authenticated session
      res.status(404).json({ error: 'User not found or no update was performed.' });
      return;
    }

    const updatedUser = updatedUsers[0] as AppUser;

    if (process.env.NODE_ENV === 'development') {
      console.log('[updateMyProfile] updated user:', updatedUser);
    }

    // Respond with the updated user profile, similar to getMyProfile
    res.json({
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      picture: updatedUser.picture,
      googleId: updatedUser.google_id,
      lastLogin: updatedUser.last_login ? new Date(updatedUser.last_login).toISOString() : null,
      role: updatedUser.role,
      createdAt: updatedUser.created_at ? new Date(updatedUser.created_at).toISOString() : null,
      updatedAt: updatedUser.updated_at ? new Date(updatedUser.updated_at).toISOString() : null,
      blocked: updatedUser.blocked,
      maxMessagesPerMonth: updatedUser.max_messages_per_month ?? null,
      currentMessagesThisMonth: updatedUser.current_messages_this_month ?? null,
      maxReactionsPerMonth: updatedUser.max_reactions_per_month ?? null,
      reactionsReceivedThisMonth: updatedUser.reactions_received_this_month ?? 0,
      lastUsageResetDate: updatedUser.last_usage_reset_date ? new Date(updatedUser.last_usage_reset_date).toISOString() : null,
      maxReactionsPerMessage: updatedUser.max_reactions_per_message ?? null,
      moderateImages: updatedUser.moderate_images ?? false,
      moderateVideos: updatedUser.moderate_videos ?? false
    });

  } catch (error) {
    console.error('Error updating user profile:', error);
    // Check for specific database errors if needed, e.g., invalid date format
    if (error instanceof Error && error.message.includes("invalid input syntax for type timestamp")) {
        res.status(400).json({ error: 'Invalid date format for lastUsageResetDate. Please use a valid ISO 8601 date format.' });
    } else {
        res.status(500).json({ error: 'Failed to update user profile' });
    }
  }
};