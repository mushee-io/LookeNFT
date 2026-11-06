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


## M4 — Collection factory and creator studio (stacked draft, not deployed)

M4 implements Ultra EVM **Testnet-only** ERC-721/1155 collection contracts and
a deterministic CREATE2 factory, using pinned OpenZeppelin Contracts 5.6.1,
solc-js 0.8.30 and Hardhat local VM. Creator ownership, reserve mint supply
caps, ERC-2981 royalty signalling, metadata controls, pause/freeze and
on-chain event evidence are covered by local tests. Upstream audited libraries
do **not** make our custom contracts independently audited.

- `npm run contracts:compile`
- `npm run contracts:analyze` (local compilation hashes and runtime sizes)
- `npm run contracts:test` (local hardhat unit/adversarial/property tests)
- `npm run check` (application + PostgreSQL regression)

`/create` provides a real editable collection configuration form with
metadata and royalty checks, deterministic address preflight against a
configured factory, and explicit wallet approval when enabled.

**No deployments have been authorised.** Cancun compatibility on Ultra EVM Testnet is unverified and remains a separate NO-GO gate; this build uses Cancun-only MCOPY instructions. The default
`NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT=false` and `NEXT_PUBLIC_M4_CANCUN_VERIFIED=false` blocks all transaction submission
and `NEXT_PUBLIC_M4_FACTORY_ADDRESS` starts empty. No private keys, seed
phrases or remote deploy scripts are included. To enable future human-authorised
Testnet deployment, the operator must first deploy/verify the factory with
their own wallet, configure the factory address and review the release gates
documented in `docs/M4_ACCEPTANCE.md`.

After a real wallet-approved collection transaction, the read-only
`scripts/m4-verify-deployment.ts` requires independent Testnet RPC and
Blockscout explorer evidence before producing a verified on-chain manifest.
A source-code verification and independent security review remain separate.

M1/M2/M3 still have unmerged draft PRs and inherited real-wallet/identity/
data/explorer blockers. **No mainnet, NFT purchase, fee or public beta launch.**


## M5 — Wallet-approved public and allowlist minting (engineering only)

M5 adds an ERC-721/1155 phase-mint module and factory **VERSION 2**. A creator
must separately schedule each immutable public/allowlist phase. Per-phase and
lifetime wallet limits, lifetime token supplies, optional Merkle allocations,
expiry, on-chain caller nonce, UOS payment/refund accounting, reentrancy protection
and creator-only proceeds withdrawals are enforced by the smart contracts.

`/mint` offers a read-only phase quote and simulation and, **only if a
human-approved Testnet operator has enabled both release flags**, explicit
wallet-confirmed mint submission with receipt and ownership checks. By default
`NEXT_PUBLIC_M5_ENABLE_MINTING=false`, `NEXT_PUBLIC_M4_CANCUN_VERIFIED=false`
and no factory address is provisioned. **No financial transactions are enabled.**

CI tests include local Hardhat Cancun mint/merkle/payment/callback property
tests, real ephemeral PostgreSQL receipt constraints, and TypeScript/Next build.
Local tests are not real Ultra EVM Testnet activity.

To independently document **a future real authorised mint** (no broadcast),
apply migration `003_m5_mint_receipts.sql` and run
`npm run mint:verify` with actual `M5_FACTORY_ADDRESS`,
`M5_COLLECTION_ADDRESS`, `M5_CREATION_MINT_TX_HASH` and
`M5_INDEPENDENT_RPC_URL`. Two RPC providers, the official Blockscout
explorer and the M3 approved registry must agree or verification fails.
The script never uses keys or signs transactions.

See `docs/M5_ACCEPTANCE.md`. M1–M4 still have outstanding real-wallet,
operator database, independent explorer, Cancun compatibility and audit gates.
**No M5 deployment, mint, payment or mainnet release has been carried out.**


## M6 — Secure creator media, moderation and metadata (stacked draft)

M6 adds a private creator asset dashboard at `/studio`, a protected
reviewer queue at `/studio/moderation`, and wallet-scoped media and metadata
APIs using PostgreSQL migration `004_m6_creator_media.sql`.

