-- M6: private creator-media inventory and append-only moderation evidence.
-- No seeded creator records or invented on-chain media.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_media_assets (
  id UUID PRIMARY KEY,
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id = 18881),
  owner_wallet TEXT NOT NULL CHECK (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  state TEXT NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','scan_failed','upload_failed','needs_moderation','approved','rejected')),
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image','video')),
  mime_type TEXT NOT NULL
    CHECK (mime_type IN ('image/png','image/jpeg','image/webp','video/mp4','video/webm')),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 10485760),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_provider TEXT NOT NULL DEFAULT 'cloudinary' CHECK (storage_provider = 'cloudinary'),
  storage_delivery TEXT NOT NULL DEFAULT 'authenticated' CHECK (storage_delivery = 'authenticated'),
  provider_asset_id TEXT UNIQUE,
  provider_public_id TEXT UNIQUE,
  provider_version BIGINT CHECK (provider_version IS NULL OR provider_version > 0),
  pin_state TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (pin_state IN ('not_requested','in_progress','failed','verified')),
  media_ipfs_cid TEXT CHECK (media_ipfs_cid IS NULL OR char_length(media_ipfs_cid) BETWEEN 40 AND 100),
  ipfs_pinned_at TIMESTAMPTZ,
  ipfs_verified_at TIMESTAMPTZ,
  CONSTRAINT verified_ipfs_has_witness CHECK (
    pin_state <> 'verified' OR (state = 'approved' AND media_ipfs_cid IS NOT NULL
      AND ipfs_verified_at IS NOT NULL AND ipfs_pinned_at IS NOT NULL)
  ),
  scan_engine TEXT,
  scan_result TEXT CHECK (scan_result IN ('clean','infected','error','unavailable')),
  scan_checked_at TIMESTAMPTZ,
  scan_evidence_sha256 TEXT CHECK (scan_evidence_sha256 IS NULL OR scan_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  reviewer_wallet TEXT CHECK (reviewer_wallet IS NULL OR reviewer_wallet ~ '^0x[0-9a-f]{40}$'),
  reviewer_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approved_needs_host_and_clean_scan CHECK (
    state <> 'approved' OR (scan_result = 'clean' AND provider_asset_id IS NOT NULL
      AND provider_public_id IS NOT NULL AND reviewer_wallet IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS nft_m6_media_owner_idx ON nft_media_assets(owner_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS nft_m6_media_queue_idx ON nft_media_assets(state, created_at ASC);

CREATE TABLE IF NOT EXISTS nft_media_review_events (
  id UUID PRIMARY KEY,
  media_id UUID NOT NULL REFERENCES nft_media_assets(id) ON DELETE RESTRICT,
  reviewer_wallet TEXT NOT NULL CHECK (reviewer_wallet ~ '^0x[0-9a-f]{40}$'),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nft_m6_review_history_idx ON nft_media_review_events(media_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS nft_media_metadata_versions (
  id UUID PRIMARY KEY,
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id = 18881),
  owner_wallet TEXT NOT NULL CHECK (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  token_standard TEXT NOT NULL CHECK (token_standard IN ('erc721','erc1155')),
  token_id NUMERIC(78,0) NOT NULL CHECK (token_id >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  asset_id UUID NOT NULL REFERENCES nft_media_assets(id) ON DELETE RESTRICT,
  metadata JSONB NOT NULL,
  metadata_sha256 TEXT NOT NULL CHECK (metadata_sha256 ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','pinning','pinned','chain_matched')),
  ipfs_cid TEXT,
  pinned_at TIMESTAMPTZ,
  chain_uri TEXT,
  chain_checked_block BIGINT,
  chain_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, owner_wallet, collection_address, token_id, version),
  CONSTRAINT pinned_media_has_cid CHECK (state IN ('draft','pinning') OR (ipfs_cid IS NOT NULL AND pinned_at IS NOT NULL)),
  CONSTRAINT matched_media_has_chain_evidence CHECK (state <> 'chain_matched' OR
    (chain_uri IS NOT NULL AND chain_checked_block IS NOT NULL AND chain_checked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS nft_m6_metadata_owner_idx ON nft_media_metadata_versions(owner_wallet, created_at DESC);
COMMIT;
