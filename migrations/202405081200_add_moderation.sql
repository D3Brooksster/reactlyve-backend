-- Add moderation fields to messages table
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS moderation_details TEXT,
ADD COLUMN IF NOT EXISTS original_imageurl TEXT;

-- Add moderation fields to reactions table
ALTER TABLE reactions
ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS moderation_details TEXT,
ADD COLUMN IF NOT EXISTS original_videourl TEXT;

-- Add indexes for moderation_status to quickly find pending items
CREATE INDEX IF NOT EXISTS idx_messages_moderation_status ON messages(moderation_status);
CREATE INDEX IF NOT EXISTS idx_reactions_moderation_status ON reactions(moderation_status);

-- Add user preferences for moderation
ALTER TABLE users
ADD COLUMN IF NOT EXISTS moderate_images BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS moderate_videos BOOLEAN DEFAULT FALSE;
