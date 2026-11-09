# LookeNFT M7 — Ultra EVM Testnet signed fixed-price marketplace

**Engineering only. Actual listings, ERC721/1155 transfers and UOS settlement are OFF by default.** This is a stacked, unmerged draft PR against M6. No contracts, signatures, listings, mints, transfers or transactions have been executed on Ultra EVM Testnet in M7. This custom settlement contract has **not been independently audited**.

## Exact predecessor verification — 6 November 2026

- M1 draft PR #1 `4071364c7acf6d2a6f8d9f3332c55415b0143941`, unmerged; real wallet/desktop/mobile acceptance outstanding.
- M2 draft PR #2 `a9bdecef40a54bdea166f935e318f615a87fa277`, unmerged; Reown mobile wallet, trusted Looke identity issuer, signed-login/production Postgres verification outstanding.
- M3 draft PR #3 `59cbcd92f1f4e2ea00330a331a469f7508d48e3c`, unmerged; approved deployed NFT registry, independent RPC and Blockscout historical HTTP 404 outstanding.
- M4 draft PR #4 `fc764929fae59825607a8a62817c9fa555fc75f0`, unmerged; real factory and Cancun MCOPY/PUSH0 opcode compatibility proof and independent audit outstanding.
- M5 draft PR #5 `29bdf1c9ed3c8a876f98461667b6ef73af074700`, unmerged; real minting and explicit-wallet acceptance missing.
- M6 draft PR #6 `cb800b98b890a02b9185a72f180da25c2910d395`, unmerged. Final CI `42146303816`: 34/34 unit tests, 10/10 PostgreSQL 16 integration tests, 23/23 Hardhat Solidity tests, TypeScript/Next.js build passed; independent source job failed (Blockscout 404).
- No predecessor PR was merged, deployed or marked accepted. Every inherited external-source/operator gate remains NO-GO.

## Contract and signed order model

`contracts/LookeFixedPriceMarket.sol` is a non-upgradeable, non-custodial, single-market, EIP-712 domain-bound settlement contract. Constructor rejects chains other than Ultra EVM Testnet **18881**. It has no operator changeable admin fees, no custody, no escrow, no sweep or arbitrary withdrawal. Treasury (feeRecipient) is immutable and set only when a future independently approved factory deployment is authorised.

- 200 bps (2%) fixed platform fee paid to immutable feeRecipient; seller explicitly signs max allowed fee and minimum seller proceeds. ERC-2981 `royaltyInfo` is checked per-token at execution; seller signs maximum royalty bps (0–1000), recipient and amount are emitted in receipt. Royalties are signalled by NFT contracts; Looke market settlement enforces its calculated payout only when actually executed.
- Seller signs exact EIP-712 terms: seller, collection, tokenId, quantity, **UOS Wei per item**, seller nonce, deadline, optionally reserved buyer, minimum seller proceeds, maximum fee bps, maximum royalty bps and ERC standard. Domain binds exact chain ID **18881** and exact marketplace contract address. EOA signatures and OZ SignatureChecker / EIP-1271 contract-wallet signatures are supported by *the Solidity contract*; initial server registration admits EOA signatures only pending a dedicated account-abstraction acceptance gate.
- Seller can `cancelNonce` or `raiseMinimumNonce` via explicit wallet-approved transactions. Cancellation and filled order both invalidate seller-specific nonce; a successful fill cannot be replayed. No arbitrary third party may cancel a seller's nonce.
- At execution, NFT contract must report ERC-721 or ERC-1155 interface; seller must still own token / hold the full ERC-1155 quantity and **explicitly** have approved Looke market as operator. Full-order quantity only; ERC-721 = 1, ERC-1155 <= 1000. No automatic on-chain NFT approvals are sent by the app. A stale database listing is **not** on-chain authorisation.
- Buyer cannot buy their own listing. Reserved buyer must match. Caller must send **exact** UOS cost, no refunds or hidden price changes. No transaction exceeds 1000 UOS, and listing lifetime max 90 days (deadline).
- `buy` is `nonReentrant`. It consumes the seller nonce before the NFT receiver callback, transfers NFT directly from seller to buyer and then sends seller proceeds, fee and royalty. Failed transfer or native payout reverts the **entire EVM transaction**: NFT transfer, consumed nonce and payment. Contract retains zero UOS after successful sales; any unsolicited native transfers are not supported.

## Listing registration and UI

