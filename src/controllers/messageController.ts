import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import { query } from '../config/database.config';
import crypto from 'crypto';
import "dotenv/config";
import { uploadToCloudinarymedia, uploadVideoToCloudinary } from '../routes/messageRoutes';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string; // Added email to user object
  };
}

// Cloudinary setup
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

const deleteFromCloudinary = (cloudinaryUrl: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(cloudinaryUrl);
      const pathname = url.pathname; // e.g., /<cloud_name>/<resource_type>/upload/v<version>/<folder>/<public_id_with_ext>

      const pathSegments = pathname.split('/').filter(segment => segment); // remove empty segments

      // Minimum structure: /<cloud_name>/<resource_type>/<delivery_type>/<public_id_part>
      // Example: /mycloud/image/upload/file.jpg  (length 4)
      if (pathSegments.length < 4) { 
        return reject(new Error('Invalid Cloudinary URL: Path too short. Needs at least cloud_name, resource_type, delivery_type, and public_id part.'));
      }

      // pathSegments[0] = <cloud_name> (e.g. "mycloud")
      // pathSegments[1] = <resource_type> (e.g. "image", "video")
      // pathSegments[2] = <delivery_type> (e.g. "upload", "fetch")
      // pathSegments[3:] = parts that make up the public_id, potentially including a version string.

      const resource_type = pathSegments[1];
      if (!['image', 'video', 'raw'].includes(resource_type)) {
        return reject(new Error(`Invalid resource_type: '${resource_type}'. Must be 'image', 'video', or 'raw'.`));
      }

      // For deletion, delivery_type is usually "upload". We could validate pathSegments[2] if needed.
      // const delivery_type = pathSegments[2];
      // if (delivery_type !== 'upload') {
      //   return reject(new Error(`Invalid delivery_type: '${delivery_type}'. Expected 'upload'.`));
      // }

      const startIndexAfterUpload = 3; // Public ID parts start after cloud_name/resource_type/delivery_type
      const potentialPublicIdParts = pathSegments.slice(startIndexAfterUpload);

      if (potentialPublicIdParts.length === 0) {
        return reject(new Error('No segments found for public_id after cloud_name/resource_type/delivery_type.'));
      }

      // Filter out the version segment (e.g., "v1234567890") from these parts.
      // The version segment can be anywhere within these parts.
      let versionSegmentFound = false;
      const publicIdPathParts = potentialPublicIdParts.filter(segment => {
        if (segment.match(/^v\d+$/)) {
          versionSegmentFound = true;
          return false; // Exclude version segment
        }
        return true; // Keep other segments
      });

      // Note: Cloudinary URLs typically always have a version, even if it's v1.
      // If no version string is explicitly found, all parts are considered part of the public_id.
      // This behavior is implicitly handled by the filter above. If `versionSegmentFound` is useful for logging, it can be kept.

      if (publicIdPathParts.length === 0) {
        return reject(new Error('Public ID path parts array is empty after filtering version segment (if any).'));
      }

      const publicIdWithExtension = publicIdPathParts.join('/');
      
      // Remove the file extension from the last part of publicIdWithExtension
      const lastDotIndex = publicIdWithExtension.lastIndexOf('.');
      // Ensure dot is not the first character and an extension exists.
      const public_id = (lastDotIndex > 0 && lastDotIndex < publicIdWithExtension.length -1) 
                        ? publicIdWithExtension.substring(0, lastDotIndex) 
                        : publicIdWithExtension;

      if (!public_id) { // Should not happen if publicIdPathParts was not empty.
        return reject(new Error('Public ID became empty after attempting to remove extension.'));
      }
      
      console.log(`Attempting to delete from Cloudinary: public_id='${public_id}', resource_type='${resource_type}'`);

      cloudinary.uploader.destroy(public_id, { resource_type: resource_type }, (error, result) => {
        if (error) {
          console.error('Error deleting from Cloudinary:', error);
          return reject(error);
        }
        if (result && result.result !== 'ok' && result.result !== 'not found') {
            console.warn('Cloudinary deletion warning:', result);
            // We can choose to reject or resolve based on the 'result.result'
            // For now, let's consider 'not found' as a successful deletion for idempotency.
            // Other non-'ok' results could be actual issues.
             if (result.result === 'not found') {
                console.log(`Asset with public_id '${public_id}' not found on Cloudinary. Considered as deleted.`);
                return resolve(result);
            }
            return reject(new Error(`Cloudinary deletion failed: ${result.result}`));
        }
        console.log('Successfully deleted from Cloudinary or asset was not found:', result);
        resolve(result);
      });
    } catch (error) {
      console.error('Failed to parse Cloudinary URL or other unexpected error:', error);
      reject(error);
    }
  });
};

