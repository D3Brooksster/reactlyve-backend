import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { query } from '../config/database.config';
import crypto from 'crypto';
import "dotenv/config";
import { AppUser } from '../entity/User'; // Changed User to AppUser
import { deleteFromCloudinary, uploadToCloudinarymedia, uploadVideoToCloudinary, extractPublicIdAndResourceType } from '../utils/cloudinaryUtils';
// Import path changed for uploadToCloudinarymedia and uploadVideoToCloudinary

// AuthenticatedRequest interface removed, relying on global Express.Request augmentation

// Cloudinary setup - Kept for other functions that might directly use 'cloudinary' object
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  }
}).single('media');

// === Helpers ===
const uploadToCloudinary = (buffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'message_images' }, (err, result) => {
      return err ? reject(err) : resolve(result?.secure_url || '');
    });
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });
};

const generateShareableLink = (): string => {
  const baseUrl = process.env.FRONTEND_URL || '';
  const uniqueId = crypto.randomBytes(8).toString('hex');
  return `${baseUrl}/m/${uniqueId}`;
};

const uploadVideoToCloudinaryWithRetry = async (
  buffer: Buffer,
  size: number,
  folder: string,
  options: Record<string, any>,
  retries = 1
) => {
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[uploadVideoToCloudinaryWithRetry] Attempting upload');
    }
    return await uploadVideoToCloudinary(buffer, size, folder, options);
  } catch (err: any) {
    if (retries > 0 && err && err.http_code === 499) {
      console.warn('[uploadVideoToCloudinaryWithRetry] Timeout, retrying upload');
      return await uploadVideoToCloudinary(buffer, size, folder, options);
    }
    console.error('[uploadVideoToCloudinaryWithRetry] Upload failed:', err);
    throw err;
  }
};

// === Controllers ===
export const sendMessage = (req: Request, res: Response) => {
  upload(req, res, async (err) => {
    if (err) {
      res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: err.message });
      return;
    }

    // New Role-Based Authorization Check
    if (!req.user) { 
      // Should be caught by requireAuth, but as a safeguard or if requireAuth is somehow bypassed.
      res.status(401).json({ error: 'Authentication required to send messages.' });
      return;
    }

    const user = req.user as AppUser; // Assert type to access role

    try {
      // ---- START REFINED MONTHLY RESET LOGIC ----
      const now = new Date();
      let needsReset = false;

      if (user.last_usage_reset_date === null || user.last_usage_reset_date === undefined) {
        needsReset = true;
      } else {
        const resetDate = new Date(user.last_usage_reset_date);
        if (!isNaN(resetDate.getTime())) {
          const resetYear = resetDate.getFullYear();
          const resetMonth = resetDate.getMonth();
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth();

          if (resetYear < currentYear || (resetYear === currentYear && resetMonth < currentMonth)) {
            needsReset = true;
          }
        } else {
          console.error(`User ${user.id} has an invalid last_usage_reset_date in sendMessage: ${user.last_usage_reset_date}`);
          needsReset = true;
        }
      }

      if (needsReset) {
        console.log(`Performing monthly usage reset for user ${user.id} in sendMessage. Last reset: ${user.last_usage_reset_date}`);
        try {
          await query(
            'UPDATE users SET current_messages_this_month = 0, reactions_received_this_month = 0, last_usage_reset_date = NOW() WHERE id = $1',
            [user.id]
          );
          user.current_messages_this_month = 0;
          user.reactions_received_this_month = 0; // Corrected property name
          user.last_usage_reset_date = now; // Update in-memory user object
          console.log(`Successfully reset usage in DB for user ${user.id} (sendMessage)`);
        } catch (resetError) {
          console.error('Error resetting user usage data in database (sendMessage):', resetError);
          // Log and continue, but counts might be off. Consider if this should be fatal.
        }
      }
      // ---- END REFINED MONTHLY RESET LOGIC ----

      // Check message limit
      // If max_messages_per_month is undefined, null, or negative, it means no limit.
      // Only check if max_messages_per_month is a non-negative number.
      const currentMessages = user.current_messages_this_month ?? 0;
      if (typeof user.max_messages_per_month === 'number' &&
          user.max_messages_per_month >= 0 &&
          currentMessages >= user.max_messages_per_month) {
        res.status(403).json({ error: 'Message limit reached for this month.' });
        return;
      }
      // ---- END MESSAGE LIMIT LOGIC ----

      const { content, passcode, reaction_length } = req.body; // Extract reaction_length
      const senderId = user.id; // Use user.id from the asserted user
      const maxReactionsAllowedForMessage = user.max_reactions_per_message; // Get from user settings

      // Validate reaction_length
      let validatedReactionLength = 15; // Default value
      if (reaction_length !== undefined) {
        const parsedReactionLength = parseInt(reaction_length as string, 10);
        if (!isNaN(parsedReactionLength) && parsedReactionLength >= 10 && parsedReactionLength <= 30) {
          validatedReactionLength = parsedReactionLength;
        }
        // Optional: else if (sendErrorOnInvalid) res.status(400).json({ error: 'Invalid reaction_length' }); return;
      }

      if (!content) {
        res.status(400).json({ error: 'Message content is required' });
        return;
      }

      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let moderationStatus = 'approved';
      let moderationDetails: string | null = null;
      let originalUrl: string | null = null;

      if (req.file) {
        mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Moderation] Uploading ${mediaType} with moderation:`, mediaType === 'video' ? user.moderate_videos : user.moderate_images);
        }

        if (mediaType === 'video') {
          const uploadResult = await uploadVideoToCloudinaryWithRetry(
            req.file.buffer,
            req.file.size,
            'messages',
            user.moderate_videos ? { moderation: 'aws_rek' } : {}
          );
          mediaUrl = uploadResult.secure_url;
          originalUrl = mediaUrl;
          if (user.moderate_videos && uploadResult.moderation && Array.isArray(uploadResult.moderation)) {
            const mod = uploadResult.moderation[0];
            moderationStatus = mod.status || 'pending';
            moderationDetails = JSON.stringify(mod);
            if (process.env.NODE_ENV === 'development') {
              console.log(`[Moderation] Video moderation result:`, mod);
            }
          } else if (user.moderate_videos) {
            moderationStatus = 'pending';
            if (process.env.NODE_ENV === 'development') {
              console.log('[Moderation] Video moderation pending');
            }
          }
        } else {
          const imgResult = await uploadToCloudinarymedia(
            req.file.buffer,
            'image',
            user.moderate_images ? { moderation: 'aws_rek' } : {}
          );
          mediaUrl = imgResult.secure_url;
          originalUrl = mediaUrl;
          if (user.moderate_images && imgResult.moderation && Array.isArray(imgResult.moderation)) {
            const mod = imgResult.moderation[0];
            moderationStatus = mod.status || 'pending';
            moderationDetails = JSON.stringify(mod);
            if (process.env.NODE_ENV === 'development') {
              console.log(`[Moderation] Image moderation result:`, mod);
            }
          } else if (user.moderate_images) {
            moderationStatus = 'pending';
            if (process.env.NODE_ENV === 'development') {
              console.log('[Moderation] Image moderation pending');
            }
          }
        }
      }

      const shareableLink = generateShareableLink();
      const mediaSize = req.file ? req.file.size : null;

      const { rows } = await query(
        `INSERT INTO messages (senderid, content, imageurl, passcode, shareablelink, mediatype, reaction_length, media_size, max_reactions_allowed, moderation_status, moderation_details, original_imageurl)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [senderId, content, mediaUrl, passcode || null, shareableLink, mediaType, validatedReactionLength, mediaSize, maxReactionsAllowedForMessage, moderationStatus, moderationDetails, originalUrl]
      );

      const message = rows[0];

      if (process.env.NODE_ENV === 'development') {
        console.log(`[Moderation] Message ${message.id} stored with status ${moderationStatus}`);
      }

      // ---- START INCREMENT MESSAGE COUNT ----
      try {
        await query(
          'UPDATE users SET current_messages_this_month = current_messages_this_month + 1 WHERE id = $1',
          [user.id]
        );
        // Optionally update in-memory user object if it's used later in the same request flow
        user.current_messages_this_month = (user.current_messages_this_month ?? 0) + 1;
        console.log(`Successfully incremented message count for user ${user.id}`);
      } catch (incrementError) {
        console.error('Error incrementing user message count in database:', incrementError);
        // This is a critical error as it can lead to incorrect billing or limits.
        // Depending on policy, you might want to "rollback" the message insertion
        // or at least flag this user for manual review.
        // For now, just log, but the message is already sent.
      }
      // ---- END INCREMENT MESSAGE COUNT ----

      res.status(201).json({
        id: message.id,
        senderId: message.senderid,
        content: message.content,
        imageUrl: message.imageurl,
        mediaType: message.mediatype,
        mediaSize: message.media_size,
        shareableLink: message.shareablelink,
        reactionLength: message.reaction_length,
        maxReactionsAllowed: message.max_reactions_allowed, // Include new field in response
        createdAt: new Date(message.createdat).toISOString(),
        updatedAt: new Date(message.updatedat).toISOString()
      });
      return;

    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ error: 'Failed to send message' });
      return;
    }
  });
};

