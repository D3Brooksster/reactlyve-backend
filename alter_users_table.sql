ALTER TABLE users ADD COLUMN max_messages_per_month INTEGER;
ALTER TABLE users ADD COLUMN max_reactions_per_month INTEGER;
ALTER TABLE users ADD COLUMN current_messages_this_month INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN current_reactions_this_month INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN last_usage_reset_date TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN max_reactions_per_message INTEGER;

-- New columns for reaction author limits
ALTER TABLE users ADD COLUMN max_reactions_authored_per_month INTEGER;
ALTER TABLE users ADD COLUMN reactions_authored_this_month INTEGER DEFAULT 0;
