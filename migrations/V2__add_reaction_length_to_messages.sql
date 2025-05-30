-- Add reaction_length column to messages table
ALTER TABLE messages
ADD COLUMN reaction_length INTEGER DEFAULT 15;

-- Optional: Add a check constraint to ensure the value is within the desired range (10-30 seconds).
-- This is database-specific. For PostgreSQL, it would be:
-- ALTER TABLE messages
-- ADD CONSTRAINT check_reaction_length
-- CHECK (reaction_length >= 10 AND reaction_length <= 30);
-- For MySQL, the syntax would be similar.
-- However, primary validation will be handled at the application level.
