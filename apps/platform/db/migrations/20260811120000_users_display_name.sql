-- migrate:up
ALTER TABLE users ADD COLUMN display_name TEXT;
UPDATE users SET display_name = 'Владимир' WHERE display_name IS NULL;

-- migrate:down
ALTER TABLE users DROP COLUMN display_name;
