import { Request, Response } from 'express';
import { query } from '../config/database.config';
import { AppUser } from '../entity/User'; // Changed User to AppUser
import { deleteFromCloudinary, extractPublicIdAndResourceType } from '../utils/cloudinaryUtils';

import { log } from "../utils/logger";
// AuthenticatedRequest interface removed, relying on global Express.Request augmentation

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rows: users } = await query(
      'SELECT id, google_id, microsoft_id, facebook_id, twitter_id, email, name, picture, role, blocked, created_at, updated_at, last_login, moderate_images, moderate_videos FROM users ORDER BY created_at DESC',
      []
    );
    const formattedUsers = users.map(user => ({
      id: user.id,
      googleId: user.google_id,
      microsoftId: user.microsoft_id,
      facebookId: user.facebook_id,
      twitterId: user.twitter_id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      blocked: user.blocked,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastLogin: user.last_login,
      moderateImages: user.moderate_images ?? false,
      moderateVideos: user.moderate_videos ?? false,
    }));
    res.json(formattedUsers);
    return;
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: 'Failed to fetch users.' });
    return;
  }
};

export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const { role: newRole } = req.body;

  if (!['guest', 'user', 'admin'].includes(newRole)) {
    res.status(400).json({ error: 'Invalid role specified. Must be one of: guest, user, admin.' });
    return;
  }

  // Prevent admin from changing their own role if they are the one making the request
  // This is a safety measure. Admins should not accidentally demote themselves.
  // Another admin would be needed to change their role.
  if (req.user) {
    const adminPerformingAction = req.user as AppUser; // Changed User to AppUser
    if (adminPerformingAction.id === userId && adminPerformingAction.role === 'admin' && newRole !== 'admin') {
      res.status(403).json({ error: 'Admins cannot change their own role to a non-admin role via this endpoint.' });
      return;
    }
  }


  try {
    const { rows: updatedUsers, rowCount } = await query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role, last_login, blocked, created_at, updated_at',
      [newRole, userId]
    );

    if (rowCount === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const updatedUser = updatedUsers[0];
    const formattedUser = {
      id: updatedUser.id,
      googleId: updatedUser.google_id, // Assuming google_id might be returned, though not in SELECT
      microsoftId: updatedUser.microsoft_id,
      facebookId: updatedUser.facebook_id,
      twitterId: updatedUser.twitter_id,
      email: updatedUser.email,
      name: updatedUser.name,
      picture: updatedUser.picture, // Assuming picture might be returned
      role: updatedUser.role,
      blocked: updatedUser.blocked,
      createdAt: updatedUser.created_at,
      updatedAt: updatedUser.updated_at,
      lastLogin: updatedUser.last_login,
    };
    res.json(formattedUser);
    return;
  } catch (error) {
    console.error('Error updating role for user %s:', userId, error);
    res.status(500).json({ error: 'Failed to update user role.' });
    return;
  }
};

