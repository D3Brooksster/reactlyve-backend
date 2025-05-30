import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { query } from '../config/database.config';
import crypto from 'crypto';
import "dotenv/config";
import { AppUser } from '../entity/User'; // Changed User to AppUser
import { deleteFromCloudinary, uploadToCloudinarymedia, uploadVideoToCloudinary } from '../utils/cloudinaryUtils';
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
  limits: { fileSize: 10 * 1024 * 1024 },
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

    if (user.role === 'guest') {
      res.status(403).json({ error: 'Guests are not authorized to send messages. Please wait for admin approval.' });
      return;
    }

    try {
      const { content, passcode, reaction_length } = req.body; // Extract reaction_length
      const senderId = user.id; // Use user.id from the asserted user

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

      if (req.file) {
        mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
        mediaUrl = await uploadToCloudinarymedia(req.file.buffer, mediaType as 'image' | 'video');
      }

      const shareableLink = generateShareableLink();

      const { rows } = await query(
        `INSERT INTO messages (senderid, content, imageurl, passcode, shareablelink, mediatype, reaction_length)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [senderId, content, mediaUrl, passcode || null, shareableLink, mediaType, validatedReactionLength]
      );

      const message = rows[0];
      res.status(201).json({
        id: message.id,
        senderId: message.senderid,
        content: message.content,
        imageUrl: message.imageurl,
        mediaType: message.mediatype,
        shareableLink: message.shareablelink,
        reactionLength: message.reaction_length, // Add reaction_length to response
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
          `SELECT id, content, imageurl, shareablelink, passcode, viewed, createdat, updatedat, reaction_length
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
        const formattedMessages = messages.map(msg => ({
          ...msg,
          reactions: reactionMap[msg.id] || [],
          createdAt: new Date(msg.createdat).toISOString(),
          updatedAt: new Date(msg.updatedat).toISOString()
        }));
    
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
      createdAt: new Date(message.createdat).toISOString(),
      updatedAt: new Date(message.updatedat).toISOString(),
      reactions: reactionsWithReplies
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
  try {
    const { id } = req.params;
    const { name } = req.body; // Added name
    if (!req.file) {
      res.status(400).json({ error: 'No reaction video provided' });
      return;
    }

    const { rows } = await query('SELECT id FROM messages WHERE id = $1 OR shareablelink LIKE $2', [id, `%${id}`]);
    if (!rows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const messageId = rows[0].id;
    const { secure_url: videoUrl, duration: videoDuration } = await uploadVideoToCloudinary(req.file.buffer);
    const thumbnailUrl = videoUrl; // Assuming thumbnail is same as video, or can be derived
    const duration = videoDuration !== null ? Math.round(videoDuration) : 0; // Use dynamic duration, default to 0 if null

    const queryText = `
      INSERT INTO reactions (messageid, videourl, thumbnailurl, duration, createdat, updatedat${name ? ', name' : ''})
      VALUES ($1, $2, $3, $4, NOW(), NOW()${name ? ', $5' : ''}) RETURNING id`;
    
    const queryParams = [messageId, videoUrl, thumbnailUrl, duration];
    if (name) {
      queryParams.push(name);
    }

    const { rows: inserted } = await query(queryText, queryParams);

    if (inserted.length > 0 && inserted[0].id) {
      // Update isreply status of the parent message
      query('UPDATE messages SET isreply = true WHERE id = $1', [messageId]).catch(err => {
        console.error('Failed to update isreply for message after reaction:', err);
      });
    }

    res.status(201).json({
      success: true,
      message: 'Reaction recorded successfully',
      reactionId: inserted[0].id
    });
    return;

  } catch (error) {
    console.error('Error recording reaction:', error);
    res.status(500).json({ error: 'Failed to record reaction' });
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
  const { messageId } = req.params;
  const { sessionid, name } = req.body; // Added name

  console.log("Received sessionid:", sessionid);
  
  if (!sessionid) {
    res.status(400).json({ error: 'Missing session ID' });
    return;
  }

  try {
    // Verify message exists
    const { rows: messageRows } = await query(
      'SELECT id FROM messages WHERE id = $1',
      [messageId]
    );
    if (!messageRows.length) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // Check for existing reaction by session
    const { rows: existing } = await query(
      `SELECT id FROM reactions WHERE messageid = $1 AND sessionid = $2`,
      [messageId, sessionid]
    );

    if (existing.length > 0) {
      res.status(200).json({ reactionId: existing[0].id });
      return;
    }

    // Create new reaction
    console.log("About to insert new reaction with values:", { messageId, sessionid, name }); // Added name

    let insertQuery = `
      INSERT INTO reactions (messageid, sessionid, createdat, updatedat${name ? ', name' : ''})
      VALUES ($1, $2, NOW(), NOW()${name ? ', $3' : ''}) RETURNING id`;
    
    const queryParams = [messageId, sessionid];
    if (name) {
      queryParams.push(name);
    }

    console.log("Insert query:", insertQuery);

    const { rows: inserted } = await query(insertQuery, queryParams);

    console.log("Reaction inserted with ID:", inserted[0]?.id);

    
    res.status(201).json({ reactionId: inserted[0].id });
    return;

  } catch (error: any) {
    console.error('❌ Error initializing reaction:', {
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
    const { secure_url: videoUrl, duration: videoDuration } = await uploadVideoToCloudinary(req.file.buffer);
    const thumbnailUrl = videoUrl; // Assuming thumbnail is same as video, or can be derived
    const duration = videoDuration !== null ? Math.round(videoDuration) : 0; // Use dynamic duration, default to 0 if null

    await query(
      `UPDATE reactions
       SET videourl = $1, thumbnailurl = $2, duration = $3, updatedat = NOW()
       WHERE id = $4`,
      [videoUrl, thumbnailUrl, duration, reactionId]
    );

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
      videoUrl: videoUrl, // ensure videoUrl is passed in response
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
