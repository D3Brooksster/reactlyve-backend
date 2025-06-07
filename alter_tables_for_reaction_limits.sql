-- Modify 'users' table
ALTER TABLE users
DROP COLUMN IF EXISTS current_reactions_this_month;

ALTER TABLE users
ADD COLUMN reactions_received_this_month INTEGER DEFAULT 0;

-- Modify 'messages' table
ALTER TABLE messages
ADD COLUMN max_reactions_allowed INTEGER DEFAULT NULL;
