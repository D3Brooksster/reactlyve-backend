ALTER TABLE replies
ADD COLUMN IF NOT EXISTS mediaurl TEXT,
ADD COLUMN IF NOT EXISTS mediatype VARCHAR(20),
ADD COLUMN IF NOT EXISTS thumbnailurl TEXT;

CREATE INDEX IF NOT EXISTS idx_replies_mediaurl ON replies(mediaurl);
