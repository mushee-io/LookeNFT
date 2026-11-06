# LookeNFT M8 — fully funded native-UOS NFT bids (Ultra EVM Testnet only)

## Exact predecessor verification — 6 November 2026

| Draft PR | Verified final commit | Status |
| --- | --- | --- |
| M1 #1 | `4071364c7acf6d2a6f8d9f3332c55415b0143941` | Draft/open, not merged |
| M2 #2 | `a9bdecef40a54bdea166f935e318f615a87fa277` | Draft/open, not merged |
| M3 #3 | `59cbcd92f1f4e2ea00330a331a469f7508d48e3c` | Draft/open, not merged |
| M4 #4 | `fc764929fae59825607a8a62817c9fa555fc75f0` | Draft/open, not merged |
| M5 #5 | `29bdf1c9ed3c8a876f98461667b6ef73af074700` | Draft/open, not merged |
| M6 #6 | `cb800b98b890a02b9185a72f180da25c2910d395` | Draft/open, not merged |
| M7 #7 | `8497461068383c5527bebe3c04e5a14e55dc7573` | Draft/open, not merged |

M7 exact-head CI `42149927437`: 41/41 application, 12/12 real ephemeral PostgreSQL, 32/32 local Solidity and Next/TypeScript/build passed. **Independent external-source job failed with Blockscout HTTP 404**, and is marked continue-on-error, so the overall green workflow is NOT live-chain or launch acceptance.

All real-wallet/mobile/desktop, Reown, Looke Social trusted identity, operator PostgreSQL, authorised M3 NFT registry, independent second RPC/Blockscout, actual Ultra EVM Testnet Cancun MCOPY/PUSH0 compatibility, custom contract security review, Cloudinary+ClamAV+Pinata hosted media, actual human moderation, M4/M5 factory/mint and M7 marketplace deployment/transaction proofs remain open.

## Engineering scope (not an active service)

**M8 does not extend M7's escrowless seller listings.** It introduces an independent `LookeFundedOffers` buyer-funded escrow contract (no shared custody or deployer) because a signature without funds cannot guarantee buyer payment.

1. Buyer must separately authorise EIP-712 Offer signature bound to **chain 18881**, exact offer-vault address, buyer, NFT collection, token ID, full quantity (721=1, 1155 up to 1000), total UOS, unique buyer nonce, deadline (90 days max), optional seller restriction, signed minimum seller proceeds, maximum fee bps and maximum ERC2981 royalty bps.
2. `fund(offer,signature)` requires msg.sender = exact signer and **msg.value = exact totalPriceWei** (max 1000 UOS). Fully signed buyer EOA/EIP1271 permission is checked by OpenZeppelin SignatureChecker on-chain. State and buyer locked UOS are recorded BEFORE any future transfer; one digest per buyer nonce prohibits duplicate independently-funded bids.
3. Seller must separately approve the actual NFT operator, own ERC721 token or hold complete ERC1155 quantity, be permitted by optional seller restriction, and explicitly call `accept` with their own wallet. A buyer cannot sell to themselves. No automatic operator approvals, partial fills, synthetic trades or background execution.
4. On acceptance: mark offer filled + nonce consumed, debit locked accounting first, safeTransfer NFT seller→buyer, then pay seller, immutable 2% platform recipient and collection's ERC2981 royalty. Fee/royalty/proceeds are explicit in immutable event. Any receiver, NFT transfer or payout failure reverts **all** effects. No operator admin, fee adjustment, unbounded withdrawal or sweep.
5. Cancel buyer nonce/raise minimum nonce; buyer wallet may use `refundTo` to reclaim full UOS into a buyer-chosen wallet address (allows smart contract buyers unable to receive native transfers). Any caller can `refundExpired` only if bid expired or its nonce has been cancelled, always to original buyer. A failed refund transaction reverts, preserving original funds/nonce until buyer chooses a suitable route.
6. Solvency: `buyerLockedWei`, `totalLockedWei` with `balance >= totalLockedWei` invariant on each fund/accept/refund. Deposits cannot fund multiple bids with a reused nonce. All endpoints default disabled, no keys or mainnet.
7. `/offers`: unsigned draft, separate wallet signature and **wallet approval of exact UOS deposit**, then primary-RPC evidence and optional separate independent attestation. Sellers see only independently verified funded offers; they must recheck current vault/nonce, royalty and real NFT owner/approval before separately wallet-approving acceptance. Refund is buyer-only. Submitted hash/primary-only status is not independent sale proof.
8. `/api/offers`: per-wallet authenticated GET; open discovery only independently funded; POST only after real EOA signature, real successful exact Testnet UOS funding transaction, unique OfferFunded event, deployed vault version 1, current escrow state and M3 approved NFT registry. Stored state is explicitly `primary_rpc_funded_unverified` until independently reconciled. Reject invented orders and forged wallet/session.
9. Database migration 006: constrained buyer nonces, unique funding transactions, exact chain 18881, supported ERC standard/quantity, escrow funding states, immutable-by-policy verified funding/settlement/refund log with sum-of-UOS payout constraint and replay uniqueness. No seeded bids, NFTs or activity.
10. `npm run offers:verify` read-only operator reconciliation: **two independent real HTTPS Testnet RPCs + official Blockscout** must agree on real transaction success, chain ID, canonical block hash, 12-block finality, vault runtime bytecode/VERSION and decoded fund/accept/refund calldata and event. Fund events verify buyer EIP712 authorization and exact value; settlement checks real NFT delivery and the buyer/seller/fee/royalty UOS split; refund verifies exact buyer amount. Only then can PostgreSQL state advance atomically, with duplicate events rejected. Blockscout HTTP 404 is a **hard blocker**, never replaced by local fixtures.

