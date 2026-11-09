-- M12 FINAL Testnet acceptance. Immutable engineering NO-GO; never self-approve.
-- NO fabricated reviewer signatures, wallet activity, deployments or source evidence.
BEGIN;
CREATE TABLE IF NOT EXISTS nft_m12_final_reviews (
 id UUID PRIMARY KEY,
 chain_id INTEGER NOT NULL DEFAULT 18881 CHECK(chain_id=18881),
 source_commit TEXT NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),
 operator_wallet TEXT NOT NULL CHECK(operator_wallet ~ '^0x[0-9a-f]{40}$'),
 evidence_bundle_sha256 TEXT NOT NULL CHECK(evidence_bundle_sha256 ~ '^[0-9a-f]{64}$'),
 decision TEXT NOT NULL CHECK(decision='NO_GO'),
 review_kind TEXT NOT NULL CHECK(review_kind IN ('operator_unverified','ci_synthetic')),
 reason TEXT NOT NULL CHECK(char_length(reason) BETWEEN 12 AND 600),
 human_release_approved BOOLEAN NOT NULL DEFAULT false CHECK(human_release_approved=false),
 independent_source_approved BOOLEAN NOT NULL DEFAULT false CHECK(independent_source_approved=false),
 execution_authorised BOOLEAN NOT NULL DEFAULT false CHECK(execution_authorised=false),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(source_commit,operator_wallet,evidence_bundle_sha256)
);
CREATE INDEX IF NOT EXISTS nft_m12_final_reviews_recent_idx
 ON nft_m12_final_reviews(created_at DESC);

CREATE TABLE IF NOT EXISTS nft_m12_gate_observations (
 review_id UUID NOT NULL REFERENCES nft_m12_final_reviews(id) ON DELETE RESTRICT,
 gate TEXT NOT NULL CHECK(gate IN(
  'looke_m2_issuer','looke_m10_issuer','social_revocation','blocked_viewer_policy',
  'reown_mobile','reown_desktop','operator_postgres_restore','protected_rollback',
  'cloudinary_delivery','clamav_scan','pinata_cid','human_moderation',
  'approved_nft_registry','independent_rpc','blockscout','cancun_mcopy_push0',
  'contract_security_audit','human_operator_review')),
 observed_state TEXT NOT NULL CHECK(observed_state IN('blocked','candidate_unverified','source_unavailable')),
 blocker TEXT NOT NULL CHECK(char_length(blocker) BETWEEN 12 AND 500),
 source_sha256 TEXT CHECK(source_sha256 IS NULL OR source_sha256 ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(review_id,gate)
);
CREATE INDEX IF NOT EXISTS nft_m12_gate_state_idx
 ON nft_m12_gate_observations(gate,observed_state);

-- Human-reviewed signed attestations are audit inputs only. They are not
-- immutable proof that a security audit actually happened, and cannot set GO.
CREATE TABLE IF NOT EXISTS nft_m12_human_attestation_candidates (
 id UUID PRIMARY KEY,
 review_id UUID NOT NULL REFERENCES nft_m12_final_reviews(id) ON DELETE RESTRICT,
 role TEXT NOT NULL CHECK(role IN('security_reviewer','release_operator')),
 reviewer_wallet TEXT NOT NULL CHECK(reviewer_wallet ~ '^0x[0-9a-f]{40}$'),
 issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 12 AND 256 AND issuer LIKE 'https://%'),
 key_id TEXT NOT NULL CHECK(length(key_id) BETWEEN 8 AND 128),
 jti TEXT NOT NULL CHECK(length(jti) BETWEEN 8 AND 256),
 signature_sha256 TEXT NOT NULL CHECK(signature_sha256 ~ '^[a-f0-9]{64}$'),
 attested_bundle_sha256 TEXT NOT NULL CHECK(attested_bundle_sha256 ~ '^[a-f0-9]{64}$'),
 claimed_decision TEXT NOT NULL CHECK(claimed_decision IN('NO_GO','GO_PROPOSAL_UNVERIFIED')),
 verification_status TEXT NOT NULL DEFAULT 'signature_valid_source_unverified'
  CHECK(verification_status='signature_valid_source_unverified'),
 observed_at TIMESTAMPTZ NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(issuer,key_id,jti),
 UNIQUE(signature_sha256),
 UNIQUE(review_id,role,reviewer_wallet),
 CHECK(observed_at<=received_at+interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS nft_m12_attestations_review_idx
 ON nft_m12_human_attestation_candidates(review_id,role);

-- CI can test operator credentials using synthetic fixture values; this ledger
-- cannot issue live signers or accept a fabricated successful source status.
CREATE TABLE IF NOT EXISTS nft_m12_readonly_source_observations (
 review_id UUID NOT NULL REFERENCES nft_m12_final_reviews(id) ON DELETE RESTRICT,
 source_kind TEXT NOT NULL CHECK(source_kind IN(
  'primary_rpc','independent_rpc','blockscout','social_issuer',
  'cloudinary','clamav','pinata','postgres_restore','reown')),
 observation TEXT NOT NULL CHECK(observation IN ('unavailable','read_only_unverified')),
 summary_sha256 TEXT CHECK(summary_sha256 IS NULL OR summary_sha256 ~ '^[a-f0-9]{64}$'),
 checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(review_id,source_kind)
);
COMMIT;