// === Controllers ===
export const sendMessage = (req: AuthenticatedRequest, res: Response) => {
  upload(req, res, async (err) => {
    if (err) return res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: err.message });

    // Authorization check
    const allowedEmails = ['danobrooks@gmail.com', 'dan@normal.ninja'];
    if (req.user && req.user.email && !allowedEmails.includes(req.user.email)) {
      return res.status(403).json({ error: 'You are not authorized to send messages.' });
    }

    try {
      const { content, passcode } = req.body;
      const senderId = req.user?.id;
      if (!content) return res.status(400).json({ error: 'Message content is required' });

      let mediaUrl: string | null = null;
      let mediaType: string | null = null;

      if (req.file) {
        mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
        mediaUrl = await uploadToCloudinarymedia(req.file.buffer, mediaType as 'image' | 'video');
      }

      const shareableLink = generateShareableLink();

      const { rows } = await query(
        `INSERT INTO messages (senderId, content, imageUrl, passcode, shareableLink, mediaType)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [senderId, content, mediaUrl, passcode || null, shareableLink, mediaType]
      );

      const message = rows[0];
      return res.status(201).json({
        id: message.id,
        senderId: message.senderid,
        content: message.content,
        imageUrl: message.imageurl,
        mediaType: message.mediatype,
        shareableLink: message.shareablelink,
        createdAt: new Date(message.createdat).toISOString(),
        updatedAt: new Date(message.updatedat).toISOString()
      });

    } catch (error) {
      console.error('Error sending message:', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  });
};

export const getAllMessages = async (req: AuthenticatedRequest, res: Response) => {
      try {
        const senderId = req.user?.id;
        if (!senderId) return res.status(401).json({ error: 'User not authenticated' });
    
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const offset = (page - 1) * limit;
    
        // Fetch counts
        const countResult = await query('SELECT COUNT(*) FROM messages WHERE senderId = $1', [senderId]);
        const totalMessages = parseInt(countResult.rows[0]?.count || '0', 10);
    
        const viewedResult = await query('SELECT COUNT(*) FROM messages WHERE senderId = $1 AND viewed = true', [senderId]);
        const viewedMessages = parseInt(viewedResult.rows[0]?.count || '0', 10);
    
        const reactionResult = await query(
          `SELECT COUNT(*) FROM reactions r
           INNER JOIN messages m ON r.messageId = m.id
           WHERE m.senderId = $1`,
          [senderId]
        );
        const totalReactions = parseInt(reactionResult.rows[0]?.count || '0', 10);
    
        // Fetch messages
        const { rows: messages } = await query(
          `SELECT id, content, imageUrl, shareableLink, passcode, viewed, createdAt, updatedAt
           FROM messages 
           WHERE senderId = $1 
           ORDER BY createdAt DESC 
           LIMIT $2 OFFSET $3`,
          [senderId, limit, offset]
        );
    
        const messageIds = messages.map(msg => msg.id);
    
        // Fetch reactions for those messages
        let reactionMap: Record<string, any[]> = {};
    
        if (messageIds.length > 0) {
          const { rows: reactions } = await query(
            `SELECT id, messageId, name, createdAt
             FROM reactions
             WHERE messageId = ANY($1::uuid[])`,
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
        return res.status(200).json({
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
    
      } catch (error) {
        console.error('Error getting all messages:', error);
        return res.status(500).json({ error: 'Failed to get all messages' });
      }
    };

export const getMessageById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) return res.status(400).json({ error: 'Invalid ID' });

    const { rows: messageRows } = await query('SELECT * FROM messages WHERE id = $1', [id]);
    if (!messageRows.length) return res.status(404).json({ error: 'Message not found' });

    const message = messageRows[0];

    // Mark message as viewed asynchronously
    query('UPDATE messages SET viewed = true WHERE id = $1', [message.id]).catch(err => {
      console.error('Failed to mark message as viewed:', err);
    });

    const { rows: reactions } = await query('SELECT * FROM reactions WHERE messageId = $1 ORDER BY createdAt ASC', [id]);

    const reactionsWithReplies = await Promise.all(reactions.map(async reaction => {
      const { rows: replies } = await query('SELECT id, text, createdAt FROM replies WHERE reactionId = $1', [reaction.id]);
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

    return res.status(200).json({
      ...message,
      createdAt: new Date(message.createdat).toISOString(),
      updatedAt: new Date(message.updatedat).toISOString(),
      reactions: reactionsWithReplies
    });

  } catch (error) {
    console.error('Error fetching message:', error);
    return res.status(500).json({ error: 'Failed to get message' });
  }
};

export const deleteAllReactionsForMessage = async (req: Request, res: Response) => {
  const { messageId } = req.params;

  // Validate messageId as UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(messageId)) {
    return res.status(400).json({ error: 'Invalid Message ID format.' });
  }

  try {
    // Verify Message Exists
    const messageExistsResult = await query('SELECT id FROM messages WHERE id = $1', [messageId]);
    if (messageExistsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found.' });
    }

    // Fetch all reactions for the message to get their IDs and videoUrls
    const reactionsResult = await query('SELECT id, videoUrl FROM reactions WHERE messageId = $1', [messageId]);
    const reactionsToDelete = reactionsResult.rows; // Array of { id: reactionId, videourl: videoUrl }

    if (reactionsToDelete.length === 0) {
      return res.status(200).json({ success: true, message: 'No reactions found for this message. Nothing to delete.' });
    }

    // Collect all reaction IDs
    const reactionIds = reactionsToDelete.map(r => r.id);

    // Delete associated replies for all fetched reactions
    // Using ANY($1::uuid[]) for potentially better performance if many reaction IDs
    if (reactionIds.length > 0) {
      await query('DELETE FROM replies WHERE reactionId = ANY($1::uuid[])', [reactionIds]);
    }
    
    // Delete all reactions associated with the messageId
    await query('DELETE FROM reactions WHERE messageId = $1', [messageId]);

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

    return res.status(200).json({ success: true, message: responseMessage });

  } catch (dbError) {
    console.error(`Error during database operation for message ${messageId} while deleting all reactions:`, dbError);
    return res.status(500).json({ error: 'Failed to delete all reactions for the message due to a server error.' });
  }
};

export const deleteReactionById = async (req: Request, res: Response) => {
  const { reactionId } = req.params;

  // Validate reactionId as UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(reactionId)) {
    return res.status(400).json({ error: 'Invalid Reaction ID format.' });
  }

  try {
    // Fetch Reaction to get videoUrl
    const reactionQueryResult = await query('SELECT videoUrl FROM reactions WHERE id = $1', [reactionId]);

    if (reactionQueryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reaction not found.' });
    }
    const reactionVideoUrl = reactionQueryResult.rows[0].videourl;

    // Database Deletion (Order is Important)
    // 1. Delete associated replies
    await query('DELETE FROM replies WHERE reactionId = $1', [reactionId]);

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

    return res.status(200).json({ success: true, message: responseMessage });

  } catch (dbError) {
    console.error(`Error during database operation for reaction ${reactionId}:`, dbError);
    return res.status(500).json({ error: 'Failed to delete reaction due to a server error.' });
  }
};

export const getMessageByShareableLink = async (req: Request, res: Response) => {
  try {
    const { linkId } = req.params;
    const shareableLink = `${process.env.FRONTEND_URL}/m/${linkId}`;
    const { rows } = await query('SELECT * FROM messages WHERE shareableLink = $1', [shareableLink]);

    if (!rows.length) return res.status(404).json({ error: 'Message not found' });

    const message = rows[0];
    const hasPasscode = !!message.passcode;

    if (hasPasscode) {
      return res.status(200).json({ id: message.id, hasPasscode: true, createdAt: new Date(message.createdat).toISOString() });
    }

    return res.status(200).json({
      id: message.id,
      content: message.content,
      imageUrl: message.imageurl,
      hasPasscode: false,
      createdAt: new Date(message.createdat).toISOString()
    });

  } catch (error) {
    console.error('Error getting message by shareable link:', error);
    return res.status(500).json({ error: 'Failed to get message' });
  }
};

export const verifyMessagePasscode = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { passcode } = req.body;

    const shareableLink = `${process.env.FRONTEND_URL}/m/${id}`;
    const { rows } = await query('SELECT * FROM messages WHERE shareableLink = $1', [shareableLink]);

    if (!rows.length) return res.status(404).json({ error: 'Message not found' });

    const message = rows[0];

    if (message.passcode !== passcode) {
      return res.status(403).json({ error: 'Invalid passcode', verified: false });
    }

    // Mark message as viewed asynchronously
    query('UPDATE messages SET viewed = true WHERE id = $1', [message.id]).catch(err => {
      console.error('Failed to mark message as viewed after passcode verification:', err);
    });

    return res.status(200).json({
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

  } catch (error) {
    console.error('Error verifying passcode:', error);
    return res.status(500).json({ error: 'Failed to verify passcode' });
  }
};

export const recordReaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body; // Added name
    if (!req.file) return res.status(400).json({ error: 'No reaction video provided' });

    const { rows } = await query('SELECT id FROM messages WHERE id = $1 OR shareableLink LIKE $2', [id, `%${id}`]);
    if (!rows.length) return res.status(404).json({ error: 'Message not found' });

    const messageId = rows[0].id;
    const { secure_url: videoUrl, duration: videoDuration } = await uploadVideoToCloudinary(req.file.buffer);
    const thumbnailUrl = videoUrl; // Assuming thumbnail is same as video, or can be derived
    const duration = videoDuration !== null ? Math.round(videoDuration) : 0; // Use dynamic duration, default to 0 if null

    const queryText = `
      INSERT INTO reactions (messageId, videoUrl, thumbnailUrl, duration, createdAt, updatedAt${name ? ', name' : ''})
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

    return res.status(201).json({
      success: true,
      message: 'Reaction recorded successfully',
      reactionId: inserted[0].id
    });

  } catch (error) {
    console.error('Error recording reaction:', error);
    return res.status(500).json({ error: 'Failed to record reaction' });
  }
};

export const recordTextReply = async (req: Request, res: Response) => {
  try {
    const { id: reactionId } = req.params;
    const { text } = req.body;

    if (!text?.trim()) return res.status(400).json({ error: 'Reply text is required' });
    if (text.length > 500) return res.status(400).json({ error: 'Reply text too long' });

    const { rows } = await query('SELECT id FROM reactions WHERE id = $1', [reactionId]);
    if (!rows.length) return res.status(404).json({ error: 'Reaction not found' });

    await query(`INSERT INTO replies (reactionId, text, createdAt, updatedAt) VALUES ($1, $2, NOW(), NOW())`, [reactionId, text.trim()]);

    // Update isreply status of the parent message
    const reactionResult = await query('SELECT messageId FROM reactions WHERE id = $1', [reactionId]);
    if (reactionResult.rows.length > 0) {
      const messageId = reactionResult.rows[0].messageid;
      query('UPDATE messages SET isreply = true WHERE id = $1', [messageId]).catch(err => {
        console.error('Failed to update isreply for message after text reply:', err);
      });
    }

    return res.status(200).json({ success: true, message: 'Reply saved to reaction' });

  } catch (error) {
    console.error('Error recording reply:', error);
    return res.status(500).json({ error: 'Failed to record reply' });
  }
};

export const skipReaction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const shareableLink = `${process.env.FRONTEND_URL}/m/${id}`;
    const { rows } = await query('SELECT * FROM messages WHERE shareableLink = $1', [shareableLink]);

    if (!rows.length) return res.status(404).json({ error: 'Message not found' });

    return res.status(200).json({ success: true, message: 'Reaction skipped' });

  } catch (error) {
    console.error('Error skipping reaction:', error);
    return res.status(500).json({ error: 'Failed to skip reaction' });
  }
};

