-- migrate:up
CREATE TABLE oauth_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('yandex', 'vk')),
  provider_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX oauth_accounts_provider_provider_user_id_idx
  ON oauth_accounts (provider, provider_user_id);
CREATE UNIQUE INDEX oauth_accounts_user_id_provider_idx
  ON oauth_accounts (user_id, provider);
CREATE INDEX oauth_accounts_user_id_idx ON oauth_accounts (user_id);

-- migrate:down
DROP TABLE oauth_accounts;
