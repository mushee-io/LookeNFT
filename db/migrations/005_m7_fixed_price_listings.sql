-- M7 Testnet-only signed listing candidates. No seeded orders or fake settlement activity.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_m7_signed_listings (
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id=18881),
  order_hash TEXT PRIMARY KEY CHECK (order_hash ~ '^0x[0-9a-f]{64}$'),
  marketplace TEXT NOT NULL CHECK (marketplace ~ '^0x[0-9a-f]{40}$'),
  seller_wallet TEXT NOT NULL CHECK (seller_wallet ~ '^0x[0-9a-f]{40}$'),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  token_standard TEXT NOT NULL CHECK (token_standard IN ('erc721','erc1155')),
  token_id NUMERIC(78,0) NOT NULL CHECK (token_id>=0),
  quantity NUMERIC(78,0) NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price_wei NUMERIC(78,0) NOT NULL CHECK (unit_price_wei>0),
  nonce NUMERIC(78,0) NOT NULL CHECK (nonce>=0),
  deadline TIMESTAMPTZ NOT NULL,
  reserved_buyer TEXT CHECK (reserved_buyer IS NULL OR reserved_buyer ~ '^0x[0-9a-f]{40}$'),
  min_proceeds_wei NUMERIC(78,0) NOT NULL CHECK (min_proceeds_wei>=0),
  max_fee_bps INTEGER NOT NULL CHECK (max_fee_bps BETWEEN 200 AND 10000),
  max_royalty_bps INTEGER NOT NULL CHECK (max_royalty_bps BETWEEN 0 AND 1000),
  signature TEXT NOT NULL CHECK (signature ~ '^0x[0-9a-f]{130}$'),
  state TEXT NOT NULL DEFAULT 'unverified_candidate'
    CHECK (state IN ('unverified_candidate','cancelled_verified','filled_verified')),
  last_rpc_checked_at TIMESTAMPTZ,
  last_rpc_fillable BOOLEAN,
  last_rpc_block BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id,marketplace,seller_wallet,nonce),
  CONSTRAINT m7_erc721_single CHECK (token_standard<>'erc721' OR quantity=1),
  CONSTRAINT m7_price_bound CHECK (unit_price_wei*quantity <= 1000000000000000000000),
  FOREIGN KEY (chain_id,collection_address)
    REFERENCES nft_collections(chain_id,contract_address)
);
CREATE INDEX IF NOT EXISTS nft_m7_active_seller_idx
  ON nft_m7_signed_listings(chain_id,seller_wallet,created_at DESC);
CREATE INDEX IF NOT EXISTS nft_m7_market_idx
  ON nft_m7_signed_listings(chain_id,state,deadline DESC);

CREATE TABLE IF NOT EXISTS nft_m7_verified_settlements (
  chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id=18881),
  tx_hash TEXT NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index INTEGER NOT NULL CHECK (log_index >=0),
  order_hash TEXT NOT NULL REFERENCES nft_m7_signed_listings(order_hash),
  block_number BIGINT NOT NULL CHECK (block_number>0),
  block_hash TEXT NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  seller_wallet TEXT NOT NULL CHECK (seller_wallet ~ '^0x[0-9a-f]{40}$'),
  buyer_wallet TEXT NOT NULL CHECK (buyer_wallet ~ '^0x[0-9a-f]{40}$'),
  collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
  token_id NUMERIC(78,0) NOT NULL CHECK (token_id>=0),
  quantity NUMERIC(78,0) NOT NULL CHECK (quantity>=1),
  price_wei NUMERIC(78,0) NOT NULL CHECK (price_wei>0),
  fee_wei NUMERIC(78,0) NOT NULL CHECK (fee_wei>=0),
  royalty_wei NUMERIC(78,0) NOT NULL CHECK (royalty_wei>=0),
  seller_proceeds_wei NUMERIC(78,0) NOT NULL CHECK (seller_proceeds_wei>=0),
  royalty_recipient TEXT CHECK (royalty_recipient IS NULL OR royalty_recipient ~ '^0x[0-9a-f]{40}$'),
  primary_rpc TEXT NOT NULL CHECK (length(primary_rpc) BETWEEN 15 AND 1024),
  independent_rpc TEXT NOT NULL CHECK (length(independent_rpc) BETWEEN 15 AND 1024),
  explorer_tx_url TEXT NOT NULL CHECK (length(explorer_tx_url) BETWEEN 15 AND 1024),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,tx_hash,log_index),
  UNIQUE (chain_id,order_hash),
  CONSTRAINT m7_exact_value_split CHECK (price_wei=fee_wei+royalty_wei+seller_proceeds_wei)
);
COMMIT;
