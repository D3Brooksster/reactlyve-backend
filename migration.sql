-- Add last_login column
ALTER TABLE users ADD COLUMN last_login TIMESTAMP WITH TIME ZONE NULL;

-- Add role column (using VARCHAR)
ALTER TABLE users ADD COLUMN role VARCHAR(10) DEFAULT 'guest';

-- Update existing NULL roles to 'user'
-- This assumes that existing users without a role should be 'user'.
UPDATE users SET role = 'user' WHERE role IS NULL;

-- Optional: If you wanted to use an ENUM type for 'role' in PostgreSQL,
-- you would first create the type and then add the column using that type.
-- Example for PostgreSQL:
-- CREATE TYPE user_role_enum AS ENUM ('guest', 'user', 'admin');
-- ALTER TABLE users ADD COLUMN role user_role_enum DEFAULT 'guest';
-- And the update statement would be similar:
-- UPDATE users SET role = 'user'::user_role_enum WHERE role IS NULL;
