-- M8: genuine wallet-funded Testnet offers only; NO seeded bids, sales or receipts.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_m8_offer_candidates (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id=18881),
 offer_hash TEXT PRIMARY KEY CHECK (offer_hash ~ '^0x[0-9a-f]{64}$'),
 vault_address TEXT NOT NULL CHECK (vault_address ~ '^0x[0-9a-f]{40}$'),
 buyer_wallet TEXT NOT NULL CHECK (buyer_wallet ~ '^0x[0-9a-f]{40}$'),
 collection_address TEXT NOT NULL CHECK (collection_address ~ '^0x[0-9a-f]{40}$'),
 token_standard TEXT NOT NULL CHECK (token_standard IN ('erc721','erc1155')),
 token_id NUMERIC(78,0) NOT NULL CHECK (token_id>=0),
 quantity NUMERIC(78,0) NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
 total_price_wei NUMERIC(78,0) NOT NULL CHECK (total_price_wei>0 AND total_price_wei<=1000000000000000000000),
 nonce NUMERIC(78,0) NOT NULL CHECK (nonce>=0),
 expires_at TIMESTAMPTZ NOT NULL,
 allowed_seller TEXT CHECK (allowed_seller IS NULL OR allowed_seller ~ '^0x[0-9a-f]{40}$'),
 min_seller_proceeds_wei NUMERIC(78,0) NOT NULL CHECK (min_seller_proceeds_wei>=0),
 max_fee_bps INTEGER NOT NULL CHECK (max_fee_bps BETWEEN 200 AND 10000),
 max_royalty_bps INTEGER NOT NULL CHECK (max_royalty_bps BETWEEN 0 AND 1000),
 signature TEXT NOT NULL CHECK (signature ~ '^0x[0-9a-f]{130}$'),
 funding_tx_hash TEXT NOT NULL CHECK (funding_tx_hash ~ '^0x[0-9a-f]{64}$'),
 funding_block_number BIGINT NOT NULL CHECK (funding_block_number>0),
 funding_block_hash TEXT NOT NULL CHECK (funding_block_hash ~ '^0x[0-9a-f]{64}$'),
 state TEXT NOT NULL DEFAULT 'primary_rpc_funded_unverified'
  CHECK (state IN ('primary_rpc_funded_unverified','independently_funded','accepted_verified','refunded_verified')),
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 independently_checked_at TIMESTAMPTZ,
 CHECK (token_standard <> 'erc721' OR quantity=1),
 CHECK (min_seller_proceeds_wei<=total_price_wei),
 UNIQUE (chain_id,vault_address,buyer_wallet,nonce),
 UNIQUE (chain_id,funding_tx_hash),
 FOREIGN KEY (chain_id,collection_address)
  REFERENCES nft_collections(chain_id,contract_address)
);
CREATE INDEX IF NOT EXISTS nft_m8_offers_owner_idx
 ON nft_m8_offer_candidates(buyer_wallet,first_seen_at DESC);
CREATE INDEX IF NOT EXISTS nft_m8_offers_accept_idx
 ON nft_m8_offer_candidates(state,expires_at DESC);

CREATE TABLE IF NOT EXISTS nft_m8_verified_offer_events (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK (chain_id=18881),
 tx_hash TEXT NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
 log_index INTEGER NOT NULL CHECK(log_index>=0),
 offer_hash TEXT NOT NULL REFERENCES nft_m8_offer_candidates(offer_hash),
 event_kind TEXT NOT NULL CHECK(event_kind IN ('funded','accepted','refunded')),
 block_number BIGINT NOT NULL CHECK(block_number>0),
 block_hash TEXT NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
 buyer_wallet TEXT NOT NULL CHECK (buyer_wallet ~ '^0x[0-9a-f]{40}$'),
 counterparty_wallet TEXT CHECK(counterparty_wallet IS NULL OR counterparty_wallet ~ '^0x[0-9a-f]{40}$'),
 collection_address TEXT NOT NULL CHECK(collection_address ~ '^0x[0-9a-f]{40}$'),
 total_price_wei NUMERIC(78,0) NOT NULL CHECK(total_price_wei>0),
 fee_wei NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(fee_wei>=0),
 royalty_wei NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(royalty_wei>=0),
 seller_proceeds_wei NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(seller_proceeds_wei>=0),
 primary_rpc TEXT NOT NULL CHECK(length(primary_rpc)>15),
 independent_rpc TEXT NOT NULL CHECK(length(independent_rpc)>15),
 explorer_url TEXT NOT NULL CHECK(length(explorer_url)>15),
 checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,tx_hash,log_index),
 UNIQUE(chain_id,offer_hash,event_kind),
 CONSTRAINT m8_full_payout CHECK (
   (event_kind='accepted' AND total_price_wei=fee_wei+royalty_wei+seller_proceeds_wei)
   OR (event_kind<>'accepted' AND fee_wei=0 AND royalty_wei=0 AND seller_proceeds_wei=0)
 )
);
COMMIT;