export const getAllMessages = async (req: Request, res: Response): Promise<void> => {
      try {
        if (!req.user) {
            // This should ideally not be reached if requireAuth is effective.
            res.status(401).json({ error: 'User not authenticated for getAllMessages.' });
            return;
        }
        const user = req.user as AppUser; // Changed User to AppUser
        const senderId = user.id; // Use asserted user
    
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = (page - 1) * limit;
    
        // Fetch counts
        const countResult = await query('SELECT COUNT(*) FROM messages WHERE senderid = $1', [senderId]);
        const totalMessages = parseInt(countResult.rows[0]?.count || '0', 10);
    
        const viewedResult = await query('SELECT COUNT(*) FROM messages WHERE senderid = $1 AND viewed = true', [senderId]);
        const viewedMessages = parseInt(viewedResult.rows[0]?.count || '0', 10);
    
        const reactionResult = await query(
          `SELECT COUNT(*) FROM reactions r
           INNER JOIN messages m ON r.messageid = m.id
           WHERE m.senderid = $1`,
          [senderId]
        );
        const totalReactions = parseInt(reactionResult.rows[0]?.count || '0', 10);
    
        // Fetch messages
        const { rows: messages } = await query(
          `SELECT id, content, imageurl, shareablelink, passcode, viewed, createdat, updatedat, reaction_length, media_size, max_reactions_allowed
           FROM messages 
           WHERE senderid = $1 
           ORDER BY createdat DESC 
           LIMIT $2 OFFSET $3`,
          [senderId, limit, offset]
        );
    
        const messageIds = messages.map(msg => msg.id);
    
        // Fetch reactions for those messages
        let reactionMap: Record<string, any[]> = {};
    
        if (messageIds.length > 0) {
          const { rows: reactions } = await query(
            `SELECT id, messageid, name, createdat
             FROM reactions
             WHERE messageid = ANY($1::uuid[])`,
            [messageIds]
          );
    
          // Group reactions by messageId
          reactionMap = reactions.reduce((map, reaction) => {
            const msgId = reaction.messageid;
            if (!map[msgId]) map[msgId] = [];
            map[msgId].push({
              id: reaction.id,
              name: reaction.name,
              createdAt: new Date(reaction.createdat).toISOString()
            });
            return map;
          }, {} as Record<string, any[]>);
        }
    
        // Format messages with attached reactions
        const formattedMessages = messages.map(msg => {
          const reactions_used = (reactionMap[msg.id] || []).length;
          let reactions_remaining: number | null = null;

          if (msg.max_reactions_allowed !== null && msg.max_reactions_allowed !== undefined) {
            reactions_remaining = Math.max(0, msg.max_reactions_allowed - reactions_used);
          }

          return {
            ...msg,
            mediaSize: msg.media_size,
            reactions: reactionMap[msg.id] || [],
            reactions_used,
            reactions_remaining,
            createdAt: new Date(msg.createdat).toISOString(),
            updatedAt: new Date(msg.updatedat).toISOString()
          };
        });
    
        // Return final response
        res.status(200).json({
          messages: formattedMessages,
          pagination: {
            totalMessages,
            totalPages: Math.ceil(totalMessages / limit),
            currentPage: page,
            limit
          },
          stats: {
            totalMessages,
            viewedMessages,
            viewRate: totalMessages > 0
              ? ((viewedMessages / totalMessages) * 100).toFixed(2) + '%'
              : '0%',
            totalReactions,
            reactionRate: totalMessages > 0
              ? ((totalReactions / totalMessages) * 100).toFixed(2) + '%'
              : '0%'
          }
        });
        return;
    
      } catch (error) {
        console.error('Error getting all messages:', error);
        res.status(500).json({ error: 'Failed to get all messages' });
        return;
      }
    };

