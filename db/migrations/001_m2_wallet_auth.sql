-- Ultra EVM wallet auth. Apply with psql using a dedicated role and DATABASE_URL.
-- No private keys or raw session tokens are persisted.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_auth_challenges (
  nonce_hash TEXT PRIMARY KEY CHECK (length(nonce_hash) = 64),
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id INTEGER NOT NULL CHECK (chain_id IN (18881, 19991)),
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS nft_auth_challenges_address_idx
ON nft_auth_challenges (wallet_address, issued_at DESC);

CREATE TABLE IF NOT EXISTS nft_wallet_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id INTEGER NOT NULL CHECK (chain_id IN (18881, 19991)),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS nft_wallet_sessions_wallet_idx
ON nft_wallet_sessions (wallet_address, expires_at DESC);

CREATE TABLE IF NOT EXISTS nft_profile_links (
  wallet_address TEXT PRIMARY KEY CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  profile_id TEXT NOT NULL UNIQUE CHECK (length(profile_id) BETWEEN 1 AND 128),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nft_identity_jtis (
  jti TEXT PRIMARY KEY CHECK (length(jti) BETWEEN 8 AND 256),
  wallet_address TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
