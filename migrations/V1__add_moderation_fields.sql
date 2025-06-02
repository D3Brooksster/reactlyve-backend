-- Add moderation fields to messages table
ALTER TABLE messages
ADD COLUMN moderation_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN moderation_details TEXT,
ADD COLUMN original_imageurl TEXT;

-- Add moderation fields to reactions table
ALTER TABLE reactions
ADD COLUMN moderation_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN moderation_details TEXT,
ADD COLUMN original_videourl TEXT;

-- Add indexes for moderation_status to quickly find pending items
CREATE INDEX IF NOT EXISTS idx_messages_moderation_status ON messages(moderation_status);
CREATE INDEX IF NOT EXISTS idx_reactions_moderation_status ON reactions(moderation_status);
