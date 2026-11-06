# LookeNFT M4 — Ultra EVM Testnet collection factory

**Scope:** collection-factory and creator-studio engineering only. This is a
stacked draft PR against M3; it is **not** a live chain deployment or launch.

## Verified predecessor status (6 Nov 2026)
- M1 PR #1 commit `4071364c7acf6d2a6f8d9f3332c55415b0143941`, GitHub run `42105369118` green.
- M2 PR #2 commit `a9bdecef40a54bdea166f935e318f615a87fa277`, run `42108864950` green.
- M3 PR #3 commit `59cbcd92f1f4e2ea00330a331a469f7508d48e3c`, engineering run `42115672497` green.
- All three PRs still draft and unmerged; manual mobile/desktop and wallet
  proof, Reown, trusted Looke issuer, production PostgreSQL, approved NFT
  contract registry and independent source evidence are missing.
- Ultra EVM Testnet primary RPC returned chain ID 18881 and block 61,298,255
  in M3's archived sample. Blockscout REST endpoint returned 404 for block
  61,298,243. Do not call independent explorer proof complete.
- No original security audit, completed wallet-signed transaction, or human
  sign-off is attached to this project.

## Cancun EVM compatibility gate

- Pinned OpenZeppelin 5.6.1 uses Cancun MCOPY instructions. This repository compiles for Cancun and its Hardhat VM simulates Cancun, but **Ultra EVM Testnet Cancun/MCOPY compatibility has not been independently verified**.
- **NO-GO** for any real Testnet deployment until operator proves MCOPY/PUSH0 execution on Ultra EVM Testnet with independent RPC/explorer evidence and records a human compatibility sign-off. Never infer support from chain ID 18881 or a local Hardhat test.
- The client and wallet provider additionally require an explicit `NEXT_PUBLIC_M4_CANCUN_VERIFIED=true` operator gate; default is false. This flag is an operator attestation, not proof by itself.

## M4 smart-contract design
- OpenZeppelin Contracts 5.6.1 pinned as an externally reviewed dependency;
  *our custom factory/collections have not been independently audited*.
- Deterministic `CREATE2` factory creates non-upgradeable creator-owned
  ERC-721 and ERC-1155 collections. Factory constructor explicitly refuses
  chain IDs other than **18881**. CI's Hardhat VM only emulates this chain ID;
  its transactions are **not** genuine Ultra EVM Testnet proofs.
- No privileged central factory administrator, fund custody, automatic wallet
  signing or protocol fee in this milestone.
- Factory salts are scoped by creator wallet. Used salts cannot be replayed
  across collections or token standards. Predicted addresses can be compared
  with emitted `CollectionCreated` events.
- ERC-721 lifetime max supply 1–1,000,000; ERC-1155 lifetime global and
  per-ID caps. Burning cannot replenish mint allowance. Only creator can
  call reserve mint, change allowed metadata until frozen, pause/unpause
  reserved mints, transfer ownership.
- ERC-2981 royalties up to 1,000 basis points (10%) are set at construction.
  Royalties are **signalling only**, not automatically enforced by other
  NFT marketplaces.
- `pauseMinting` suspends only reserved minting, **not peer-to-peer transfers**.
  This is intentional and must be reviewed before financial beta.
- Metadata bases can change by owner **until explicitly frozen**; do not
  claim immutable metadata before `freezeMetadata` is executed on chain.
- Reserve mint functions are creator-only local-test groundwork. M5 designs
  public/allowlist mint and mint pricing; M4 does not expose sales.

## Creator studio and explicit deployment consent
- The `/create` page collects standard, name/symbol (ERC-721), metadata URI,
  supply cap, per-ID cap (ERC-1155), royalty receiver/rate and random salt.
- It validates bounds, checks wallet/Testnet, queries preapproved factory code,
  factory identity, version 1, and deterministic collection address before any
  signing. Changing form/account/chain invalidates the review.
- **Default gate OFF:** `NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT=false` and
  `NEXT_PUBLIC_M4_FACTORY_ADDRESS` empty. No wallet transaction can occur
  without explicit operator action plus a user click and wallet confirmation.
- After any future real wallet-approved transaction, browser verifies status,
  creator/factory/calldata, emitted event, collection owner, bytecode and ERC
  interface against the primary Testnet RPC. Its JSON manifest is labelled
  **primary-RPC-only** until independently reconciled; it is not evidence
  of source-code verification or an external audit.

## Commands and evidence
- `npm install` (Node.js 22)
- `npm run contracts:compile` — local Solidity compile with pinned solc-js
  0.8.30 and optimizer/viaIR; no remote RPC or key.
- `npm run contracts:analyze` — writes
  `.artifacts/m4-compiled-bytecode.json`; verifies EIP-170 runtime and
  EIP-3860 initcode limits, contract hashes and library version.
- `npm run contracts:test` — Hardhat local-VM tests with a simulated chain ID
  18881, including salt, supply, ownership, royalties, receiver reverts,
  pause/freeze, invalid inputs and fast-check-generated properties.
- `npm run check` — existing Next.js/TypeScript and real ephemeral PostgreSQL
  integration tests. CI runs both suites separately.
- `NEXT_PUBLIC_ULTRA_NETWORK=testnet M4_FACTORY_ADDRESS=0x... M4_CREATION_TX_HASH=0x... M4_INDEPENDENT_RPC_URL=https://... npx tsx scripts/m4-verify-deployment.ts`
  — **read-only** reconciliation after a genuine authorised collection
  deployment. Requires two independent Testnet RPC providers, official
  Blockscout transaction evidence, correct deployed code, owner, ERC165 and
  receipt. On mismatch/API 404 it fails and produces no success manifest.

## M4 release and acceptance checklist
- [ ] Final exact-commit Solidity compile, size analysis, unit, property/fuzz,
  adversarial and integration tests GREEN.
- [ ] Final exact-commit Next.js/TypeScript/PostgreSQL regression GREEN.
- [ ] Verify custom code for semantic security, including CREATE2 runtime
  size, creator-only reserved minting, callback reentry, cap arithmetic, URI
  rules and royalty assumptions; independent review required.
- [ ] Human desktop/mobile creator-flow screenshots at 375/768/1440px.
- [ ] Independent Cancun opcode compatibility evidence (MCOPY and PUSH0) from Ultra EVM Testnet, signed by the operator.
- [ ] Operator approval for real Ultra EVM Testnet factory deployment (not
  provided), genuinely wallet-signed transaction and published explorer hash.
- [ ] Independently verify factory *deployed* bytecode against exact compiled
  artifact and get external source verification. Upstream OZ audit does not
  imply our custom code is audited.
- [ ] Operator configures `NEXT_PUBLIC_M4_FACTORY_ADDRESS` after independent
  Testnet deployment verification, and only then deliberately enables
  `NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT=true` in an authorised protected preview.
- [ ] Test creator wallet review, signature, factory receipt, predicted
  address, collection ownership, code, supply and ERC165 against independent
  RPC and explorer before a collection is considered deployed.
- [ ] M1/M2/M3 human acceptance and external source blockers resolved.
- [ ] Human security and operator review before any merge or public beta.
- [ ] Do not use real-wallet secrets, automated financial execution, mainnet
  transactions, or imaginary deployments to satisfy acceptance.

## M5 handoff
Implement safe public/allowlist minting and verified ownership with explicit
wallet approvals, pricing in UOS when authorised, safe mint failures, bounds,
event reconciliation and mint receipts. Do not expose unreviewed paid minting
or consider test fixtures as verified NFTs.
