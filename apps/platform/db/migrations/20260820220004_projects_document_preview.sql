-- migrate:up
ALTER TABLE projects ADD COLUMN document JSONB;
ALTER TABLE projects ADD COLUMN preview TEXT;

-- migrate:down
ALTER TABLE projects DROP COLUMN preview;
ALTER TABLE projects DROP COLUMN document;
