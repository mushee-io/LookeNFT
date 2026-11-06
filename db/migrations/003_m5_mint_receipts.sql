-- M5 evidence ledger: only independently reconciled real Ultra EVM Testnet mints
-- may be inserted by an explicitly authorised operator verifier. No seeded NFTs.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_mint_verified_receipts (
  chain_id INTEGER NOT NULL CHECK (chain_id = 18881),
  tx_hash TEXT NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  block_number BIGINT NOT NULL CHECK (block_number >= 1),
  block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  factory_address TEXT NOT NULL CHECK (factory_address ~ '^0x[0-9a-f]{40}$'),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  minter_address TEXT NOT NULL CHECK (minter_address ~ '^0x[0-9a-f]{40}$'),
  token_standard TEXT NOT NULL CHECK (token_standard IN ('erc721', 'erc1155')),
  phase_id NUMERIC(78,0) NOT NULL CHECK (phase_id > 0),
  mint_nonce NUMERIC(78,0) NOT NULL CHECK (mint_nonce >= 0),
  token_id NUMERIC(78,0) NOT NULL CHECK (token_id >= 0),
  quantity NUMERIC(78,0) NOT NULL CHECK (quantity > 0 AND quantity <= 1000),
  payment_wei NUMERIC(78,0) NOT NULL CHECK (payment_wei >= 0),
  refund_wei NUMERIC(78,0) NOT NULL CHECK (refund_wei >= 0),
  primary_rpc TEXT NOT NULL CHECK (length(primary_rpc) BETWEEN 12 AND 1024),
  independent_rpc TEXT NOT NULL CHECK (length(independent_rpc) BETWEEN 12 AND 1024),
  explorer_tx_url TEXT NOT NULL CHECK (length(explorer_tx_url) BETWEEN 12 AND 1024),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index),
  UNIQUE (chain_id, collection_address, minter_address, phase_id, mint_nonce)
);
CREATE INDEX IF NOT EXISTS nft_m5_verified_minter_idx
  ON nft_mint_verified_receipts(chain_id, minter_address, checked_at DESC);
COMMIT;
