-- Add columns for additional OAuth providers
ALTER TABLE users
ADD COLUMN IF NOT EXISTS microsoft_id TEXT,
ADD COLUMN IF NOT EXISTS facebook_id TEXT,
ADD COLUMN IF NOT EXISTS twitter_id TEXT;

-- Indexes for quick lookup on provider ids
CREATE INDEX IF NOT EXISTS idx_users_microsoft_id ON users(microsoft_id);
CREATE INDEX IF NOT EXISTS idx_users_facebook_id ON users(facebook_id);
CREATE INDEX IF NOT EXISTS idx_users_twitter_id ON users(twitter_id);
