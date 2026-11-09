-- Curated LookeNFT: no public self-service creation and no seeded/example NFTs.
BEGIN;
CREATE TABLE IF NOT EXISTS looke_curated_collections (
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
  contract_address TEXT NOT NULL CHECK(contract_address ~ '^0x[0-9a-f]{40}$'),
  operator_wallet TEXT NOT NULL CHECK(operator_wallet ~ '^0x[0-9a-f]{40}$'),
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 2 AND 90),
  description TEXT NOT NULL DEFAULT '' CHECK(char_length(description)<=1200),
  cover_url TEXT,
  mint_phase_id BIGINT NOT NULL DEFAULT 1 CHECK(mint_phase_id BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  mint_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  PRIMARY KEY(chain_id,contract_address),
  FOREIGN KEY(chain_id,contract_address) REFERENCES nft_collections(chain_id,contract_address),
  CHECK(status='published' OR mint_enabled=FALSE)
);
CREATE INDEX IF NOT EXISTS looke_curated_published_idx ON looke_curated_collections(status,published_at DESC);
COMMIT;
