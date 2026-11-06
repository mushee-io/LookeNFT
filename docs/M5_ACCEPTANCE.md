# LookeNFT M5 — Testnet-first minting, immutable phase controls and evidence

## Scope and inherited release NO-GO (6 November 2026)

- M1 PR #1 final `4071364c7acf6d2a6f8d9f3332c55415b0143941`: green CI `42105369118`; real desktop/mobile Testnet wallet validation absent.
- M2 PR #2 final `a9bdecef40a54bdea166f935e318f615a87fa277`: green CI `42108864950`; Reown, real signed wallet sign-in, issuer and operator Postgres evidence absent.
- M3 PR #3 final `59cbcd92f1f4e2ea00330a331a469f7508d48e3c`: green engineering CI `42115672497`; no registered authorised real NFT deployment/independent RPC; Blockscout historical block lookup returned 404.
- M4 PR #4 final `fc764929fae59825607a8a62817c9fa555fc75f0`: run `42138741197` showed 22/22 unit tests, 6/6 PostgreSQL tests, 11/11 Solidity tests, clean Next build. Its independent external-source job FAILED (non-blocking workflow configuration) and its chain proof remains NO-GO.
- All four PRs are unmerged drafts. M5 must be stacked on M4 and must not be merged out of order.
- **Cancun MCOPY/PUSH0 support on real Ultra EVM Testnet 18881 has NOT been independently established.** A local Hardhat Cancun chain is not an Ultra chain proof.
- No authorised factory, production database, funded wallet, on-chain mint, transaction receipts, signed operator review, original security audit, or explorer proof have been provided. Do not create or imply them.

## Contracts

M5 adds `LookeMintPhases.sol`, shared by the ERC-721 and ERC-1155 collections, and updates the factory to `VERSION=2` because constructor/runtime bytecode and CREATE2 address hashes change.
- Minting is **inactive** until the creator explicitly schedules a phase. Only creator can schedule/cancel phases; a created phase cannot be repriced or altered. At most 100 phases.
- Phase duration up to 90 days, native UOS max unit-price 1000 UOS, immutable per-wallet cap, phase cap and allowlist root. Creator can cancel a phase.
- Public phases have zero Merkle root and reject unexpected proofs. Allowlist phases validate OZ double-hashed sorted-pair Merkle proofs, including chain ID, exact collection address, phase ID, caller wallet and allowance. Claims are not valid across contracts/other wallets/phases.
- Phase mint goes **only to the paying wallet**, not an arbitrary recipient. Exact sequential transaction nonce and caller-specified deadline are checked. A successful request increments `mintNonces[phaseId][wallet]`. The transaction itself is also protected by the EVM transaction nonce.
- Global and per-ID lifetime supply remain binding, including creator-reserved mints. Phase per-wallet and 1000-token cross-phase public-mint lifetime cap are checked before minting.
- ERC-721 maximum mint per transaction: 20 sequential tokens. ERC-1155 maximum per transaction: 1000 units. ERC-1155 per-ID lifetime limit remains enforced.
- Native UOS payment: `msg.value` must cover `unitPrice*quantity`. Excess is refunded atomically; a rejected refund reverts all mint effects and payment accounting. Creator can withdraw only recorded accrued mint proceeds. Caller-gas fees are external to this accounting.
- NonReentrant and checks-effects-interactions guard against callback and refund reentrancy. Mint-pause applies to public, allowlist and reserved mint functions, **not existing token transfers**.
- Factory's chain ID remains 18881, no hard-coded mainnet network and no private keys. This custom code has **not** received an independent audit. ERC-2981 royalties are signals and not enforced by other marketplaces.

## UI & wallet safeguards

- `/mint`: on-chain read-only factory version 2/registry check, collection ERC-165, phase terms, caps, wallet nonce, wallet lifetime counter, exact quote and contract simulation.
- A user checks a specific review, then separately approves `eth_sendTransaction` in their wallet. The session provider rechecks actual chain, account, authenticated session, factory VERSION, approved collection, current nonce and exact UOS amount.
- Requested payment capped at 1000 UOS per transaction in the frontend wallet guard. The wallet transfer always includes the reviewed exact amount (contract refund behaviour is covered separately by tests).
- **Default OFF**: `NEXT_PUBLIC_M5_ENABLE_MINTING=false`, `NEXT_PUBLIC_M4_CANCUN_VERIFIED=false`, no `NEXT_PUBLIC_M4_FACTORY_ADDRESS` in environment examples.
- A submitted hash is labelled submitted, never minted; a confirmed receipt is compared to exact wallet/from/to/calldata/value, PhaseMint and ERC721/1155 mint transfer events and receipt-block ownership. It is labelled `confirmed-primary-rpc-only`, not independently approved or audited.
- A signer/session/phase change invalidates quote or causes a fail-closed wallet recheck. Metadata and media remain M6 work.

## Database, evidence and CI

- Apply migrations 001, 002 and `003_m5_mint_receipts.sql` in order.
- `nft_mint_verified_receipts`: independently corroborated, chain-locked, unique tx/log and collection/phase/wallet nonce receipt evidence. No records are seeded. The integration tests use clearly synthetic fixtures against real ephemeral PostgreSQL and delete them.
- `npm run mint:verify`: **operator-only** read-only reconciliation requiring a real factory, collection, transaction hash, independent HTTPS RPC and official Blockscout. Validates chain ID, both receipts, minimum 12 blocks, canonical block hashes, minted transfer/amount, recorded phase event, payment/refund, M3 approved collection registry; only then inserts an immutable-by-policy evidence record.
- If Blockscout returns HTTP 404 or a third-party source is inaccessible, verification exits nonzero and no record is inserted. A local fixture or primary-only UI confirmation cannot substitute.
- `npm run contracts:compile`, `npm run contracts:analyze`, `npm run contracts:test`, `npm run test:m5`, `npm run check`: compile Cancun, bytecode sizes, unit, fuzz/property, adversarial and actual PostgreSQL integration tests. CI runs all and archives local compiled bytecode with deployed=false.

## Release acceptance — all independently evidenced

- [ ] Final exact M5 branch head: TypeScript, all unit/PG tests, build and full Solidity tests green.
- [ ] No remaining adversarial/fuzz/test flakes; record reproducible compiler hash.
- [ ] Independent smart-contract security review: cap, rounding/refunds, withdrawal, nonce, Merkle and receiver callbacks.
- [ ] Real Ultra EVM Testnet Cancun MCOPY/PUSH0 proof and human sign-off, plus reviewed factory V2 deployment.
- [ ] Real supported NFT collection, verified factory owner and code, approved M3 registry plus index coverage.
- [ ] Real Reown mobile/desktop wallet acceptance, authenticated Looke identity linking and production PostgreSQL.
- [ ] Independent RPC and Blockscout hash/event proof (existing HTTP 404 blocker resolved).
- [ ] Human wallet-approved UOS mint test in an approved Testnet environment, receipt and 12-block finality with exact account/amount/ownership.
- [ ] Human mobile/tablet/desktop walkthrough at 375/768/1440px.
- [ ] No mainnet execution, unapproved financial transactions or public beta until explicit reviews pass.

## M6 handoff

M6 focuses on real media upload authorisation, encrypted file access when
needed, moderation queues, hosted artwork and verified IPFS metadata, tokenURI
reconciliation, safe renderers, malicious-media and size attacks, creator
dashboard and eventual collection mint artwork preview. Real operator-backed
Cloudinary/IPFS credentials and human moderation proof are required before claiming them operational.
