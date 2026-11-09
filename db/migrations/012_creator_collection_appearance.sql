-- Self-service owner collection appearance; the original on-chain NFT metadata
-- remains separately controlled by setBaseURI / setURI and cannot be rewritten here.
BEGIN;
ALTER TABLE looke_curated_collections
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
COMMIT;