export const getReactionById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
  
      const { rows } = await query(
        `SELECT id, messageId, videoUrl, thumbnailUrl, duration, name, createdAt
         FROM reactions
         WHERE id = $1`,
        [id]
      );
  
      if (!rows.length) {
        return res.status(404).json({ error: 'Reaction not found' });
      }
  
      const reaction = rows[0];
      return res.status(200).json({
        ...reaction,
        createdAt: new Date(reaction.createdat).toISOString()
      });
    } catch (error) {
      console.error('Error fetching reaction by ID:', error);
      return res.status(500).json({ error: 'Failed to get reaction' });
    }
  };

export const deleteMessageAndReaction = async (req: Request, res: Response) => {
  const { id: paramId } = req.params; // paramId can be message UUID or shareableLink part

  try {
    // 1. Fetch Message and its imageUrl
    // Try finding by direct ID first, then by shareable link part.
    let messageQueryResult = await query('SELECT id, imageUrl FROM messages WHERE id = $1', [paramId]);
    if (messageQueryResult.rows.length === 0) {
      // Try finding by shareable link if not a direct UUID match (or if paramId wasn't a UUID)
      // Constructing the like pattern for shareableLink
      const shareableLinkPattern = `%/${paramId}`;
      messageQueryResult = await query('SELECT id, imageUrl FROM messages WHERE shareableLink LIKE $1', [shareableLinkPattern]);
    }

    if (messageQueryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messageQueryResult.rows[0];
    const messageId = message.id; // Actual UUID of the message
    const messageImageUrl = message.imageurl;

    // 2. Fetch Reactions and their videoUrls
    const reactionsQueryResult = await query('SELECT id, videoUrl FROM reactions WHERE messageId = $1', [messageId]);
    const reactions = reactionsQueryResult.rows; // Array of { id: reactionId, videourl: videoUrl }

    // 3. Database Deletion (Order is Important)
    // For each reaction found, delete its associated replies
    for (const reaction of reactions) {
      if (reaction.id) {
        await query('DELETE FROM replies WHERE reactionId = $1', [reaction.id]);
      }
    }

    // Delete all reactions associated with the messageId
    await query('DELETE FROM reactions WHERE messageId = $1', [messageId]);

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

    return res.status(200).json({ success: true, message: responseMessage });

  } catch (dbError) {
    console.error('Error during database operation in deleteMessageAndReaction:', dbError);
    return res.status(500).json({ error: 'Failed to delete message and associated data due to a server error.' });
  }
};

export const initReaction = async (req: Request, res: Response) => {
  const { messageId } = req.params;
  const { sessionId, name } = req.body; // Added name

  console.log("Received sessionId:", sessionId);
  
  if (!sessionId) return res.status(400).json({ error: 'Missing session ID' });

  try {
    // Verify message exists
    const { rows: messageRows } = await query(
      'SELECT id FROM messages WHERE id = $1',
      [messageId]
    );
    if (!messageRows.length) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check for existing reaction by session
    const { rows: existing } = await query(
      `SELECT id FROM reactions WHERE messageId = $1 AND sessionId = $2`,
      [messageId, sessionId]
    );

    if (existing.length > 0) {
      return res.status(200).json({ reactionId: existing[0].id });
    }

    // Create new reaction
    console.log("About to insert new reaction with values:", { messageId, sessionId, name }); // Added name

    let insertQuery = `
      INSERT INTO reactions (messageId, sessionId, createdAt, updatedAt${name ? ', name' : ''})
      VALUES ($1, $2, NOW(), NOW()${name ? ', $3' : ''}) RETURNING id`;
    
    const queryParams = [messageId, sessionId];
    if (name) {
      queryParams.push(name);
    }

    console.log("Insert query:", insertQuery);

    const { rows: inserted } = await query(insertQuery, queryParams);

    console.log("Reaction inserted with ID:", inserted[0]?.id);

    
    return res.status(201).json({ reactionId: inserted[0].id });

  } catch (error: any) {
    console.error('❌ Error initializing reaction:', {
      message: error.message,
      stack: error.stack,
    });

    return res.status(500).json({ error: 'Failed to initialize reaction' });
  }
};

export const uploadReactionVideo = async (req: Request, res: Response) => {
  const { reactionId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No video file provided' });

  try {
    const { secure_url: videoUrl, duration: videoDuration } = await uploadVideoToCloudinary(req.file.buffer);
    const thumbnailUrl = videoUrl; // Assuming thumbnail is same as video, or can be derived
    const duration = videoDuration !== null ? Math.round(videoDuration) : 0; // Use dynamic duration, default to 0 if null

    await query(
      `UPDATE reactions
       SET videoUrl = $1, thumbnailUrl = $2, duration = $3, updatedAt = NOW()
       WHERE id = $4`,
      [videoUrl, thumbnailUrl, duration, reactionId]
    );

    // Update isreply status of the parent message
    const reactionResult = await query('SELECT messageId FROM reactions WHERE id = $1', [reactionId]);
    if (reactionResult.rows.length > 0) {
      const messageId = reactionResult.rows[0].messageid;
      query('UPDATE messages SET isreply = true WHERE id = $1', [messageId]).catch(err => {
        console.error('Failed to update isreply for message after video upload:', err);
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Video uploaded successfully',
      videoUrl: videoUrl, // ensure videoUrl is passed in response
    });
  } catch (error) {
    console.error('Error uploading reaction video:', error);
    return res.status(500).json({ error: 'Failed to upload reaction video' });
  }
};

export const getReactionsByMessageId = async (req: Request, res: Response) => {
  const { messageId } = req.params;

  try {
    const { rows } = await query(
      `SELECT id, videoUrl, thumbnailUrl, duration, createdAt, updatedAt 
       FROM reactions 
       WHERE messageId = $1 
       ORDER BY createdAt ASC`,
      [messageId]
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching reactions by message ID:', error);
    return res.status(500).json({ error: 'Failed to fetch reactions' });
  }
};
