# Looke NFT Marketplace

LookeNFT is an **Ultra EVM-only**, social-first NFT marketplace, inspired by VeryChat's simple integrated NFT Market. It will link to Looke Social but currently has **no live minting, listings, offers, purchases, fees or synthetic NFT records**.

## Networks

| Environment | Chain ID | RPC | Explorer |
| --- | ---: | --- | --- |
| Testnet (default) | 18881 | https://evm.test.ultra.eosusa.io | https://evmexplorer.testnet.ultra.io |
| Mainnet (NO-GO) | 19991 | https://evm.ultra.eosusa.io | https://evmexplorer.ultra.io |

Official network source: https://developers.ultra.io/tutorials/Ultra-EVM/Resources

## M2 setup

- Install Node 22+ and PostgreSQL 16+; create a separate database and least-privilege role.
- `npm install`; copy `.env.example` to `.env.local` and fill `DATABASE_URL` and `APP_ORIGIN`.
- Apply `db/migrations/001_m2_wallet_auth.sql` once with your database client.
- `npm run dev`; visit http://localhost:3000. Never put private key material into environment files.
- `npm run check` (requires PostgreSQL) runs types, unit/adversarial PostgreSQL integration tests and production build.
- Optional: configure public `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for WalletConnect v2 QR mobile pairing.
- Optional: configure `LOOKE_IDENTITY_PUBLIC_KEY_PEM` and `LOOKE_IDENTITY_ISSUER` only after Looke Social securely publishes issuer-signed wallet identity assertions with audience `lookenft`.

## Wallet-authentication model

1. User explicitly connects with EIP-1193/EIP-6963/WalletConnect.
2. User explicitly clicks **Sign in**. LookeNFT issues a short-lived EIP-4361-style message containing host, URI, chain ID, account, one-time nonce and expiry.
3. Wallet returns an EIP-191 personal signature; server verifies it against the exact persisted challenge (EOA accounts at this stage), consumes the nonce atomically in PostgreSQL and issues a 12-hour HttpOnly cookie.
4. Every authenticated route checks session expiration, revocation and the configured Ultra EVM chain; disconnect revokes the server token.
5. Browser reload silently queries `eth_accounts` only for an already-authorised provider and matches it with the existing server session. Account/network changes clear the UI auth state and revoke cookies.
6. Looke Social profile linking is **disabled without a real signed assertion issuer**. A display name or handle is not identity proof; verified JWTs are bound to the authenticated wallet, issuer, audience, expiry and unique jti.

**Not supported yet:** EIP-1271 contract-account sign-in; wallet execution; NFT ownership reads; real Looke Social SSO issuance; mainnet release. This code is testnet-first, not production identity sign-off.

Review [M1 evidence and missing acceptance](docs/M1_REVIEW.md), [M2 acceptance](docs/M2_ACCEPTANCE.md) and the [M1–M15 roadmap](docs/ROADMAP.md).


## M3 — Canonical NFT event index (read-only, Testnet only)

M3 adds operator-approved NFT contract discovery, ERC-721/1155 event ingestion,
confirmed block-hash checkpoints, reorg rollback, indexed ownership and
allowlisted on-chain metadata. No NFT contracts, sales or trading are live.

### Operator setup
1. Configure PostgreSQL and apply `db/migrations/002_m3_nft_indexer.sql` after M2 migration 001. CI applies both to ephemeral PostgreSQL 16.
2. Identify an actual deployed ERC-721 or ERC-1155 Ultra EVM Testnet contract. Set `NFT_COLLECTION_ADDRESS`, `NFT_COLLECTION_STANDARD`, and genuine `NFT_DEPLOYMENT_BLOCK`, then run `npm run indexer:register`. This checks ERC-165 and bytecode; it does **not** attest source auditing.
3. Set `NFT_START_BLOCK` at or before the earliest registered deployment; run `npm run indexer:once`. Scanner consumes up to 25 sequential blocks per call and excludes the newest 12 blocks by default. It is NOT launched automatically.
4. Explore real indexed collections at `/explore`, indexed ownership under `/portfolio`, individual collection tokens and transfer-only `/activity`. Without coverage, UI explicitly says balances cannot be inferred.
5. Set `NFT_INDEPENDENT_RPC_URL` to a genuinely independent HTTPS Ultra EVM Testnet provider; run `npm run indexer:verify`. This compares indexed blocks and transfers with primary RPC, independent RPC and official Blockscout block hashes. Failure is a blocker, not a pass.
6. When new contracts predate the cursor, obtain explicit operator approval, set `NFT_CONFIRM_REINDEX=REINDEX_ULTRA_TESTNET_EVENTS` and run `npm run indexer:reindex` to rebuild from the oldest registered deployment.

NFT metadata is never fetched from arbitrary on-chain URIs. Configure exact
`NFT_METADATA_ALLOWED_HOSTS` and an allowed `NFT_IPFS_GATEWAY`. All browser
and API outputs remain read-only; neither source-code verification nor complete
wallet coverage is implied.

See `docs/M3_ACCEPTANCE.md` for checks and outstanding operator evidence.