export const getMessageById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(400).json({ error: 'Invalid ID' });
      return;
    }

    const { rows: messageRows } = await query('SELECT * FROM messages WHERE id = $1', [id]);
    if (!messageRows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const message = messageRows[0];

    // Mark message as viewed asynchronously
    query('UPDATE messages SET viewed = true WHERE id = $1', [message.id]).catch(err => {
      console.error('Failed to mark message as viewed:', err);
    });

    const { rows: reactions } = await query('SELECT * FROM reactions WHERE messageid = $1 ORDER BY createdat ASC', [id]);

    const reactions_used = reactions.length;
    let reactions_remaining: number | null = null;

    if (message.max_reactions_allowed !== null && message.max_reactions_allowed !== undefined) {
      reactions_remaining = Math.max(0, message.max_reactions_allowed - reactions_used);
    }

    const reactionsWithReplies = await Promise.all(reactions.map(async reaction => {
      const { rows: replies } = await query('SELECT id, text, createdat FROM replies WHERE reactionid = $1', [reaction.id]);
      return {
        ...reaction,
        createdAt: new Date(reaction.createdat).toISOString(),
        updatedAt: new Date(reaction.updatedat).toISOString(),
        replies: replies.map(reply => ({
          id: reply.id,
          text: reply.text,
          createdAt: new Date(reply.createdat).toISOString()
        }))
      };
    }));

    res.status(200).json({
      ...message,
      reaction_length: message.reaction_length, // Ensure reaction_length is in the response
      mediaSize: message.media_size,
      createdAt: new Date(message.createdat).toISOString(),
      updatedAt: new Date(message.updatedat).toISOString(),
      reactions: reactionsWithReplies,
      reactions_used,
      reactions_remaining
    });
    return;

  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to get message' });
    return;
  }
};

// === Update Message ===
export const updateMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { passcode, reaction_length } = req.body;

    if (!req.user) {
      res.status(401).json({ error: 'Authentication required to update messages.' });
      return;
    }

    const user = req.user as AppUser;

    // Fetch the message
    const messageResult = await query('SELECT * FROM messages WHERE id = $1', [id]);
    if (messageResult.rows.length === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const message = messageResult.rows[0];

    // Verify ownership
    if (message.senderid !== user.id) {
      res.status(403).json({ error: 'Forbidden: You can only update your own messages' });
      return;
    }

    // Validate reaction_length
    let validatedReactionLength: number | undefined;
    if (reaction_length !== undefined) {
      const parsedReactionLength = parseInt(reaction_length as string, 10);
      if (isNaN(parsedReactionLength) || parsedReactionLength < 10 || parsedReactionLength > 30) {
        res.status(400).json({ error: 'Invalid reaction_length. Must be an integer between 10 and 30.' });
        return;
      }
      validatedReactionLength = parsedReactionLength;
    }

    // Ensure at least one field is being updated
    if (passcode === undefined && validatedReactionLength === undefined) {
      res.status(400).json({ error: 'At least one field (passcode or reaction_length) must be provided for update.' });
      return;
    }

    // Prepare SQL query
    const updateFields: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (passcode !== undefined) {
      updateFields.push(`passcode = $${paramIndex++}`);
      queryParams.push(passcode === null ? null : passcode);
    }

    if (validatedReactionLength !== undefined) {
      updateFields.push(`reaction_length = $${paramIndex++}`);
      queryParams.push(validatedReactionLength);
    }

    if (updateFields.length === 0) {
      // This case should ideally be caught by the check above, but as a safeguard:
      res.status(400).json({ error: 'No valid fields provided for update.' });
      return;
    }

    updateFields.push(`updatedat = NOW()`);

    const updateQuery = `UPDATE messages SET ${updateFields.join(', ')} WHERE id = $${paramIndex++} AND senderid = $${paramIndex++} RETURNING *`;
    queryParams.push(id, user.id);

    // Execute update query
    const { rows: updatedRows, rowCount } = await query(updateQuery, queryParams);

    if (rowCount === 0) {
      // This could happen if the senderid condition fails despite earlier checks (e.g., race condition or if the message was deleted)
      // Or if the ID itself was not found in this atomic operation.
      res.status(404).json({ error: 'Message not found or update failed due to ownership mismatch.' });
      return;
    }

    const updatedMessage = updatedRows[0];

    res.status(200).json({
      id: updatedMessage.id,
      senderId: updatedMessage.senderid,
      content: updatedMessage.content,
      imageUrl: updatedMessage.imageurl,
      mediaType: updatedMessage.mediatype,
      mediaSize: updatedMessage.media_size,
      shareableLink: updatedMessage.shareablelink,
      passcode: updatedMessage.passcode,
      reactionLength: updatedMessage.reaction_length,
      createdAt: new Date(updatedMessage.createdat).toISOString(),
      updatedAt: new Date(updatedMessage.updatedat).toISOString(),
    });
    return;

  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
    return;
  }
};