export const removeUser = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params; // User ID to delete

  if (!userId) {
    res.status(400).json({ error: 'User ID parameter is missing.' });
    return;
  }

  // Prevent admin from removing themselves using this endpoint
  if (req.user) {
    const adminPerformingAction = req.user as AppUser; // Changed User to AppUser
    if (adminPerformingAction.id === userId) {
      res.status(400).json({ error: 'Admin cannot remove themselves using this endpoint. Use profile deletion for your own account.' });
      return;
    }
  }

  try {
    await query('BEGIN', []);

    // 1. Fetch all messages by the target user to get their IDs and imageURLs for Cloudinary deletion
    const { rows: messages } = await query('SELECT id, imageurl FROM messages WHERE senderid = $1', [userId]);

    for (const message of messages) {
      const messageId = message.id;
      const messageImageUrl = message.imageurl; // Assuming 'imageUrl' is the correct casing from DB

      // 2. Fetch reactions for each message to get their IDs and videoURLs for Cloudinary deletion
      const { rows: reactions } = await query('SELECT id, videourl FROM reactions WHERE messageid = $1', [messageId]);
      const reactionIds = reactions.map(r => r.id);
      const reactionVideoUrls = reactions.map(r => r.videourl).filter(url => url); // Assuming 'videoUrl' and filter nulls

      let replyMedia: { mediaurl: string }[] = [];
      if (reactionIds.length) {
        const replyRes = await query(
          'SELECT mediaurl FROM replies WHERE reactionid = ANY($1::uuid[]) AND mediaurl IS NOT NULL',
          [reactionIds]
        );
        replyMedia = replyRes.rows;
      }

      // 3. Delete replies associated with these reactions (if any reactionIds)
      if (reactionIds.length > 0) {
        await query('DELETE FROM replies WHERE reactionid = ANY($1::uuid[])', [reactionIds]);
      }

      // 4. Delete reactions associated with the message
      await query('DELETE FROM reactions WHERE messageid = $1', [messageId]);
      
      // 5. Delete the message itself
      await query('DELETE FROM messages WHERE id = $1', [messageId]);

      // 6. Cloudinary Deletion
      if (messageImageUrl) {
        try {
          await deleteFromCloudinary(messageImageUrl);
        } catch (cloudinaryError) {
          console.error(`Admin: Failed to delete message image ${messageImageUrl} from Cloudinary:`, cloudinaryError);
          // Do not re-throw, allow the process to continue
        }
      }

      for (const videoUrl of reactionVideoUrls) {
        if (videoUrl) {
          try {
            await deleteFromCloudinary(videoUrl);
          } catch (cloudinaryError) {
            console.error(`Admin: Failed to delete reaction video ${videoUrl} from Cloudinary:`, cloudinaryError);
            // Do not re-throw, allow the process to continue
          }
        }
      }

      for (const rm of replyMedia) {
        if (rm.mediaurl) {
          try {
            await deleteFromCloudinary(rm.mediaurl);
          } catch (cloudinaryError) {
            console.error(`Admin: Failed to delete reply media ${rm.mediaurl} from Cloudinary:`, cloudinaryError);
          }
        }
      }
    }

    // 7. Delete the user record from the users table
    const deleteUserResult = await query('DELETE FROM users WHERE id = $1', [userId]);
    if (deleteUserResult.rowCount === 0) {
      // It's possible the user had no messages/reactions but still exists
      // Or the user was already deleted in a concurrent request.
      // If rowCount is 0 here, it means the user ID was not found.
      await query('ROLLBACK', []);
      res.status(404).json({ error: 'User not found, or already deleted.' });
      return;
    }
    
    await query('COMMIT', []);
    res.status(200).json({ message: `User ${userId} and all their associated data have been deleted successfully.` });
    return;
  } catch (error) {
    await query('ROLLBACK', []);
    console.error('Error deleting user %s:', userId, error);
    // Check for specific error types if needed, e.g., foreign key violation if something was missed
    res.status(500).json({ error: 'Failed to delete user and their associated data due to an internal error.' });
    return;
  }
};

// Conceptual helper function (not used directly as Cloudinary SDK is not integrated here)
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

