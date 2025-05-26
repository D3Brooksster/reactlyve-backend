import { Request, Response } from 'express';
import { query } from '../config/database.config';
import { AppUser } from '../entity/User'; // Changed User to AppUser

// AuthenticatedRequest interface removed, relying on global Express.Request augmentation

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rows: users } = await query(
      'SELECT id, google_id, email, name, picture, role, blocked, created_at, updated_at, last_login FROM users ORDER BY created_at DESC',
      []
    );
    res.json(users);
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
    res.json(updatedUsers[0]);
    return;
  } catch (error) {
    console.error(`Error updating role for user ${userId}:`, error);
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
      res.status(404).json({ error: 'User not found, or already deleted.' });
      return;
    }
    
    await query('COMMIT', []);
    res.status(200).json({ message: `User ${userId} and all their associated data have been deleted successfully.` });
    return;
  } catch (error) {
    await query('ROLLBACK', []);
    console.error(`Error deleting user ${userId}:`, error);
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