export const deleteAllReactionsForMessage = async (req: Request, res: Response): Promise<void> => {
  const { messageId } = req.params;

  // Validate messageId as UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(messageId)) {
    res.status(400).json({ error: 'Invalid Message ID format.' });
    return;
  }

  try {
    // Verify Message Exists
    const messageExistsResult = await query('SELECT id FROM messages WHERE id = $1', [messageId]);
    if (messageExistsResult.rows.length === 0) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    // Fetch all reactions for the message to get their IDs and videoUrls
    const reactionsResult = await query('SELECT id, videourl FROM reactions WHERE messageid = $1', [messageId]);
    const reactionsToDelete = reactionsResult.rows; // Array of { id: reactionId, videourl: videoUrl }

    if (reactionsToDelete.length === 0) {
      res.status(200).json({ success: true, message: 'No reactions found for this message. Nothing to delete.' });
      return;
    }

    // Collect all reaction IDs
    const reactionIds = reactionsToDelete.map(r => r.id);

    // Delete associated replies for all fetched reactions
    // Using ANY($1::uuid[]) for potentially better performance if many reaction IDs
    if (reactionIds.length > 0) {
      await query('DELETE FROM replies WHERE reactionid = ANY($1::uuid[])', [reactionIds]);
    }
    
    // Delete all reactions associated with the messageId
    await query('DELETE FROM reactions WHERE messageid = $1', [messageId]);

    // Attempt to delete associated videos from Cloudinary
    let cloudinaryDeletionsFailed = false;
    for (const reaction of reactionsToDelete) {
      if (reaction.videourl) {
        try {
          console.log(`Attempting to delete reaction video from Cloudinary: ${reaction.videourl}`);
          await deleteFromCloudinary(reaction.videourl);
          console.log(`Successfully deleted reaction video: ${reaction.videourl}`);
        } catch (cloudinaryError) {
          cloudinaryDeletionsFailed = true;
          console.error(`Failed to delete reaction video ${reaction.videourl} from Cloudinary:`, cloudinaryError);
          // Log error, but don't fail the entire operation
        }
      }
    }

    let responseMessage = 'All reactions and their replies for the message have been deleted successfully.';
    if (cloudinaryDeletionsFailed) {
      responseMessage += ' Some Cloudinary deletions may have failed, check logs.';
    }

    res.status(200).json({ success: true, message: responseMessage });
    return;

  } catch (dbError) {
    console.error(`Error during database operation for message ${messageId} while deleting all reactions:`, dbError);
    res.status(500).json({ error: 'Failed to delete all reactions for the message due to a server error.' });
    return;
  }
};

export const deleteReactionById = async (req: Request, res: Response): Promise<void> => {
  const { reactionId } = req.params;

  // Validate reactionId as UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(reactionId)) {
    res.status(400).json({ error: 'Invalid Reaction ID format.' });
    return;
  }

  try {
    // Fetch Reaction to get videoUrl
    const reactionQueryResult = await query('SELECT videourl FROM reactions WHERE id = $1', [reactionId]);

    if (reactionQueryResult.rows.length === 0) {
      res.status(404).json({ error: 'Reaction not found.' });
      return;
    }
    const reactionVideoUrl = reactionQueryResult.rows[0].videourl;

    // Database Deletion (Order is Important)
    // 1. Delete associated replies
    await query('DELETE FROM replies WHERE reactionid = $1', [reactionId]);

    // 2. Delete the reaction itself
    await query('DELETE FROM reactions WHERE id = $1', [reactionId]);

    // Cloudinary Deletion
    let cloudinaryDeletionFailed = false;
    if (reactionVideoUrl) {
      try {
        console.log(`Attempting to delete reaction video from Cloudinary: ${reactionVideoUrl}`);
        await deleteFromCloudinary(reactionVideoUrl);
        console.log(`Successfully deleted reaction video: ${reactionVideoUrl}`);
      } catch (cloudinaryError) {
        cloudinaryDeletionFailed = true;
        console.error(`Failed to delete reaction video ${reactionVideoUrl} from Cloudinary:`, cloudinaryError);
        // Log error, but don't fail the entire operation
      }
    }

    let responseMessage = 'Reaction and associated replies deleted successfully.';
    if (cloudinaryDeletionFailed) {
      responseMessage += ' Cloudinary deletion may have failed, check logs.';
    }

    res.status(200).json({ success: true, message: responseMessage });
    return;

  } catch (dbError) {
    console.error(`Error during database operation for reaction ${reactionId}:`, dbError);
    res.status(500).json({ error: 'Failed to delete reaction due to a server error.' });
    return;
  }
};

export const getMessageByShareableLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const { linkId } = req.params;
    const shareableLink = `${process.env.FRONTEND_URL}/m/${linkId}`;
    const { rows } = await query('SELECT * FROM messages WHERE shareablelink = $1', [shareableLink]);

    if (!rows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const message = rows[0];
    const hasPasscode = !!message.passcode;

    if (hasPasscode) {
      res.status(200).json({
        id: message.id,
        hasPasscode: true,
        reaction_length: message.reaction_length, // Add reaction_length
        createdAt: new Date(message.createdat).toISOString()
      });
      return;
    }

    res.status(200).json({
      id: message.id,
      content: message.content,
      imageUrl: message.imageurl,
      hasPasscode: false,
      reaction_length: message.reaction_length, // Add reaction_length
      mediaSize: message.media_size,
      createdAt: new Date(message.createdat).toISOString()
    });
    return;

  } catch (error) {
    console.error('Error getting message by shareable link:', error);
    res.status(500).json({ error: 'Failed to get message' });
    return;
  }
};

export const verifyMessagePasscode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { passcode } = req.body;

    const shareableLink = `${process.env.FRONTEND_URL}/m/${id}`;
    const { rows } = await query('SELECT * FROM messages WHERE shareablelink = $1', [shareableLink]);

    if (!rows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const message = rows[0];

    if (message.passcode !== passcode) {
      res.status(403).json({ error: 'Invalid passcode', verified: false });
      return;
    }

    // Mark message as viewed asynchronously
    query('UPDATE messages SET viewed = true WHERE id = $1', [message.id]).catch(err => {
      console.error('Failed to mark message as viewed after passcode verification:', err);
    });

    res.status(200).json({
      verified: true,
      message: {
        id: message.id,
        content: message.content,
        imageUrl: message.imageurl,
        hasPasscode: true,
        passcodeVerified: true,
        mediaSize: message.media_size,
        createdAt: new Date(message.createdat).toISOString()
      }
    });
    return;

  } catch (error) {
    console.error('Error verifying passcode:', error);
    res.status(500).json({ error: 'Failed to verify passcode' });
    return;
  }
};

