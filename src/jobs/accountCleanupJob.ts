import pool, { query } from '../config/database.config'; // Modified to import pool for transactions
import { AppUser } from '../entity/User';
import { deleteFromCloudinary } from '../utils/cloudinaryUtils';
import { log } from '../utils/logger';

interface Message {
  id: string;
  senderid: string;
  imageurl?: string;
  // other message fields if necessary for context, but not strictly for deletion
}

interface Reaction {
  id: string;
  messageid: string;
  videourl?: string;
  // other reaction fields
}

async function processUser(user: AppUser): Promise<void> {
  log(`Processing user ID: ${user.id}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    log(`Started transaction for user ID: ${user.id}`);

    const messagesResult = await client.query(
      'SELECT id, imageurl FROM messages WHERE senderid = $1',
      [user.id]
    );
    const messages: Message[] = messagesResult.rows;
    log(`Found ${messages.length} messages for user ID: ${user.id}`);

    for (const message of messages) {
      log(`Processing message ID: ${message.id} for user ID: ${user.id}`);
      const reactionsResult = await client.query(
        'SELECT id, videourl FROM reactions WHERE messageid = $1',
        [message.id]
      );
      const reactions: Reaction[] = reactionsResult.rows;
      log(`Found ${reactions.length} reactions for message ID: ${message.id}`);

      for (const reaction of reactions) {
        log(`Processing reaction ID: ${reaction.id} for message ID: ${message.id}`);

        const replyMediaRes = await client.query(
          'SELECT mediaurl FROM replies WHERE reactionid = $1 AND mediaurl IS NOT NULL',
          [reaction.id]
        );

        const deleteRepliesResult = await client.query(
          'DELETE FROM replies WHERE reactionid = $1',
          [reaction.id]
        );
        log(`Deleted ${deleteRepliesResult.rowCount} replies for reaction ID: ${reaction.id}`);

        await client.query('DELETE FROM reactions WHERE id = $1', [reaction.id]);
        log(`Deleted reaction ID: ${reaction.id} from DB`);

        if (reaction.videourl) {
          try {
            log(`Deleting video from Cloudinary: ${reaction.videourl} for reaction ID: ${reaction.id}`);
            await deleteFromCloudinary(reaction.videourl);
            log(`Successfully deleted video from Cloudinary for reaction ID: ${reaction.id}`);
          } catch (cloudinaryError) {
            console.error(`Failed to delete video from Cloudinary for reaction ID: ${reaction.id}, URL: ${reaction.videourl}. Error:`, cloudinaryError);
          }
        }

        for (const rm of replyMediaRes.rows as { mediaurl: string }[]) {
          try {
            await deleteFromCloudinary(rm.mediaurl);
          } catch (cloudinaryError) {
            console.error(`Failed to delete reply media ${rm.mediaurl} from Cloudinary for reaction ID: ${reaction.id}. Error:`, cloudinaryError);
          }
        }
      }

      await client.query('DELETE FROM messages WHERE id = $1', [message.id]);
      log(`Deleted message ID: ${message.id} from DB`);

      if (message.imageurl) {
        try {
          log(`Deleting image from Cloudinary: ${message.imageurl} for message ID: ${message.id}`);
          await deleteFromCloudinary(message.imageurl);
          log(`Successfully deleted image from Cloudinary for message ID: ${message.id}`);
        } catch (cloudinaryError) {
          console.error(`Failed to delete image from Cloudinary for message ID: ${message.id}, URL: ${message.imageurl}. Error:`, cloudinaryError);
        }
      }
    }

    if (user.picture) {
      try {
        log(`Deleting profile picture from Cloudinary: ${user.picture} for user ID: ${user.id}`);
        await deleteFromCloudinary(user.picture);
        log(`Successfully deleted profile picture from Cloudinary for user ID: ${user.id}`);
      } catch (cloudinaryError) {
        console.error(`Failed to delete profile picture from Cloudinary for user ID: ${user.id}, URL: ${user.picture}. Error:`, cloudinaryError);
      }
    }

    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    log(`Deleted user ID: ${user.id} from DB`);

    await client.query('COMMIT');
    log(`Committed transaction for user ID: ${user.id}`);
    log(`Successfully deleted user ID: ${user.id} and all their associated data.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error processing user ID: ${user.id}. Transaction rolled back. Error:`, error);
  } finally {
    client.release();
    log(`Released client for user ID: ${user.id}`);
  }
}

export async function deleteInactiveAccounts(): Promise<void> {
  log("Starting inactive account cleanup job...");

  try {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    // For time zone robustness, consider setting to UTC and normalizing, 
    // but for now, this matches typical server environments.
    // To be very precise with "start of day 12 months ago":
    // twelveMonthsAgo.setHours(0, 0, 0, 0);

    log(`Calculated date 12 months ago: ${twelveMonthsAgo.toISOString()}`);

    const inactiveUsersResult = await query(
      `SELECT * FROM users 
       WHERE (last_login < $1) 
          OR (last_login IS NULL AND created_at < $1)`,
      [twelveMonthsAgo]
    );

    const inactiveUsers: AppUser[] = inactiveUsersResult.rows;
    log(`Found ${inactiveUsers.length} inactive users to process.`);

    if (inactiveUsers.length === 0) {
      log("No inactive users to delete.");
      log("Inactive account cleanup job completed.");
      return;
    }

    const BATCH_SIZE = 5;
    for (let i = 0; i < inactiveUsers.length; i += BATCH_SIZE) {
      const batch = inactiveUsers.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(user => processUser(user)));
    }

    log("Inactive account cleanup job completed successfully.");

  } catch (error) {
    console.error("Fatal error during inactive account cleanup job:", error);
    // If the initial query for users fails, or some other setup error occurs.
  }
}
