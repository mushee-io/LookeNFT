-- M3 read-only Ultra EVM Testnet indexer. No seeded collections or synthetic market data.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_collections (
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id = 18881),
  contract_address TEXT NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
  token_standard TEXT NOT NULL CHECK (token_standard IN ('erc721', 'erc1155')),
  deployment_block BIGINT NOT NULL CHECK (deployment_block >= 1),
  code_hash TEXT NOT NULL CHECK (code_hash ~ '^0x[0-9a-f]{64}$'),
  checked_block BIGINT NOT NULL CHECK (checked_block >= deployment_block),
  source_verified BOOLEAN NOT NULL DEFAULT FALSE,
  operator_evidence TEXT NOT NULL CHECK (length(operator_evidence) BETWEEN 12 AND 1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract_address)
);

CREATE TABLE IF NOT EXISTS nft_indexer_state (
  chain_id INTEGER PRIMARY KEY CHECK (chain_id = 18881),
  start_block BIGINT NOT NULL CHECK (start_block >= 1),
  last_block BIGINT NOT NULL CHECK (last_block >= 0),
  last_hash TEXT NOT NULL CHECK (last_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (last_block >= start_block - 1)
);
CREATE TABLE IF NOT EXISTS nft_indexer_blocks (
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id = 18881),
  block_number BIGINT NOT NULL CHECK (block_number >= 0),
  block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  parent_hash TEXT NOT NULL CHECK (parent_hash ~ '^0x[0-9a-f]{64}$'),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_number),
  UNIQUE (chain_id, block_hash)
);
CREATE TABLE IF NOT EXISTS nft_token_transfers (
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id = 18881),
  contract_address TEXT NOT NULL CHECK (contract_address ~ '^0x[0-9a-f]{40}$'),
  token_standard TEXT NOT NULL CHECK (token_standard IN ('erc721', 'erc1155')),
  block_number BIGINT NOT NULL CHECK (block_number >= 0),
  block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  tx_hash TEXT NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  tx_index INTEGER NOT NULL CHECK (tx_index >= 0),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  item_index INTEGER NOT NULL CHECK (item_index >= 0),
  token_id NUMERIC(78,0) NOT NULL CHECK (token_id >= 0),
  from_address TEXT NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
  to_address TEXT NOT NULL CHECK (to_address ~ '^0x[0-9a-f]{40}$'),
  amount NUMERIC(78,0) NOT NULL CHECK (amount >= 0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index, item_index),
  FOREIGN KEY (chain_id, contract_address) REFERENCES nft_collections (chain_id, contract_address),
  FOREIGN KEY (chain_id, block_number) REFERENCES nft_indexer_blocks (chain_id, block_number) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS nft_transfers_contract_token_idx
  ON nft_token_transfers (chain_id, contract_address, token_id, block_number DESC, tx_index DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS nft_transfers_holder_idx
  ON nft_token_transfers (chain_id, to_address, contract_address);
CREATE INDEX IF NOT EXISTS nft_transfers_sender_idx
  ON nft_token_transfers (chain_id, from_address, contract_address);
CREATE INDEX IF NOT EXISTS nft_transfers_block_idx
  ON nft_token_transfers (chain_id, block_number);
COMMIT;