export const recordReaction = async (req: Request, res: Response): Promise<void> => {
  console.log("[RecordReactionLog] Entering function. req.params.id:", req.params.id);
  try {
    // === REACTION AUTHOR (REACTOR) CHECK ===
    if (!req.user) {
      console.warn("[RecordReactionLog] Attempt to record reaction without authentication.");
      res.status(401).json({ error: 'Authentication required to record reactions.' });
      return;
    }
    const reactor = req.user as AppUser; // Authenticated user recording the reaction
    console.log("[RecordReactionLog] Reaction author (reactor) ID:", reactor.id);

    const { id: messageId_param } = req.params; // Message ID or shareable link part
    const { name } = req.body; // Name for the reaction (optional)

    // 1. Fetch Message Details (primarily to resolve shareable link to actual ID, and get senderid for isreply update)
    // Limits (per-message, sender's monthly) are now assumed to be handled by initReaction.
    const messageQueryText = `
      SELECT
        id AS actual_message_id,
        senderid
        -- max_reactions_allowed is no longer needed here for limit checks
      FROM messages
      WHERE id = $1 OR shareablelink LIKE $2`;
    const messageResult = await query(messageQueryText, [messageId_param, `%${messageId_param}%`]);

    if (messageResult.rows.length === 0) {
      console.log(`[RecordReactionLog] Message not found for param: ${messageId_param}`);
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    const messageDetails = messageResult.rows[0];
    const actualMessageId = messageDetails.actual_message_id; // This is the true UUID of the message
    // messageSenderId is available from messageDetails.senderid for updating 'isreply' via actualMessageId.
    console.log(`[RecordReactionLog] Resolved message. Actual ID: ${actualMessageId}, Sender ID: ${messageDetails.senderid}`);

    // Limit checks (sender and per-message) are now handled by initReaction.
    // Reactor authentication is handled by middleware.
    // This function now directly proceeds to file upload and reaction recording.

    if (!req.file) {
      console.log("[RecordReactionLog] No reaction video provided.");
      res.status(400).json({ error: 'No reaction video provided' });
      return;
    }

    const { secure_url: actualVideoUrl, thumbnail_url: actualThumbnailUrl, duration: videoDuration, moderation: vidModeration } = await uploadVideoToCloudinaryWithRetry(
      req.file.buffer,
      req.file.size,
      'reactions',
      (req.user && (req.user as AppUser).moderate_videos) ? { moderation: 'aws_rek' } : {}
    );
    const durationInSeconds = videoDuration !== null ? Math.round(videoDuration) : 0;
    console.log(`[RecordReactionLog] Video uploaded. URL: ${actualVideoUrl}, Thumbnail: ${actualThumbnailUrl}, Duration: ${durationInSeconds}s`);

    let moderationStatus = 'approved';
    let moderationDetails: string | null = null;
    let originalVideoUrl = actualVideoUrl;
    if (req.user && (req.user as AppUser).moderate_videos) {
      if (vidModeration && Array.isArray(vidModeration)) {
        const mod = vidModeration[0];
        moderationStatus = mod.status || 'pending';
        moderationDetails = JSON.stringify(mod);
        if (process.env.NODE_ENV === 'development') {
          console.log('[Moderation] Reaction video moderation result:', mod);
        }
      } else {
        moderationStatus = 'pending';
        if (process.env.NODE_ENV === 'development') {
          console.log('[Moderation] Reaction video moderation pending');
        }
      }
    }

    const reactionInsertQuery = `
      INSERT INTO reactions (messageid, videourl, thumbnailurl, duration, createdat, updatedat${name ? ', name' : ''}, moderation_status, moderation_details, original_videourl)
      VALUES ($1, $2, $3, $4, NOW(), NOW()${name ? ', $5' : ''}, $${name ? '6' : '5'}, $${name ? '7' : '6'}, $${name ? '8' : '7'}) RETURNING id`;
    const reactionQueryParams = [actualMessageId, actualVideoUrl, actualThumbnailUrl, durationInSeconds];
    if (name) {
      reactionQueryParams.push(name);
    }
    reactionQueryParams.push(moderationStatus, moderationDetails, originalVideoUrl);
    const { rows: insertedReaction } = await query(reactionInsertQuery, reactionQueryParams);

    // REMOVED: Increment Sender's `reactions_received_this_month` (now handled by initReaction)
    // REMOVED: Increment Reactor's `reactions_authored_this_month`

    if (insertedReaction.length > 0 && insertedReaction[0].id) {
      const newReactionId = insertedReaction[0].id;
      console.log("[RecordReactionLog] Reaction successfully inserted into DB. Reaction ID:", newReactionId);
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Moderation] Reaction ${newReactionId} stored with status ${moderationStatus}`);
      }

      // Update isreply status of the parent message (existing logic)
      query('UPDATE messages SET isreply = true WHERE id = $1', [actualMessageId])
        .then(() => console.log(`[RecordReactionLog] Successfully updated isreply for message ${actualMessageId}`))
        .catch(err => console.error(`[RecordReactionLog] Failed to update isreply for message ${actualMessageId}:`, err));

      res.status(201).json({
        success: true,
        message: 'Reaction recorded successfully',
        reactionId: newReactionId
      });
    } else {
      console.error("[RecordReactionLog] Failed to insert reaction or retrieve ID after upload for messageId:", actualMessageId);
      res.status(500).json({ error: 'Failed to save reaction details to database.' });
    }
    return;

  } catch (error) {
    console.error('[RecordReactionLog] Error during reaction recording process:', error);
    res.status(500).json({ error: 'Failed to record reaction due to a server error.' });
    return;
  }
};

export const recordTextReply = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: reactionId } = req.params;
    const { text } = req.body;

    if (!text?.trim()) {
      res.status(400).json({ error: 'Reply text is required' });
      return;
    }
    if (text.length > 500) {
      res.status(400).json({ error: 'Reply text too long' });
      return;
    }

    const { rows } = await query('SELECT id FROM reactions WHERE id = $1', [reactionId]);
    if (!rows.length) {
      res.status(404).json({ error: 'Reaction not found' });
      return;
    }

    await query(`INSERT INTO replies (reactionid, text, createdat, updatedat) VALUES ($1, $2, NOW(), NOW())`, [reactionId, text.trim()]);

    // Update isreply status of the parent message
    const reactionResult = await query('SELECT messageid FROM reactions WHERE id = $1', [reactionId]);
    if (reactionResult.rows.length > 0) {
      const messageId = reactionResult.rows[0].messageid;
      query('UPDATE messages SET isreply = true WHERE id = $1', [messageId]).catch(err => {
        console.error('Failed to update isreply for message after text reply:', err);
      });
    }

    res.status(200).json({ success: true, message: 'Reply saved to reaction' });
    return;

  } catch (error) {
    console.error('Error recording reply:', error);
    res.status(500).json({ error: 'Failed to record reply' });
    return;
  }
};

export const skipReaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const shareableLink = `${process.env.FRONTEND_URL}/m/${id}`;
    const { rows } = await query('SELECT * FROM messages WHERE shareablelink = $1', [shareableLink]);

    if (!rows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    res.status(200).json({ success: true, message: 'Reaction skipped' });
    return;

  } catch (error) {
    console.error('Error skipping reaction:', error);
    res.status(500).json({ error: 'Failed to skip reaction' });
    return;
  }
};

export const getReactionById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
  
      const { rows } = await query(
        `SELECT id, messageid, videourl, thumbnailurl, duration, name, createdat
         FROM reactions
         WHERE id = $1`,
        [id]
      );
  
      if (!rows.length) {
        res.status(404).json({ error: 'Reaction not found' });
        return;
      }
  
      const reaction = rows[0];
      res.status(200).json({
        ...reaction,
        createdAt: new Date(reaction.createdat).toISOString()
      });
      return;
    } catch (error) {
      console.error('Error fetching reaction by ID:', error);
      res.status(500).json({ error: 'Failed to get reaction' });
      return;
    }
  };

export const deleteMessageAndReaction = async (req: Request, res: Response): Promise<void> => {
  const { id: paramId } = req.params; // paramId can be message UUID or shareableLink part

  try {
    // 1. Fetch Message and its imageUrl
    // Try finding by direct ID first, then by shareable link part.
    let messageQueryResult = await query('SELECT id, imageurl FROM messages WHERE id = $1', [paramId]);
    if (messageQueryResult.rows.length === 0) {
      // Try finding by shareable link if not a direct UUID match (or if paramId wasn't a UUID)
      // Constructing the like pattern for shareableLink
      const shareableLinkPattern = `%/${paramId}`;
      messageQueryResult = await query('SELECT id, imageurl FROM messages WHERE shareablelink LIKE $1', [shareableLinkPattern]);
    }

    if (messageQueryResult.rows.length === 0) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const message = messageQueryResult.rows[0];
    const messageId = message.id; // Actual UUID of the message
    const messageImageUrl = message.imageurl;

    // 2. Fetch Reactions and their videoUrls
    const reactionsQueryResult = await query('SELECT id, videourl FROM reactions WHERE messageid = $1', [messageId]);
    const reactions = reactionsQueryResult.rows; // Array of { id: reactionId, videourl: videoUrl }

    // 3. Database Deletion (Order is Important)
    // For each reaction found, delete its associated replies
    for (const reaction of reactions) {
      if (reaction.id) {
        await query('DELETE FROM replies WHERE reactionid = $1', [reaction.id]);
      }
    }

    // Delete all reactions associated with the messageId
    await query('DELETE FROM reactions WHERE messageid = $1', [messageId]);

    // Delete the message itself
    await query('DELETE FROM messages WHERE id = $1', [messageId]);

    // 4. Cloudinary Deletion (after successful DB deletions)
    let cloudinaryDeletionsFailed = false;
    if (messageImageUrl) {
      try {
        console.log(`Attempting to delete message image from Cloudinary: ${messageImageUrl}`);
        await deleteFromCloudinary(messageImageUrl);
        console.log(`Successfully deleted message image: ${messageImageUrl}`);
      } catch (cloudinaryError) {
        cloudinaryDeletionsFailed = true;
        console.error(`Failed to delete message image ${messageImageUrl} from Cloudinary:`, cloudinaryError);
        // Log error, but don't fail the entire operation
      }
    }

    for (const reaction of reactions) {
      if (reaction.videourl) {
        try {
          console.log(`Attempting to delete reaction video from Cloudinary: ${reaction.videourl}`);
          await deleteFromCloudinary(reaction.videourl);
          console.log(`Successfully deleted reaction video: ${reaction.videourl}`);
        } catch (cloudinaryError) {
          cloudinaryDeletionsFailed = true;
          console.error(`Failed to delete reaction video ${reaction.videourl} from Cloudinary:`, cloudinaryError);
          // Log error, but don't fail the entire operation
        }
      }
    }
    
    let responseMessage = 'Message and associated data deleted successfully.';
    if (cloudinaryDeletionsFailed) {
        responseMessage += ' Some Cloudinary deletions may have failed, check logs.';
    }

    res.status(200).json({ success: true, message: responseMessage });
    return;

  } catch (dbError) {
    console.error('Error during database operation in deleteMessageAndReaction:', dbError);
    res.status(500).json({ error: 'Failed to delete message and associated data due to a server error.' });
    return;
  }
};

export const initReaction = async (req: Request, res: Response): Promise<void> => {
  const { messageId } = req.params; // This is actual_message_id
  const { sessionid, name } = req.body;

  console.log("[InitReactionLog] Entering function. messageId:", messageId, "sessionid:", sessionid);

  if (!sessionid) {
    // Session ID is still crucial for the specific purpose of initReaction if it's meant to be idempotent per session
    // However, if general limits are hit, this specific session check might be secondary.
    // For now, let's keep this check early if it's a hard requirement for the endpoint's contract.
    // Re-evaluating: The task asks for general limits to be checked first.
    // So, sessionid check can be done later, or only if limits pass.
    // For now, let's proceed with limit checks. SessionID will be used at insertion.
  }

  try {
    // 1. Fetch Message Details (including senderid and max_reactions_allowed)
    const messageQueryText = `
      SELECT
        id AS actual_message_id,
        senderid,
        max_reactions_allowed
      FROM messages
      WHERE id = $1`; // Using messageId directly as it's the UUID from params
    const messageResult = await query(messageQueryText, [messageId]);

    if (messageResult.rows.length === 0) {
      console.log(`[InitReactionLog] Message not found for ID: ${messageId}`);
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    const messageDetails = messageResult.rows[0];
    // actualMessageId is messageId from params
    const messageSenderId = messageDetails.senderid;
    console.log("[InitReactionLog] Fetched messageDetails:", { id: messageId, senderid: messageSenderId, max_reactions_allowed: messageDetails.max_reactions_allowed });

    // 2. Fetch Message Sender's User Details
    const senderQueryText = `
      SELECT
        id,
        max_reactions_per_month,
        reactions_received_this_month,
        last_usage_reset_date,
        current_messages_this_month -- needed for shared reset logic
      FROM users
      WHERE id = $1`;
    const senderResult = await query(senderQueryText, [messageSenderId]);

    if (senderResult.rows.length === 0) {
      console.error(`[InitReactionLog] CRITICAL: Sender user not found for id: ${messageSenderId} (messageId: ${messageId})`);
      res.status(500).json({ error: 'Failed to retrieve message sender details.' });
      return;
    }
    const messageSender: AppUser = senderResult.rows[0] as AppUser;
    console.log("[InitReactionLog] Fetched messageSender (before reset check):", JSON.stringify(messageSender));

    // 3. Sender's Monthly Usage Reset Logic
    const now = new Date();
    let needsReset = false;
    if (messageSender.last_usage_reset_date === null || messageSender.last_usage_reset_date === undefined) {
      needsReset = true;
    } else {
      const resetDate = new Date(messageSender.last_usage_reset_date);
      if (!isNaN(resetDate.getTime())) {
        const resetYear = resetDate.getFullYear();
        const resetMonth = resetDate.getMonth();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        if (resetYear < currentYear || (resetYear === currentYear && resetMonth < currentMonth)) {
          needsReset = true;
        }
      } else {
        console.error(`[InitReactionLog] Message sender ${messageSender.id} has an invalid last_usage_reset_date: ${messageSender.last_usage_reset_date}`);
        needsReset = true;
      }
    }

    if (needsReset) {
      try {
        const resetResult = await query(
         `UPDATE users SET current_messages_this_month = 0, reactions_received_this_month = 0, last_usage_reset_date = NOW() WHERE id = $1 RETURNING *`,
         [messageSender.id]
        );
        if (resetResult.rows.length > 0) {
            const updatedSender = resetResult.rows[0];
            messageSender.reactions_received_this_month = updatedSender.reactions_received_this_month;
            messageSender.current_messages_this_month = updatedSender.current_messages_this_month;
            messageSender.last_usage_reset_date = updatedSender.last_usage_reset_date;
            console.log("[InitReactionLog] MessageSender after successful reset and in-memory update:", JSON.stringify(messageSender));
        } else {
            console.error(`[InitReactionLog] CRITICAL: Failed to get RETURNING data for sender ${messageSender.id} after reset attempt.`);
            res.status(500).json({ error: 'Failed to confirm sender usage data reset. Please try again.' });
            return;
        }
      } catch (dbError) {
        console.error(`[InitReactionLog] Failed to reset monthly counts for sender ${messageSender.id}:`, dbError);
        res.status(500).json({ error: 'Failed to update sender usage data.' });
        return;
      }
    }

    // 4. Check Sender's Monthly Received Reactions Limit
    const currentReceived = messageSender.reactions_received_this_month ?? 0;
    const maxCanReceive = messageSender.max_reactions_per_month;
    if (typeof maxCanReceive === 'number' &&
        maxCanReceive >= 0 &&
        currentReceived >= maxCanReceive) {
      console.log("[InitReactionLog] Sender monthly received limit reached. Blocking reaction init."); // Retained: Operational log
      res.status(403).json({ error: 'This user can no longer receive reaction at this time (limit reached).' });
      return;
    }

    // 5. Check Per-Message Reaction Limit
    if (typeof messageDetails.max_reactions_allowed === 'number' && messageDetails.max_reactions_allowed >= 0) {
      const reactionCountResult = await query('SELECT COUNT(*) FROM reactions WHERE messageid = $1', [messageId]);
      const current_reaction_count_for_message = parseInt(reactionCountResult.rows[0]?.count || '0', 10);
      const isLimitExceeded = current_reaction_count_for_message >= messageDetails.max_reactions_allowed;

      if (isLimitExceeded) {
        console.log("[InitReactionLog] Per-message limit reached. Blocking reaction init."); // Retained: Operational log
        res.status(403).json({ error: 'This user can no longer receive reaction at this time (limit reached).' });
        return;
      }
    }

    // 6. Existing Logic (Session ID check & Reaction Creation)
    // Moved session ID check here, as per instruction "Perform general limit checks *before* the session ID check"
    if (!sessionid) { // Now checking sessionid after limit checks
        console.log("[InitReactionLog] Missing session ID after passing limit checks.");
        res.status(400).json({ error: 'Missing session ID' });
        return;
    }
    console.log("[InitReactionLog] Passed all limit checks. Proceeding with session ID check for messageId:", messageId, "sessionid:", sessionid);

    const { rows: existing } = await query(
      `SELECT id FROM reactions WHERE messageid = $1 AND sessionid = $2`,
      [messageId, sessionid]
    );

    if (existing.length > 0) {
      console.log("[InitReactionLog] Existing reaction found for session. Reaction ID:", existing[0].id);
      res.status(200).json({ reactionId: existing[0].id }); // Return existing reaction if found for this session
      return;
    }

    // 7. Proceed with Reaction Creation (if all checks pass and no existing session reaction)
    console.log("[InitReactionLog] No existing reaction for session. Creating new reaction with values:", { messageId, sessionid, name });

    let insertQuery = `
      INSERT INTO reactions (messageid, sessionid, createdat, updatedat${name ? ', name' : ''})
      VALUES ($1, $2, NOW(), NOW()${name ? ', $3' : ''}) RETURNING id`;
    
    const queryParams = [messageId, sessionid];
    if (name) {
      queryParams.push(name);
    }

    // Declare inserted variable to ensure it's in scope
    let inserted: any[] = [];
    const queryResult = await query(insertQuery, queryParams);
    if (queryResult && queryResult.rows) {
      inserted = queryResult.rows;
    }

    if (inserted && inserted.length > 0 && inserted[0].id) {
      const newReactionId = inserted[0].id;
      console.log("[InitReactionLog] New reaction inserted with ID:", newReactionId);

      // 8. Increment Sender's `reactions_received_this_month`
      try {
        const newReceivedCount = (messageSender.reactions_received_this_month ?? 0) + 1;
        await query(
          "UPDATE users SET reactions_received_this_month = (COALESCE(reactions_received_this_month, 0) + 1) WHERE id = $1",
          [messageSender.id]
        );
        messageSender.reactions_received_this_month = newReceivedCount; // Update in-memory
        console.log(`[InitReactionLog] Successfully incremented reactions_received_this_month for sender ${messageSender.id}. New count: ${newReceivedCount}`);
      } catch (incrementError) {
        console.error(`[InitReactionLog] Error incrementing sender's reactions_received_this_month for user ${messageSender.id}:`, incrementError);
        // Log and continue; reaction is initialized, but sender's count might be off.
      }

      res.status(201).json({ reactionId: newReactionId });
    } else {
      // Should not happen if insert query is correct and DB is responsive
      console.error("[InitReactionLog] Failed to insert new reaction or get its ID back for messageId:", messageId);
      res.status(500).json({ error: 'Failed to create new reaction.' });
    }
    return;

  } catch (error: any) {
    console.error('❌ Error initializing reaction (outer catch):', {
      message: error.message,
      stack: error.stack,
    });

    res.status(500).json({ error: 'Failed to initialize reaction' });
    return;
  }
};