## Test and security matrix

- Solidity tests on **local Hardhat Cancun simulation** (NOT Ultra EVM Testnet) for EIP712 domain separation, malicious signer/modified amounts, wrong buyer funding, unique nonce collision, escrow exactness, ERC721/ERC1155 ownership and seller restriction, royalty caps, atomic fee payouts, reverted recipient, cancellation, alternate refund destination, expired refunds, buyer self-sale, property-based random UOS values, and balance/locked invariant.
- Application tests cover viem EIP712 verification, unsigned/overflow UOS input, ERC token bounds, nonce/expiry, explicit disabled flags and absence of an operator sweep.
- Real ephemeral PostgreSQL tests validate owner isolation, unique buyer nonce/order/tx, impossible non-chain records, sum-of-payouts and valid state constraints using **synthetic disposable fixtures only**.
- Full TypeScript/Next app build, all prior M1–M7 regressions, bytecode limits EIP170/EIP3860 and exact-head CI; save local compiled artifacts labelled NOT DEPLOYED.
- No original security audit, independent hosted RPC evidence, authorised signing keys, real buyer/seller transaction signatures or deposits, user NFT transfers or frontend device acceptance available. **All are external acceptance blockers.**

## Default-OFF flags

```dotenv
NEXT_PUBLIC_M8_ENABLE_OFFERS=false
NEXT_PUBLIC_M8_ENABLE_FUNDING=false
NEXT_PUBLIC_M8_ENABLE_ACCEPTANCE=false
NEXT_PUBLIC_M8_ENABLE_REFUNDS=false
NEXT_PUBLIC_M8_OFFER_VAULT_ADDRESS=
M8_OFFER_RECORDING_ENABLED=false
M8_VAULT_ADDRESS=
M8_EVENT_TX_HASH=
M8_EVENT_KIND=
M8_INDEPENDENT_RPC_URL=
NEXT_PUBLIC_M4_CANCUN_VERIFIED=false
```

These flags are engineering barriers and are **not** themselves safety approval. All require an actual independently audited Testnet vault, confirmed real Cancun opcode support, real operator PostgreSQL, independently approved feeRecipient, real wallet/transaction evidence and independent human operator sign-off. **Do not enable even on Testnet before these gates pass.**

## M8 release gate / M9 handoff

- [ ] Exact-final-commit CI all engineering jobs green (including full Solidity/property/PostgreSQL/production build).
- [ ] Independently verified Testnet vault deployment, runtime bytecode, stored collateral invariant, source review, user wallet signature and expiry/refund rehearsals.
- [ ] Independent audit of native UOS custody, royalty changes, signature replay/EIP1271, third-party callbacks, failed-refund liveness, ERC1155 token receivers and adversarial ERC721 return paths.
- [ ] Real second RPC and Blockscout (HTTP 404 resolved), real signed purchase/seller acceptance and independently verified NFT + UOS receipts.
- [ ] Human device wallet acceptance and protected rollback drill, M1–M7 gates and human sign-off.
- [ ] No PR merge, financial beta, mainnet or public release without those gates.

**M9 (engineering only):** production-proof UX for offer and listing lifecycle, event-driven market activity, secure orderbook reconciliation, gas/fee preview, reputation/abuse controls and independent testnet receipts. Continue as stacked draft unless prior human acceptance gates pass; do not invent NFTs or sales.
