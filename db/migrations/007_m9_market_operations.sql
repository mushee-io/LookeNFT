-- M9 READ-ONLY Ultra EVM Testnet market operations.
-- Source data ONLY: no sample orders, prices, NFTs, volume or messages.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_m9_market_cursor (
 chain_id INTEGER PRIMARY KEY CHECK (chain_id=18881),
 start_block BIGINT NOT NULL CHECK(start_block>=1),
 last_block BIGINT NOT NULL CHECK(last_block>=0 AND last_block>=start_block-1),
 last_hash TEXT NOT NULL CHECK(last_hash ~ '^0x[0-9a-f]{64}$'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nft_m9_market_blocks (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 block_number BIGINT NOT NULL CHECK(block_number>=0),
 block_hash TEXT NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
 parent_hash TEXT NOT NULL CHECK(parent_hash ~ '^0x[0-9a-f]{64}$'),
 checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,block_number),UNIQUE(chain_id,block_hash)
);
CREATE TABLE IF NOT EXISTS nft_m9_market_events (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 tx_hash TEXT NOT NULL CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),
 log_index INTEGER NOT NULL CHECK(log_index>=0),
 block_number BIGINT NOT NULL CHECK(block_number>=0),
 block_hash TEXT NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
 market_address TEXT NOT NULL CHECK(market_address ~ '^0x[0-9a-f]{40}$'),
 event_kind TEXT NOT NULL CHECK(event_kind IN (
  'listing_filled','offer_funded','offer_accepted','offer_refunded',
  'listing_nonce_cancelled','listing_nonce_floor','offer_nonce_cancelled','offer_nonce_floor')),
 order_hash TEXT CHECK(order_hash IS NULL OR order_hash ~ '^0x[0-9a-f]{64}$'),
 actor_wallet TEXT CHECK(actor_wallet IS NULL OR actor_wallet ~ '^0x[0-9a-f]{40}$'),
 counterparty_wallet TEXT CHECK(counterparty_wallet IS NULL OR counterparty_wallet ~ '^0x[0-9a-f]{40}$'),
 collection_address TEXT CHECK(collection_address IS NULL OR collection_address ~ '^0x[0-9a-f]{40}$'),
 token_id NUMERIC(78,0) CHECK(token_id>=0),
 nonce NUMERIC(78,0) CHECK(nonce>=0),
 quantity NUMERIC(78,0) CHECK(quantity>0),
 total_price_wei NUMERIC(78,0) CHECK(total_price_wei>=0),
 observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,tx_hash,log_index),
 FOREIGN KEY (chain_id,block_number) REFERENCES nft_m9_market_blocks(chain_id,block_number) ON DELETE CASCADE,
 CONSTRAINT m9_trade_value CHECK(event_kind NOT IN ('listing_filled','offer_accepted')
  OR (total_price_wei>0 AND collection_address IS NOT NULL AND order_hash IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS nft_m9_events_wallet_idx
 ON nft_m9_market_events(chain_id,actor_wallet,block_number DESC);
CREATE INDEX IF NOT EXISTS nft_m9_events_contract_idx
 ON nft_m9_market_events(chain_id,collection_address,block_number DESC);
CREATE INDEX IF NOT EXISTS nft_m9_events_order_idx
 ON nft_m9_market_events(chain_id,order_hash);

-- Historical independent attestations MUST NOT be automatically erased or
-- silently treated as canonical when a reorg is discovered.
CREATE TABLE IF NOT EXISTS nft_m9_quarantined_evidence (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 source_kind TEXT NOT NULL CHECK(source_kind IN('m7_sale','m8_offer')),
 tx_hash TEXT NOT NULL CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),
 log_index INTEGER NOT NULL CHECK(log_index>=0),
 orphaned_block BIGINT NOT NULL CHECK(orphaned_block>=0),
 orphaned_hash TEXT NOT NULL CHECK(orphaned_hash ~ '^0x[0-9a-f]{64}$'),
 reason TEXT NOT NULL DEFAULT 'canonical_block_reorg',
 quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,source_kind,tx_hash,log_index)
);

-- Wallet-private, immutable-by-policy independently witnessed notification
-- entries. On a reorg, orphaned notifications are withdrawn in the same DB txn.
CREATE TABLE IF NOT EXISTS nft_m9_notifications (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 recipient_wallet TEXT NOT NULL CHECK(recipient_wallet ~ '^0x[0-9a-f]{40}$'),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('m7_sale','m8_offer')),
 tx_hash TEXT NOT NULL CHECK(tx_hash ~ '^0x[0-9a-f]{64}$'),
 log_index INTEGER NOT NULL CHECK(log_index>=0),
 event_kind TEXT NOT NULL CHECK(event_kind IN('sale','offer_accepted','offer_refunded','offer_funded')),
 block_number BIGINT NOT NULL CHECK(block_number>=0),
 block_hash TEXT NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,recipient_wallet,source_kind,tx_hash,log_index,event_kind),
 FOREIGN KEY(chain_id,block_number) REFERENCES nft_m9_market_blocks(chain_id,block_number) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS nft_m9_private_notification_idx
 ON nft_m9_notifications(recipient_wallet,created_at DESC);

-- Checkpointed read-only snapshots of seller/buyer order candidates. These
-- are NOT active sale approvals; validity can change immediately after checking.
CREATE TABLE IF NOT EXISTS nft_m9_order_checks (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 source_kind TEXT NOT NULL CHECK(source_kind IN('m7_listing','m8_offer')),
 order_hash TEXT NOT NULL CHECK(order_hash ~ '^0x[0-9a-f]{64}$'),
 block_number BIGINT NOT NULL CHECK(block_number>=0),
 block_hash TEXT NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
 fillable_snapshot BOOLEAN NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 4 AND 180),
 checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,source_kind,order_hash),
 FOREIGN KEY(chain_id,block_number) REFERENCES nft_m9_market_blocks(chain_id,block_number) ON DELETE CASCADE
);
-- Server-side per-authenticated-wallet rate limiting; no spoofable IP trust.
CREATE TABLE IF NOT EXISTS nft_m9_request_buckets (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 wallet_address TEXT NOT NULL CHECK(wallet_address ~ '^0x[0-9a-f]{40}$'),
 route TEXT NOT NULL CHECK(route IN('overview','orderbook','notifications','quote')),
 bucket_start TIMESTAMPTZ NOT NULL,
 hits INTEGER NOT NULL DEFAULT 1 CHECK(hits BETWEEN 1 AND 1000),
 PRIMARY KEY(chain_id,wallet_address,route,bucket_start)
);
CREATE INDEX IF NOT EXISTS nft_m9_rate_cleanup_idx
 ON nft_m9_request_buckets(bucket_start);
COMMIT;