- Private authenticated Cloudinary uploads require actual backend credentials,
  byte-level PNG/JPEG/WebP/MP4/WebM validation, upload caps and a real ClamAV
  INSTREAM clean result. **Uploads OFF by default.**
- Creator uploads are quarantined; only operator-allowlisted, wallet-authenticated
  moderators may approve with actual evidence. Creators cannot self-approve.
- IPFS publishing requires separately enabled Pinata credentials, an approved
  asset re-upload with matching SHA-256 and second scan, and independent
  gateway byte-hash confirmation. No unmoderated file is intentionally pinned.
- Metadata is canonical, versioned, owner-authenticated and linked only to
  an actual approved NFT contract and verified media CID. ERC721 tokenURI /
  ERC1155 uri checks are read-only and labelled *primary RPC only*.
- `npm run test:media` adds adversarial media and PostgreSQL tests, while
  `npm run check` and full Solidity regression stay required.

No credentials, original audits, human reviews or live media have been provided.
All external integrations default to disabled, and M1–M5 PRs remain unmerged
drafts. Cancun MCOPY compatibility and independent Testnet/Blockscout evidence
remain NO-GO. See `docs/M6_ACCEPTANCE.md` for exact acceptance gates and
operational instructions. **No chain deployment, minting or UOS payments.**


## M7 — Fixed-price ERC721/1155 listing groundwork (Ultra EVM Testnet)

M7 adds an EIP-712 signed, no-escrow fixed-price settlement contract
`contracts/LookeFixedPriceMarket.sol`, using immutable 200 bps fee, ERC-2981
royalties, per-seller nonce cancellation, expiry and reserved-buyer restrictions,
live ownership and approved NFT transfer checks. Successful sales atomically
transfer the NFT seller→buyer and UOS buyer→seller/fee/royalty; any failed
transfer/payout reverts the entire transaction. No live settlement executed.

- `/market` previews signed offers, read-only on-chain quote, signature
  registration, buyer payment/royalty review and explicitly wallet-approved
  purchase/cancellation paths, **all trading/signatures OFF by default**.
- `/api/market/listings` saves **genuine seller EOA typed signatures only**
  after a verified M3 collection, ownership and actual transfer approval.
- `db/migrations/005_m7_fixed_price_listings.sql` stores unverified signed
  order candidates and independently corroborated sale receipts, never
  invented listings or order volume.
- `npm run market:verify` is operator-only read-only RPC+Blockscout settlement
  reconciliation and cannot sign/broadcast. It fails if Blockscout HTTP 404
  persists, or if either provider disagrees.

No marketplace address, operator/security authorisation, or real wallet-signed
listing has been supplied. M1–M6 remain draft and release NO-GO. See
`docs/M7_ACCEPTANCE.md` for evidence gates and precise integration blockers.

## M8 — Secure native-UOS buyer bids (engineering only)

M8 adds a separate `LookeFundedOffers` contract for **fully funded** EIP712
buyer offers on Ultra EVM Testnet 18881. An exact, explicit wallet-approved
UOS deposit locks the *entire* buyer offer before any seller acceptance.
Funds are bound to the buyer's unique nonce and order hash, with cancellation
and refund (including an alternative refund recipient chosen by the buyer).
The seller separately approves NFT transfer and accepts, causing one atomic
ERC721/1155 transfer + fixed 2% marketplace fee, ERC2981 royalty and seller
proceeds. Failed NFT delivery or UOS payout reverts the whole transaction.
No private keys, mainnet, automatic approvals or live transactions.

`/offers` presents wallet-scoped drafts and read-only funded-offer evidence,
never synthetic bidding volume. The server requires a genuine seller-independent
buyer EOA signature **and primary Testnet fund receipt** before saving even a
candidate. Public bids require a separate independently corroborated
funding entry. `npm run offers:verify` compares two distinct real Testnet RPCs,
the official Blockscout explorer, actual funding/settlement/refund events,
and exact UOS payout / NFT transfer evidence before recording verified status.
The prior Blockscout HTTP 404 must be resolved before this can succeed.

