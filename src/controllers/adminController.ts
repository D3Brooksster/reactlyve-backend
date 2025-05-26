import { Request, Response } from 'express';
import { query } from '../config/database.config';
import { User } from '../entity/User';

// AuthenticatedRequest interface removed, relying on global Express.Request augmentation

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rows: users } = await query(
      'SELECT id, google_id, email, name, picture, role, blocked, created_at, updated_at, last_login FROM users ORDER BY created_at DESC',
      []
    );
    return res.json(users);
  } catch (error) {
    console.error('Error fetching all users:', error);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const { role: newRole } = req.body;

  if (!['guest', 'user', 'admin'].includes(newRole)) {
    return res.status(400).json({ error: 'Invalid role specified. Must be one of: guest, user, admin.' });
  }

  // Prevent admin from changing their own role if they are the one making the request
  // This is a safety measure. Admins should not accidentally demote themselves.
  // Another admin would be needed to change their role.
  if (req.user) {
    const adminPerformingAction = req.user as User;
    if (adminPerformingAction.id === userId && adminPerformingAction.role === 'admin' && newRole !== 'admin') {
      return res.status(403).json({ error: 'Admins cannot change their own role to a non-admin role via this endpoint.' });
    }
  }


  try {
    const { rows: updatedUsers, rowCount } = await query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role, last_login, blocked, created_at, updated_at',
      [newRole, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json(updatedUsers[0]);
  } catch (error) {
    console.error(`Error updating role for user ${userId}:`, error);
    return res.status(500).json({ error: 'Failed to update user role.' });
  }
};

export const removeUser = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params; // User ID to delete

  if (!userId) {
    return res.status(400).json({ error: 'User ID parameter is missing.' });
  }

  // Prevent admin from removing themselves using this endpoint
  if (req.user) {
    const adminPerformingAction = req.user as User;
    if (adminPerformingAction.id === userId) {
      return res.status(400).json({ error: 'Admin cannot remove themselves using this endpoint. Use profile deletion for your own account.' });
    }
  }

  try {
    await query('BEGIN', []);

    // 1. Fetch all messages by the target user to get their IDs and imageURLs for Cloudinary deletion
    const { rows: messages } = await query('SELECT id, "imageUrl" FROM messages WHERE "senderId" = $1', [userId]);

    for (const message of messages) {
      const messageId = message.id;
      const messageImageUrl = message.imageUrl; // Assuming 'imageUrl' is the correct casing from DB

      // 2. Fetch reactions for each message to get their IDs and videoURLs for Cloudinary deletion
      const { rows: reactions } = await query('SELECT id, "videoUrl" FROM reactions WHERE "messageId" = $1', [messageId]);
      const reactionIds = reactions.map(r => r.id);
      const reactionVideoUrls = reactions.map(r => r.videoUrl).filter(url => url); // Assuming 'videoUrl' and filter nulls

      // 3. Delete replies associated with these reactions (if any reactionIds)
      if (reactionIds.length > 0) {
        await query('DELETE FROM replies WHERE "reactionId" = ANY($1::uuid[])', [reactionIds]);
      }

      // 4. Delete reactions associated with the message
      await query('DELETE FROM reactions WHERE "messageId" = $1', [messageId]);
      
      // 5. Delete the message itself
      await query('DELETE FROM messages WHERE id = $1', [messageId]);

      // 6. Cloudinary Deletion (STUBBED)
      // console.log(`TODO: Delete message image from Cloudinary: ${messageImageUrl}`);
      // if (messageImageUrl) { 
      //   // const publicId = extractPublicIdFromUrl(messageImageUrl); // Conceptual
      //   // if (publicId) await cloudinary.uploader.destroy(publicId); // Conceptual
      // }
      // for (const videoUrl of reactionVideoUrls) {
      //   console.log(`TODO: Delete reaction video from Cloudinary: ${videoUrl}`);
      //   if (videoUrl) {
      //     // const publicId = extractPublicIdFromUrl(videoUrl); // Conceptual
      //     // if (publicId) await cloudinary.uploader.destroy(publicId); // Conceptual
      //   }
      // }
    }

    // 7. Delete the user record from the users table
    const deleteUserResult = await query('DELETE FROM users WHERE id = $1', [userId]);
    if (deleteUserResult.rowCount === 0) {
      // It's possible the user had no messages/reactions but still exists
      // Or the user was already deleted in a concurrent request.
      // If rowCount is 0 here, it means the user ID was not found.
      await query('ROLLBACK', []);
      return res.status(404).json({ error: 'User not found, or already deleted.' });
    }
    
    await query('COMMIT', []);
    return res.status(200).json({ message: `User ${userId} and all their associated data have been deleted successfully.` });
  } catch (error) {
    await query('ROLLBACK', []);
    console.error(`Error deleting user ${userId}:`, error);
    // Check for specific error types if needed, e.g., foreign key violation if something was missed
    return res.status(500).json({ error: 'Failed to delete user and their associated data due to an internal error.' });
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