export const setUserLimits = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const {
    max_messages_per_month,
    max_reactions_per_month,
    max_reactions_per_message,
    last_usage_reset_date,
    moderate_images,
    moderate_videos
  } = req.body;

  if (process.env.NODE_ENV === 'development') {
    log('[setUserLimits] incoming body for user %s:', userId, req.body);
  } else {
    log('[setUserLimits] request for user %s', userId);
  }

  // Basic validation
  if (max_messages_per_month !== undefined && max_messages_per_month !== null && typeof max_messages_per_month !== 'number') {
    res.status(400).json({ error: 'Invalid max_messages_per_month, must be a number or null.' });
    return;
  }
  if (max_reactions_per_month !== undefined && max_reactions_per_month !== null && typeof max_reactions_per_month !== 'number') {
    res.status(400).json({ error: 'Invalid max_reactions_per_month, must be a number or null.' });
    return;
  }
  if (max_reactions_per_message !== undefined && max_reactions_per_message !== null && typeof max_reactions_per_message !== 'number') {
    res.status(400).json({ error: 'Invalid max_reactions_per_message, must be a number or null.' });
    return;
  }
  if (moderate_images !== undefined && typeof moderate_images !== 'boolean') {
    res.status(400).json({ error: 'Invalid moderate_images value, must be boolean.' });
    return;
  }
  if (moderate_videos !== undefined && typeof moderate_videos !== 'boolean') {
    res.status(400).json({ error: 'Invalid moderate_videos value, must be boolean.' });
    return;
  }

  // Validate last_usage_reset_date (if provided and not null)
  if (last_usage_reset_date !== undefined && last_usage_reset_date !== null) {
    if (typeof last_usage_reset_date !== 'string' || isNaN(new Date(last_usage_reset_date).getTime())) {
      res.status(400).json({ error: 'Invalid last_usage_reset_date format. Please use a valid ISO date string or null.' });
      return;
    }
  }

  try {
    const fieldsToUpdate: string[] = [];
    const values: any[] = [];
    let queryParamIndex = 1;

    // For nullable fields, explicitly allow null to unset the limit
    if (Object.prototype.hasOwnProperty.call(req.body, 'max_messages_per_month')) {
      fieldsToUpdate.push(`max_messages_per_month = $${queryParamIndex++}`);
      values.push(max_messages_per_month);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'max_reactions_per_month')) {
      fieldsToUpdate.push(`max_reactions_per_month = $${queryParamIndex++}`);
      values.push(max_reactions_per_month);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'max_reactions_per_message')) {
      fieldsToUpdate.push(`max_reactions_per_message = $${queryParamIndex++}`);
      values.push(max_reactions_per_message);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'moderate_images')) {
      fieldsToUpdate.push(`moderate_images = $${queryParamIndex++}`);
      values.push(moderate_images);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'moderate_videos')) {
      fieldsToUpdate.push(`moderate_videos = $${queryParamIndex++}`);
      values.push(moderate_videos);
    }

    // Add last_usage_reset_date to update if provided
    if (Object.prototype.hasOwnProperty.call(req.body, 'last_usage_reset_date')) {
      if (last_usage_reset_date === null) {
        fieldsToUpdate.push(`last_usage_reset_date = $${queryParamIndex++}`);
        values.push(null);
      } else if (typeof last_usage_reset_date === 'string') { // Validation ensures it's a valid date string here
        fieldsToUpdate.push(`last_usage_reset_date = $${queryParamIndex++}`);
        values.push(last_usage_reset_date);
      }
      // No need for an else here as validation should have caught invalid non-null strings
    }

    // Check if any fields are being updated AFTER potentially adding last_usage_reset_date
    if (fieldsToUpdate.length === 0) {
      res.status(400).json({ error: 'No limit fields provided for update. To unset a limit, pass null.' });
      return;
    }

    fieldsToUpdate.push(`updated_at = NOW()`); // Also update the updated_at timestamp

    values.push(userId);
    const updateUserQuery = `UPDATE users SET ${fieldsToUpdate.join(', ')} WHERE id = $${queryParamIndex} RETURNING *;`;

    if (process.env.NODE_ENV === 'development') {
      log('[setUserLimits] query:', updateUserQuery, 'params:', values);
    }

    const { rows, rowCount } = await query(updateUserQuery, values);
    if (process.env.NODE_ENV === 'development') {
      log('[setUserLimits] affected rows:', rowCount);
    }
    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found or update failed.' });
      return;
    }
    // Return all fields of the updated user, as fetched by RETURNING *
    const updatedUser = rows[0] as AppUser;
    if (process.env.NODE_ENV === 'development') {
      log('[setUserLimits] updated user:', updatedUser);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'max_reactions_per_message')) {
      await query('UPDATE messages SET max_reactions_allowed = $1 WHERE senderid = $2', [req.body.max_reactions_per_message, userId]);
    }

    res.status(200).json({ message: 'User limits updated successfully.', user: updatedUser });
    // No explicit return needed here as it's the end of the try block and function.
  } catch (error) {
    console.error('Error setting user limits:', error);
    res.status(500).json({ error: 'Failed to set user limits.' });
    return;
  }
};