export const uploadReactionVideo = async (req: Request, res: Response): Promise<void> => {
  const { reactionId } = req.params;
  if (!req.file) {
    res.status(400).json({ error: 'No video file provided' });
    return;
  }

  try {
    const { secure_url: actualVideoUrl, thumbnail_url: actualThumbnailUrl, duration: videoDuration, moderation: vidModeration } = await uploadVideoToCloudinaryWithRetry(
      req.file.buffer,
      req.file.size,
      'reactions',
      req.user && (req.user as AppUser).moderate_videos ? { moderation: 'aws_rek' } : {}
    );
    const duration = videoDuration !== null ? Math.round(videoDuration) : 0; // Use dynamic duration, default to 0 if null

    let moderationStatus = 'approved';
    let moderationDetails: string | null = null;
    let originalVideoUrl = actualVideoUrl;

    if (req.user && (req.user as AppUser).moderate_videos) {
      if (vidModeration && Array.isArray(vidModeration)) {
        const mod = vidModeration[0];
        moderationStatus = mod.status || 'pending';
        moderationDetails = JSON.stringify(mod);
        if (process.env.NODE_ENV === 'development') {
          console.log('[Moderation] Reaction video moderation result:', mod);
        }
      } else {
        moderationStatus = 'pending';
        if (process.env.NODE_ENV === 'development') {
          console.log('[Moderation] Reaction video moderation pending');
        }
      }
    }

    const updateQuery = `UPDATE reactions
       SET videourl = $1, thumbnailurl = $2, duration = $3, updatedat = NOW(),
           moderation_status = $4, moderation_details = $5, original_videourl = $6
       WHERE id = $7`;
    const updateParams = [actualVideoUrl, actualThumbnailUrl, duration, moderationStatus, moderationDetails, originalVideoUrl, reactionId];

    if (process.env.NODE_ENV === 'development') {
      console.log('[uploadReactionVideo] query:', updateQuery, 'params:', updateParams);
    }

    await query(updateQuery, updateParams);

    // Update isreply status of the parent message
    const reactionResult = await query('SELECT messageid FROM reactions WHERE id = $1', [reactionId]);
    if (reactionResult.rows.length > 0) {
      const messageId = reactionResult.rows[0].messageid;
      query('UPDATE messages SET isreply = true WHERE id = $1', [messageId]).catch(err => {
        console.error('Failed to update isreply for message after video upload:', err);
      });
    }

    res.status(200).json({
      success: true,
      message: 'Video uploaded successfully',
      videoUrl: actualVideoUrl, // ensure actualVideoUrl is passed in response
    });
    return;
  } catch (error) {
    console.error('Error uploading reaction video:', error);
    res.status(500).json({ error: 'Failed to upload reaction video' });
    return;
  }
};

