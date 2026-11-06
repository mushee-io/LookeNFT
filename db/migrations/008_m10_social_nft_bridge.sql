-- M10 Looke Social signed-source bridge. NO seeded profiles, posts, followers, NFTs, shares or sales.
-- Fail-closed: only operator-configured EdDSA issuer and source-backed chain proof can write.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_m10_social_profiles (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 wallet_address TEXT PRIMARY KEY CHECK(wallet_address ~ '^0x[0-9a-f]{40}$'),
 profile_id TEXT NOT NULL UNIQUE CHECK(length(profile_id) BETWEEN 1 AND 128),
 handle TEXT NOT NULL CHECK(handle ~ '^[a-z][a-z0-9_]{2,23}$'),
 display_name TEXT NOT NULL CHECK(char_length(display_name) BETWEEN 1 AND 60),
 bio TEXT NOT NULL DEFAULT '' CHECK(char_length(bio)<=240),
 source_commit_sha TEXT NOT NULL CHECK(source_commit_sha ~ '^[0-9a-f]{40}$'),
 source_issuer TEXT NOT NULL CHECK(length(source_issuer) BETWEEN 8 AND 256),
 assertion_sha256 TEXT NOT NULL UNIQUE CHECK(assertion_sha256 ~ '^[a-f0-9]{64}$'),
 source_jti TEXT NOT NULL UNIQUE CHECK(length(source_jti) BETWEEN 8 AND 256),
 issued_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 public_approved BOOLEAN NOT NULL DEFAULT FALSE,
 suspended BOOLEAN NOT NULL DEFAULT FALSE,
 source_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(wallet_address) REFERENCES nft_profile_links(wallet_address) ON DELETE CASCADE,
 CONSTRAINT m10_fresh_snapshot CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS nft_m10_public_creator_idx
 ON nft_m10_social_profiles(handle,expires_at) WHERE public_approved=true AND suspended=false;

CREATE TABLE IF NOT EXISTS nft_m10_visible_posts (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 post_id UUID PRIMARY KEY,
 wallet_address TEXT NOT NULL REFERENCES nft_m10_social_profiles(wallet_address) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),
 created_at TIMESTAMPTZ NOT NULL,
 source_jti TEXT NOT NULL CHECK(length(source_jti) BETWEEN 8 AND 256),
 media_kind TEXT CHECK(media_kind IN ('image','video')),
 approved_media_url TEXT CHECK(approved_media_url IS NULL OR (approved_media_url ~ '^https://' AND char_length(approved_media_url)<=500)),
 CHECK ((approved_media_url IS NULL) = (media_kind IS NULL))
);
CREATE INDEX IF NOT EXISTS nft_m10_visible_posts_owner_idx
 ON nft_m10_visible_posts(wallet_address,created_at DESC);

CREATE TABLE IF NOT EXISTS nft_m10_verified_nft_avatars (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 owner_wallet TEXT PRIMARY KEY REFERENCES nft_m10_social_profiles(wallet_address) ON DELETE CASCADE,
 collection_address TEXT NOT NULL CHECK(collection_address ~ '^0x[0-9a-f]{40}$'),
 token_standard TEXT NOT NULL CHECK(token_standard IN('erc721','erc1155')),
 token_id NUMERIC(78,0) NOT NULL CHECK(token_id>=0),
 verified_balance NUMERIC(78,0) NOT NULL CHECK(verified_balance>=1),
 block_number BIGINT NOT NULL CHECK(block_number>=1),
 block_hash TEXT NOT NULL CHECK(block_hash ~ '^0x[0-9a-f]{64}$'),
 contract_code_hash TEXT NOT NULL CHECK(contract_code_hash ~ '^0x[0-9a-f]{64}$'),
 primary_rpc TEXT NOT NULL CHECK(primary_rpc ~ '^https://' AND char_length(primary_rpc)<=1024),
 independent_rpc TEXT NOT NULL CHECK(independent_rpc ~ '^https://' AND char_length(independent_rpc)<=1024),
 explorer_block_url TEXT NOT NULL CHECK(explorer_block_url ~ '^https://' AND char_length(explorer_block_url)<=1024),
 verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 FOREIGN KEY (chain_id,collection_address) REFERENCES nft_collections(chain_id,contract_address),
 CONSTRAINT m10_avatar_ttl CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS nft_m10_avatar_collection_idx
 ON nft_m10_verified_nft_avatars(collection_address,token_id);

-- Not social posts or platform creator attestations. Just user-chosen,
-- independently verified NFT-holder collection deep links.
CREATE TABLE IF NOT EXISTS nft_m10_holder_collection_links (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 wallet_address TEXT NOT NULL REFERENCES nft_m10_social_profiles(wallet_address) ON DELETE CASCADE,
 collection_address TEXT NOT NULL CHECK(collection_address ~ '^0x[0-9a-f]{40}$'),
 token_id NUMERIC(78,0) NOT NULL CHECK(token_id>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,wallet_address,collection_address),
 FOREIGN KEY (chain_id,collection_address) REFERENCES nft_collections(chain_id,contract_address),
 FOREIGN KEY(wallet_address) REFERENCES nft_m10_verified_nft_avatars(owner_wallet) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS nft_m10_link_collection_idx ON nft_m10_holder_collection_links(collection_address);

-- Genuine issuer JWT replay protection; source token is NEVER persisted.
CREATE TABLE IF NOT EXISTS nft_m10_assertion_jtis (
 source_issuer TEXT NOT NULL CHECK(length(source_issuer) BETWEEN 8 AND 256),
 jti TEXT NOT NULL CHECK(length(jti) BETWEEN 8 AND 256),
 wallet_address TEXT NOT NULL CHECK(wallet_address ~ '^0x[0-9a-f]{40}$'),
 consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(source_issuer,jti)
);
CREATE TABLE IF NOT EXISTS nft_m10_request_buckets (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 wallet_address TEXT NOT NULL CHECK(wallet_address ~ '^0x[0-9a-f]{40}$'),
 action TEXT NOT NULL CHECK(action IN('read','sync','avatar','directory')),
 bucket_start TIMESTAMPTZ NOT NULL,
 hits INTEGER NOT NULL DEFAULT 1 CHECK(hits BETWEEN 1 AND 1000),
 PRIMARY KEY(chain_id,wallet_address,action,bucket_start)
);
CREATE INDEX IF NOT EXISTS nft_m10_rate_cleanup_idx ON nft_m10_request_buckets(bucket_start);
COMMIT;