export const getUserDetails = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  try {
    // Fetch all relevant fields, including the new and modified ones
    const selectQuery = `
      SELECT
        id, google_id, microsoft_id, facebook_id, twitter_id, email, name, picture, role, blocked, created_at, updated_at, last_login,
        max_messages_per_month, current_messages_this_month,
        max_reactions_per_month, reactions_received_this_month,
        last_usage_reset_date, max_reactions_per_message,
        moderate_images, moderate_videos
      FROM users
      WHERE id = $1`;
    const { rows } = await query(selectQuery, [userId]);

    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const user = rows[0] as AppUser; // Still cast, but now we are more explicit about selection

    // Construct the response object explicitly
    res.status(200).json({
      id: user.id,
      googleId: user.google_id,
      microsoftId: user.microsoft_id,
      facebookId: user.facebook_id,
      twitterId: user.twitter_id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      blocked: user.blocked,
      createdAt: user.created_at ? new Date(user.created_at).toISOString() : null,
      updatedAt: user.updated_at ? new Date(user.updated_at).toISOString() : null,
      lastLogin: user.last_login ? new Date(user.last_login).toISOString() : null,

      maxMessagesPerMonth: user.max_messages_per_month ?? null,
      currentMessagesThisMonth: user.current_messages_this_month ?? 0,

      // max_reactions_per_month now refers to the limit on reactions a user's messages can receive
      maxReactionsPerMonth: user.max_reactions_per_month ?? null,
      // reactions_received_this_month is the new counter for reactions received by user's messages
      reactionsReceivedThisMonth: user.reactions_received_this_month ?? 0,

      // max_reactions_per_message is the limit on reactions per message for messages created by this user
      maxReactionsPerMessage: user.max_reactions_per_message ?? null,

      lastUsageResetDate: user.last_usage_reset_date ? new Date(user.last_usage_reset_date).toISOString() : null,
      moderateImages: user.moderate_images ?? false,
      moderateVideos: user.moderate_videos ?? false
    });
    return;
  } catch (error) {
    console.error('Error getting user details:', error);
    res.status(500).json({ error: 'Failed to get user details.' });
    return;
  }
};

export const getModerationSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await query(
      `SELECT u.id,
              u.email,
              u.name,
              COALESCE(m.msg_count, 0) AS messages_pending,
              COALESCE(r.react_count, 0) AS reactions_pending,
              COALESCE(m.msg_count, 0) + COALESCE(r.react_count, 0) AS pending_manual_reviews
       FROM users u
       LEFT JOIN (
         SELECT senderid AS user_id, COUNT(*) AS msg_count
         FROM messages
         WHERE moderation_status = 'manual_review'
         GROUP BY senderid
       ) m ON m.user_id = u.id
       LEFT JOIN (
         SELECT m.senderid AS user_id, COUNT(*) AS react_count
         FROM reactions r
         JOIN messages m ON r.messageid = m.id
         WHERE r.moderation_status = 'manual_review'
         GROUP BY m.senderid
       ) r ON r.user_id = u.id
       ORDER BY u.created_at DESC`
    );
    res.json(rows);
    return;
  } catch (error) {
    console.error('Error fetching moderation summary:', error);
    res.status(500).json({ error: 'Failed to fetch moderation summary.' });
    return;
  }
};

export const getUserPendingModeration = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  try {
    const { rows: msgRows } = await query(
      `SELECT id, COALESCE(original_imageurl, imageurl) AS url
       FROM messages
       WHERE senderid = $1 AND moderation_status = 'manual_review'`,
      [userId]
    );

    const { rows: reactionRows } = await query(
      `SELECT r.id, COALESCE(r.original_videourl, r.videourl) AS url
       FROM reactions r
       JOIN messages m ON r.messageid = m.id
       WHERE m.senderid = $1 AND r.moderation_status = 'manual_review'`,
      [userId]
    );

    const toPublicId = (url: string | null) => {
      if (!url) return null;
      const extracted = extractPublicIdAndResourceType(url);
      return extracted ? extracted.public_id : null;
    };

    const messages = msgRows.map(row => ({ id: row.id, publicId: toPublicId(row.url) }));
    const reactions = reactionRows.map(row => ({ id: row.id, publicId: toPublicId(row.url) }));

    res.json({ messages, reactions });
    return;
  } catch (error) {
    console.error('Error fetching pending moderation for user %s:', userId, error);
    res.status(500).json({ error: 'Failed to fetch pending moderation items.' });
    return;
  }
};