Every signing, funding, acceptance, refund and server journal gate is **OFF by
default**, pending actual operator wallet signatures, audited contract
compatibility and real source-backed checks. Apply `006_m8_funded_offers.sql`
after migrations 001–005. See `docs/M8_ACCEPTANCE.md`. M1–M7 remain
unmerged drafts, with no live bid, UOS escrow or financial release.

## M9 — Canonical read-only marketplace operations (engineering only)

M9 adds `/market/operations` with wallet-scoped **verified** M7/M8 sales
counts and exact UOS volume, read-only order snapshots, private source-backed
activity notifications and separately fetched two-RPC on-chain fee/royalty/gas
previews. **A signed order is not a sale**; the floor shown from an observed
seller order is explicitly *indicative*, never claimed verified or executable.

`lib/m9/reconcile.ts` and `scripts/m9-market-once.ts` implement bounded,
operator-only **Ultra EVM Testnet 18881** event scanning: two distinct RPCs
must match chain IDs, approved deployed M7/M8 contract bytecode, every block's
parent hash, exact log identities and official Blockscout canonical block
hashes. Verified data is journalled in PostgreSQL migration 007 with unique
event keys and atomic cursor checkpoints; a reorg triggers bounded rollback
and **quarantine of historical independent attestations** rather than counting
orphaned settlements. Failed Blockscout HTTP 404 = no checkpoint advancement.

Read-only `market:snapshots` checks up to 30 real M7 and 30 independently
funded M8 candidates on two RPCs at the confirmed block; provisional and
unfunded bids never become executable orderbook records. Authenticated wallet
read APIs have atomic PostgreSQL per-wallet request buckets; notifications
are wallet-private and can only originate from independently attested,
canonically matched event evidence. No sample NFT/volume/activity is seeded.

M9 is a stacked draft on M8. **No worker is scheduled** and every M9 scanner
and wallet financial flag is OFF by default. Real M7/M8 deployment, human
wallet acceptance, Blockscout, production operator PostgreSQL, Cancun opcode
compatibility and independent audits remain NO-GO. See `docs/M9_ACCEPTANCE.md`.

## M10 — Looke Social ↔ LookeNFT trusted read-only integration

M10 adds `/social-link` and three wallet-scoped authenticated routes:
`/api/social/bridge` (short-lived signed source snapshots),
`/api/social/avatar` (ERC721/ERC1155 owner corroboration), and
`/api/social/creators` (strictly gated discovery).
PostgreSQL migration 008 records only claims from an operator-pinned
**EdDSA source**, bound to the same M2 wallet/profile link with atomic
nonce replay prevention, monotonic snapshots, moderation-approved public
posts, and a five-minute, independently witnessed NFT avatar. No passwords,
raw JWTs, source cookies, social DM content, synthetic creators, followers,
likes, trades, posts or NFTs are stored.

**Critical source blocker:** inspected `mushee-io/looke` `main`
on 6 November 2026. It has authentic EIP-191 social wallet login, SQL
profiles/feed/blocking/moderation, but it **does not issue compatible
`lookenft-social-proof` EdDSA assertions**. M10 also requires an M2
trusted identity issuer; neither is provisioned. The M10 public directory
requires independently attested blocked/muted-viewer policy.
All M10 features are OFF by default; no real Looke Social account is linked.

NFT owner verification requires real approved ERC721/1155 collection code,
M3 canonical indexer proof, independent secondary Ultra Testnet RPC,
matching ERC165/token owner or balance at 12+ confirmed blocks, and official
Blockscout block hash. HTTP 404 or any missing source stops before
recording ownership. Even valid proof is historical (up to five minutes),
not permanent ownership. Moderated image display also requires M6 real
human review, clean malware scan, pinned IPFS metadata.

Collection deep links are holder references, **not proof of being
the collection creator**, and opening Looke Social does not post anything.
Existing M9 verified wallet-only market notifications are read-only.
Migration 008, source contract and precise NO-GO gates are documented in
`docs/M10_ACCEPTANCE.md`. No mainnet, real deployment or trading action.
