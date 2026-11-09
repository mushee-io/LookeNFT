-- M11: source-authorised integration acceptance and immediate revocation safeguards.
-- Engineering-only schema. No real account, reviewer, identity, NFT or audit seeded.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_m11_social_revocations (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 wallet_address TEXT PRIMARY KEY CHECK(wallet_address ~ '^0x[0-9a-f]{40}$'),
 source_issuer TEXT NOT NULL CHECK(length(source_issuer) BETWEEN 8 AND 256),
 source_jti TEXT NOT NULL UNIQUE CHECK(length(source_jti) BETWEEN 8 AND 256),
 assertion_sha256 TEXT NOT NULL UNIQUE CHECK(assertion_sha256 ~ '^[0-9a-f]{64}$'),
 reason TEXT NOT NULL CHECK(reason IN ('account_suspended','account_deleted','consent_withdrawn','security_hold')),
 source_issued_at TIMESTAMPTZ NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 -- Revocation is monotonic until a separate, independently authorised
 -- human recovery workflow is built: no blind unsuspend endpoint.
 CHECK(source_issued_at<=received_at+interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS nft_m11_revocations_issuer_idx
 ON nft_m11_social_revocations(source_issuer,received_at);

CREATE TABLE IF NOT EXISTS nft_m11_visibility_consumed (
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 source_issuer TEXT NOT NULL CHECK(length(source_issuer) BETWEEN 8 AND 256),
 jti TEXT NOT NULL CHECK(length(jti) BETWEEN 8 AND 256),
 viewer_wallet TEXT NOT NULL CHECK(viewer_wallet ~ '^0x[0-9a-f]{40}$'),
 subject_wallet TEXT NOT NULL CHECK(subject_wallet ~ '^0x[0-9a-f]{40}$'),
 policy_digest TEXT NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 source_issued_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(source_issuer,jti)
);
CREATE INDEX IF NOT EXISTS nft_m11_visibility_recipient_idx
 ON nft_m11_visibility_consumed(viewer_wallet,consumed_at DESC);

CREATE TABLE IF NOT EXISTS nft_m11_evidence_candidates (
 id UUID PRIMARY KEY,
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 gate TEXT NOT NULL CHECK(gate IN(
  'looke_m2_issuer','looke_m10_issuer','social_revocation','blocked_viewer_policy',
  'reown_mobile','reown_desktop','operator_postgres_restore','protected_rollback',
  'cloudinary_delivery','clamav_scan','pinata_cid','human_moderation',
  'approved_nft_registry','independent_rpc','blockscout','cancun_mcopy_push0',
  'contract_security_audit','human_operator_review')),
 source_uri TEXT NOT NULL CHECK(source_uri ~ '^https://' AND length(source_uri)<=1024),
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_format TEXT NOT NULL CHECK(evidence_format IN('source_log','signed_report','rpc_receipt','review_document')),
 submitted_by_wallet TEXT NOT NULL CHECK(submitted_by_wallet ~ '^0x[0-9a-f]{40}$'),
 reviewer_assertion_sha256 TEXT NOT NULL UNIQUE CHECK(reviewer_assertion_sha256 ~ '^[a-f0-9]{64}$'),
 reviewer_jti TEXT NOT NULL UNIQUE CHECK(length(reviewer_jti) BETWEEN 8 AND 256),
 observed_at TIMESTAMPTZ NOT NULL,
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status TEXT NOT NULL DEFAULT 'submitted_unverified'
  CHECK(status = 'submitted_unverified'),
 UNIQUE(chain_id,gate,source_sha256),
 CHECK(observed_at <= submitted_at+interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS nft_m11_evidence_by_gate
 ON nft_m11_evidence_candidates(gate,submitted_at DESC);

CREATE TABLE IF NOT EXISTS nft_m11_media_witness_checks (
 asset_id UUID NOT NULL REFERENCES nft_media_assets(id) ON DELETE RESTRICT,
 owner_wallet TEXT NOT NULL CHECK(owner_wallet ~ '^0x[0-9a-f]{40}$'),
 cloudinary_sha256 TEXT NOT NULL CHECK(cloudinary_sha256 ~ '^[a-f0-9]{64}$'),
 clamav_evidence_sha256 TEXT NOT NULL CHECK(clamav_evidence_sha256 ~ '^[a-f0-9]{64}$'),
 pinata_cid TEXT NOT NULL CHECK(char_length(pinata_cid) BETWEEN 40 AND 100),
 moderator_event_id UUID NOT NULL REFERENCES nft_media_review_events(id) ON DELETE RESTRICT,
 block_number BIGINT CHECK(block_number IS NULL OR block_number>=1),
 witness_status TEXT NOT NULL DEFAULT 'candidate_unverified' CHECK(witness_status='candidate_unverified'),
 observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(asset_id,owner_wallet)
);
CREATE INDEX IF NOT EXISTS nft_m11_media_owner_idx
 ON nft_m11_media_witness_checks(owner_wallet,observed_at DESC);
COMMIT;
