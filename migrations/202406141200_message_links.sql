CREATE TABLE IF NOT EXISTS message_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    link_id VARCHAR(32) UNIQUE NOT NULL,
    passcode TEXT,
    onetime BOOLEAN DEFAULT FALSE,
    viewed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_links_message_id ON message_links(message_id);