- `/market`: creator forms and signer preview, read-only signed-order discovery, live quote/ownership verification, buyer review and disabled-by-default wallet actions.
- Seller auth requires M2 signed-in wallet session; server checks origin CSRF, allowed exact fields, EOA EIP712 signature, Testnet RPC and M7 contract VERSION 1, on-chain order digest, M3 registry, on-chain seller ownership/approval, expiry and nonce validity. Server stores a **candidate**, not a confirmed active listing; API must never invent orders.
- A separate EIP-712 `eth_signTypedData_v4` user approval is required before signing. For a sale, buyer explicitly rechecks same signed listing, network/account and session, market code/version, current fillability, exact fee/royalty split, then simulates the transaction and requires `eth_sendTransaction` wallet confirmation.
- Submitted transaction hash is **not** a sale. Primary RPC receipt/ListingFilled evidence is labelled primary-only; the buyer's UI cannot issue independent audit approval. Seller cancellation also requires separate wallet approval and primary receipt.
- No developer private key, client-side auto-approval, user funds transfer or synthetic NFT activity.

## PostgreSQL and independent receipt evidence

- Apply `db/migrations/005_m7_fixed_price_listings.sql` after 001–004. Signed candidates constrained by 18881 chain, original M3 approved registry FK, unique marketplace/seller/nonce and EIP712 hash; explicit `unverified_candidate` state. No signed candidate or trade is seeded.
- `nft_m7_verified_settlements` has immutable-by-policy tx/log identity, unique order hash, exact UOS proceeds split and source-provider references. No sale becomes `filled_verified` from the client.
- `npm run market:verify` is a **read-only, operator-only verifier after a genuine user-approved Ultra Testnet purchase**. Requires real `M7_MARKET_ADDRESS`, `M7_SALE_TX_HASH`, `M7_INDEPENDENT_RPC_URL`; both independent chain-18881 RPCs must agree on successful receipt/12-block finality/block hash and deployed market bytecode/version. Official Blockscout must agree on status, tx hash and block. Script decodes actual `buy` calldata, checks source-backed EIP712 digest, signed candidate, NFT delivery event, receipt-block ERC721 ownership or ERC1155 balance, and exact UOS fee+royalty+seller proceeds before an idempotent (conflict-rejecting) SQL transaction inserts the verified sale. Any HTTP 404, divergent evidence, missing wallet signature, missing NFT proof or duplicate fails without a fake record.
- Real M3 independent token indexer, Reown mobile wallets, creator moderation, Cloudinary/ClamAV/Pinata source evidence, production PostgreSQL and signed human reviews remain external requirements.

## Default-off operator configuration

```dotenv
NEXT_PUBLIC_M7_ENABLE_LISTINGS=false
M7_LISTINGS_ENABLED=false
NEXT_PUBLIC_M7_ENABLE_SETTLEMENT=false
NEXT_PUBLIC_M7_ENABLE_CANCELLATION=false
NEXT_PUBLIC_M7_MARKET_ADDRESS=
M7_MARKET_ADDRESS=
M7_SALE_TX_HASH=
M7_INDEPENDENT_RPC_URL=
NEXT_PUBLIC_M4_CANCUN_VERIFIED=false
```

The front-end cannot silently turn real buying on: all public M7 flags are false/market address empty; server registration separately checks private listing flag; actual financial signing/broadcast needs exact user clicks and wallet confirmation. **Flags themselves are not proof**. They must be set only after real chain/opcode compatibility, independent custom Solidity audit, signed operator approval and wallet acceptance. No mainnet config or automatic deploy script is included.

## Engineering acceptance

- [ ] Final exact M7 head TypeScript / M1–M7 unit, real ephemeral PostgreSQL, full Next production build passed.
- [ ] Final exact head Hardhat pinned Solidity, EIP170 runtime/EIP3860 initcode, fuzz/property and signature/nonce/cancel/escrowless transfer/royalty/payout rollback tests passed; compiled artifacts only, not onchain evidence.
- [ ] Independently verify custom sale code against audited OpenZeppelin dependency, fee calculation, settlement atomicity, malicious recipients, ERC1155 callbacks, EIP1271/reentrancy, unusual ERC721/1155 behavior and royaltyInfo reverts.
- [ ] Genuine M7 marketplace constructor deployment & independently published source on Ultra Testnet; authorised contract immutable feeRecipient and actual ERC2981 quotes.
- [ ] Real seller EIP712 signatures, proper NFT approval and a wallet-owned asset in real M3 registry, cancellation and expiry adversarial checks on chain.
- [ ] Real buyer wallet confirmation for UOS purchase, independent explorer/second RPC receipt, 12-block canonical confirmation and unchanged owner/balance proof; actual accounting witnesses.
- [ ] Actual human mobile/tablet/desktop 375/768/1440px UI acceptance, operator audit and protected rollback rehearsal.
- [ ] Resolve M1–M6 human wallets/Reown/issuer/database/Cloudinary/ClamAV/Pinata/IPFS/Blockscout 404/MCOPY and independent security blockers before PR merge or beta.

## M8 handoff (engineering only)

Build NFT bids/offers with cancellable seller/buyer EIP712 intent, bounded expiry and nonce, collateral-safe funding design, safe rejection of stale orders and explicit wallet confirmation. Continue Testnet only. Do not enable any live NFT transfers, treasury settings, mainnet deployment or public beta until the above release gates are satisfied.