export const getReactionsByMessageId = async (req: Request, res: Response): Promise<void> => { // Ensure this function is not duplicated or malformed
  const { messageId } = req.params;

  try {
    const { rows } = await query(
      `SELECT id, videourl, thumbnailurl, duration, createdat, updatedat 
       FROM reactions 
       WHERE messageid = $1 
       ORDER BY createdat ASC`,
      [messageId]
    );

    const formattedReactions = rows.map(reaction => ({
      id: reaction.id,
      videoUrl: reaction.videourl,
      thumbnailUrl: reaction.thumbnailurl,
      duration: reaction.duration,
      createdAt: new Date(reaction.createdat).toISOString(),
      updatedAt: new Date(reaction.updatedat).toISOString()
    }));

    res.status(200).json(formattedReactions);
    return;
  } catch (error) {
    console.error('Error fetching reactions by message ID:', error);
    res.status(500).json({ error: 'Failed to fetch reactions' });
    return;
  }
};

export const submitMessageForManualReview = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const { rows } = await query('SELECT imageurl FROM messages WHERE id = $1', [id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    const imageUrl = rows[0].imageurl;
    const extracted = extractPublicIdAndResourceType(imageUrl);
    if (!extracted) {
      res.status(400).json({ error: 'Invalid Cloudinary URL' });
      return;
    }
    await cloudinary.uploader.explicit(extracted.public_id, { type: 'upload', moderation: 'manual' });
    await query('UPDATE messages SET moderation_status = $1 WHERE id = $2', ['manual_review', id]);
    res.status(200).json({ success: true });
    return;
  } catch (err) {
    console.error('Manual review submission failed:', err);
    res.status(500).json({ error: 'Failed to submit for manual review' });
    return;
  }
};

export const submitReactionForManualReview = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    const { rows } = await query('SELECT videourl FROM reactions WHERE id = $1', [id]);
    if (!rows.length) {
      res.status(404).json({ error: 'Reaction not found' });
      return;
    }
    const videoUrl = rows[0].videourl;
    const extracted = extractPublicIdAndResourceType(videoUrl);
    if (!extracted) {
      res.status(400).json({ error: 'Invalid Cloudinary URL' });
      return;
    }
    await cloudinary.uploader.explicit(extracted.public_id, { type: 'upload', moderation: 'manual' });
    await query('UPDATE reactions SET moderation_status = $1 WHERE id = $2', ['manual_review', id]);
    res.status(200).json({ success: true });
    return;
  } catch (err) {
    console.error('Manual review submission failed:', err);
    res.status(500).json({ error: 'Failed to submit for manual review' });
    return;
  }
};
