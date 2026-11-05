# LookeNFT M1–M15 delivery plan

Project: mushee-io/LookeNFT. Network: **Ultra EVM only**. Product: social-first NFT Market inspired by VeryChat, with an integrated Looke Social NFT tab. Default launch environment: Ultra EVM Testnet (18881). No cross-chain features in this release.

**Universal gate for each milestone:** inspect prior milestone PR and exact final commit; verify required CI and independently verifiable evidence; merge only if green and reviewed; build next milestone on the actual merged head; run tests; open a descriptive PR; do not claim on-chain success, wallet signatures or audit approval without evidence. No financial transaction is executed without the user's wallet confirmation. Mainnet remains gated through M15.

## M1 — Foundation and design system
Deliver Next.js + TS project, mobile-first integrated-market shell, Home/Explore/Create/My NFTs/Activity routes, Ultra EVM Testnet/Mainnet configs, EIP-1193 connect and switch network, truthful no-data states, CI/typecheck/smoke test, and documentation. Testnet default; never simulate volume or deployment. Exit: final CI green, app builds, human UI + wallet checks evidenced.

## M2 — Wallet sessions and identity boundary
Build robust wallet state via a central provider, reconnect only to previously authorised accounts, disconnect UI, chain/account change handling, typed wallet errors, mobile wallet compatibility, signed challenge login for backend sessions (SIWE-compatible if chain/wallet supports), short-lived nonce and replay protection, wallet-to-Looke profile mapping. Exit: wallet pairing and signature verification tests, negative replay tests and real Ultra Testnet wallet acceptance.

## M3 — Chain indexer and NFT discovery
Build read-only Ultra EVM RPC ingestion of ERC-721/1155 Transfer events, finalized block cursor, reorg rollback, block-hash checkpoints, deduplication, persisted indexed ownership, approved collection registry, metadata fetching with timeout/size restrictions and resync tools. Return truthful empty states until verified assets exist. Exit: compare indexed records and ownership against official explorer / RPC, test reorg and restart.

## M4 — Creator collection factory
Implement audited OpenZeppelin-based ERC-721 and ERC-1155 templates, supply caps, immutable/explicitly governed metadata and creator ownership, royalty config, deterministic deployment tracking, factory permissions, verified contract source and explorer links. Creator flow: name, symbol, collection cover, supply, terms preview, wallet confirmation. Exit: deploy factory + representative collections on testnet with actual transaction hashes and independent reads.

## M5 — Minting and ownership
Implement wallet-approved public and allowlist minting, mint prices in UOS, per-wallet quotas, supply enforcement, deadlines, refunds/reverts, gas/chain previews, transaction status and explorer receipts, proper NFT assignment and transfers. Exit: genuine testnet mints and failures confirmed against contracts/independent indexed events.

## M6 — Creator media and metadata integrity
Authenticated image/video uploads, signed upload policy, content hashing, object storage or IPFS retention plan, metadata JSON canonicalisation, safety/moderation review, MIME/size validation, CDN fallback, takedown/redaction handling without faking immutable on-chain metadata. Exit: hosted assets load from independent clients, rejected invalid uploads, tamper and access-control tests.

## M7 — Secure fixed-price listings
Build NFT approval flow, listing service and noncustodial settlement contract, signed order with domain separation and expiry or audited escrow alternative, per-token nonces, cancellable listings, ownership checks, single-fill execution, fee preview and explicit seller consent. Exit: verified listing and cancellation testnet hashes; price and approvals reproduced independently.

## M8 — Buy and settle with UOS
Implement wallet-approved purchasing, gas/slippage/price safety checks, chain/time validity, atomic NFT and UOS settlement, pull/payout safety, no stale sales, fee and royalty accounting, transaction receipt and repeat-submit protections. Exit: independent testnet buyer/seller acceptance; malicious reentrancy and replay tests, no synthetic sales or volume.

## M9 — Offers and bids
Buyer-funded or securely authorised offer workflow, offer expiry/nonce/cancellation, owner accept, partial versus full order semantics by token standard, bid withdrawal, balance checks, escrow liability accounting if used, and final on-chain settlement. Exit: real offers created, accepted, cancelled and refunded on testnet with documented hashes.

## M10 — Social and profile integration
Embed NFT tab in Looke Social, reuse only explicitly authorised identity links, collection showcase/profile PFP with verified ownership, shareable NFT and collection post cards, creator follow links, notifications for offers and sales, privacy and account boundaries. Exit: true ownership-gated PFP and account-scoped notifications, secure cross-app integration tests.

## M11 — Search, market data and moderation
Search by creator/collection/token, safe ranking, collection status verification, filters, watchlist and favorites, event-backed floor price/volume/activity, spam/impersonation controls, flagged asset workflow and transparency log. Exit: all displayed stats reconcile to indexed transactions, adversarial metadata and moderation tests.

## M12 — Security hardening and independent review
Full contract threat model, invariant/fuzz/property tests, independent audit and findings resolution, bug bounty plan, backend auth/RBAC, API rate limiting, wallet and cross-origin security, operational key isolation, phishing/spoofing safeguards and incident playbook. Exit: documented independent findings, critical/high issues resolved and retested; no fabricated sign-offs.

## M13 — Marketplace economics and royalties
Decide fee schedule (not presumed 5%), collection fees, platform treasury policy, optional LOOKE utility, opt-in royalty logic and whether any UOS/LOOKE burn is viable. Implement on-chain basis points, exact payout math, change timelocks, accounting exports and fee transparency. Exit: tested fee scenarios and seller receipts; legal/economic review before any token-burning claims.

## M14 — Controlled public testnet beta
Launch access-controlled/public Testnet beta only after M4–M13 acceptance: real wallet buyers/sellers, trial creator onboarding, user reporting, load/latency and indexer recovery monitoring, support pages, usability testing, mobile app entry, rollback and incident exercises. Exit: tracked testnet metrics from chain evidence and independent operator sign-off.

## M15 — Mainnet readiness and controlled launch
Review audit, on-chain verified deployments to Ultra EVM Mainnet 19991, multisig/admin ownership, immutable deployment manifest, treasury controls, emergency controls, gas budget, disaster recovery, post-launch alerts and legal/compliance checks. Publish collections/fees/docs, cut over Looke Social NFT tab, launch with staged limits and observability. **No mainnet deployment unless explicit operator authorization and independent release gate approval.**
