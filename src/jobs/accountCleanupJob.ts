import pool, { query } from '../config/database.config'; // Modified to import pool for transactions
import { AppUser } from '../entity/User';
import { deleteFromCloudinary } from '../utils/cloudinaryUtils';

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

export async function deleteInactiveAccounts(): Promise<void> {
  console.log("Starting inactive account cleanup job...");

  try {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    // For time zone robustness, consider setting to UTC and normalizing, 
    // but for now, this matches typical server environments.
    // To be very precise with "start of day 12 months ago":
    // twelveMonthsAgo.setHours(0, 0, 0, 0);

    console.log(`Calculated date 12 months ago: ${twelveMonthsAgo.toISOString()}`);

    const inactiveUsersResult = await query(
      `SELECT * FROM users 
       WHERE (last_login < $1) 
          OR (last_login IS NULL AND created_at < $1)`,
      [twelveMonthsAgo]
    );

    const inactiveUsers: AppUser[] = inactiveUsersResult.rows;
    console.log(`Found ${inactiveUsers.length} inactive users to process.`);

    if (inactiveUsers.length === 0) {
      console.log("No inactive users to delete.");
      console.log("Inactive account cleanup job completed.");
      return;
    }

    for (const user of inactiveUsers) {
      console.log(`Processing user ID: ${user.id}`);
      const client = await pool.connect(); // Get a client from the pool for transaction

      try {
        await client.query('BEGIN');
        console.log(`Started transaction for user ID: ${user.id}`);

        // 1. Fetch Messages for the user
        const messagesResult = await client.query(
          'SELECT id, imageurl FROM messages WHERE senderid = $1',
          [user.id]
        );
        const messages: Message[] = messagesResult.rows;
        console.log(`Found ${messages.length} messages for user ID: ${user.id}`);

        for (const message of messages) {
          console.log(`Processing message ID: ${message.id} for user ID: ${user.id}`);

          // 2. Fetch Reactions for the message
          const reactionsResult = await client.query(
            'SELECT id, videourl FROM reactions WHERE messageid = $1',
            [message.id]
          );
          const reactions: Reaction[] = reactionsResult.rows;
          console.log(`Found ${reactions.length} reactions for message ID: ${message.id}`);

          for (const reaction of reactions) {
            console.log(`Processing reaction ID: ${reaction.id} for message ID: ${message.id}`);

            // 3. Delete Replies for the reaction
            const deleteRepliesResult = await client.query(
              'DELETE FROM replies WHERE reactionid = $1',
              [reaction.id]
            );
            console.log(`Deleted ${deleteRepliesResult.rowCount} replies for reaction ID: ${reaction.id}`);

            // 4. Delete Reaction from DB
            await client.query('DELETE FROM reactions WHERE id = $1', [reaction.id]);
            console.log(`Deleted reaction ID: ${reaction.id} from DB`);

            // 5. Delete Reaction Video from Cloudinary
            if (reaction.videourl) {
              try {
                console.log(`Deleting video from Cloudinary: ${reaction.videourl} for reaction ID: ${reaction.id}`);
                await deleteFromCloudinary(reaction.videourl);
                console.log(`Successfully deleted video from Cloudinary for reaction ID: ${reaction.id}`);
              } catch (cloudinaryError) {
                console.error(`Failed to delete video from Cloudinary for reaction ID: ${reaction.id}, URL: ${reaction.videourl}. Error:`, cloudinaryError);
                // Continue processing, do not stop the job for Cloudinary errors
              }
            }
          } // End of reactions loop

          // 6. Delete Message from DB
          await client.query('DELETE FROM messages WHERE id = $1', [message.id]);
          console.log(`Deleted message ID: ${message.id} from DB`);

          // 7. Delete Message Image from Cloudinary
          if (message.imageurl) {
            try {
              console.log(`Deleting image from Cloudinary: ${message.imageurl} for message ID: ${message.id}`);
              await deleteFromCloudinary(message.imageurl);
              console.log(`Successfully deleted image from Cloudinary for message ID: ${message.id}`);
            } catch (cloudinaryError) {
              console.error(`Failed to delete image from Cloudinary for message ID: ${message.id}, URL: ${message.imageurl}. Error:`, cloudinaryError);
              // Continue processing
            }
          }
        } // End of messages loop

        // 8. Delete User from DB
        // Before deleting the user, we might also want to delete their profile picture if it's on Cloudinary
        // The AppUser interface has `picture?: string;`
        if (user.picture) {
            try {
                console.log(`Deleting profile picture from Cloudinary: ${user.picture} for user ID: ${user.id}`);
                await deleteFromCloudinary(user.picture);
                console.log(`Successfully deleted profile picture from Cloudinary for user ID: ${user.id}`);
            } catch (cloudinaryError) {
                console.error(`Failed to delete profile picture from Cloudinary for user ID: ${user.id}, URL: ${user.picture}. Error:`, cloudinaryError);
            }
        }
        
        await client.query('DELETE FROM users WHERE id = $1', [user.id]);
        console.log(`Deleted user ID: ${user.id} from DB`);

        await client.query('COMMIT');
        console.log(`Committed transaction for user ID: ${user.id}`);
        console.log(`Successfully deleted user ID: ${user.id} and all their associated data.`);

      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Error processing user ID: ${user.id}. Transaction rolled back. Error:`, error);
        // Continue to the next user, do not let one user's failure stop the whole job.
      } finally {
        client.release();
        console.log(`Released client for user ID: ${user.id}`);
      }
    } // End of users loop

    console.log("Inactive account cleanup job completed successfully.");

  } catch (error) {
    console.error("Fatal error during inactive account cleanup job:", error);
    // If the initial query for users fails, or some other setup error occurs.
  }
}
