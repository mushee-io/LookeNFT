-- Creator-controlled, reversible Testnet catalogue cleanup. Never delete chain history.
BEGIN;
ALTER TABLE looke_curated_collections
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS looke_curated_unarchived_idx
  ON looke_curated_collections(status,published_at DESC) WHERE archived_at IS NULL;
CREATE TABLE IF NOT EXISTS looke_hidden_testnet_tokens (
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
  contract_address TEXT NOT NULL CHECK(contract_address ~ '^0x[0-9a-f]{40}$'),
  token_id NUMERIC(78,0) NOT NULL CHECK(token_id>=0),
  hidden_by TEXT NOT NULL CHECK(hidden_by ~ '^0x[0-9a-f]{40}$'),
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,contract_address,token_id),
  FOREIGN KEY(chain_id,contract_address) REFERENCES nft_collections(chain_id,contract_address)
);
COMMIT;
