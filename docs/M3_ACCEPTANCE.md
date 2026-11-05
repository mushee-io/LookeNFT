# LookeNFT M3 — Ultra EVM NFT discovery and canonical indexer

## Inherited release gates — remain open

M1 PR #1 final commit `4071364c7acf6d2a6f8d9f3332c55415b0143941`
passed CI run `42105369118`, but no human responsive UI walkthrough or
real Ultra EVM Testnet wallet evidence is provided. M2 PR #2 final commit
`a9bdecef40a54bdea166f935e318f615a87fa277` passed CI run
`42108864950`, but real desktop/mobile wallet signing, production database,
Reown Project ID, trusted Looke Social identity issuer and human security review
are unverified. Both predecessor PRs remain drafts and unmerged.

## M3 engineering scope

- Ultra EVM Testnet (18881) only. Default 12 confirmations, max 25 blocks/step.
- Operator-only collection registry: deployed bytecode + ERC-165 NFT interface check;
  NOT an assertion of audited or verified source code.
- Real ERC-721 Transfer, ERC-1155 TransferSingle and TransferBatch log decoding.
- PostgreSQL canonical block journal, saved parent hash, singleton cursor and
  transactional advisory locks, deduplication and rollback of orphan events.
- ERC-721 latest-transfer owner and ERC-1155 signed balance sums from observed
  canonical events, limited to approved collections and configured start height.
- Real collection/token/ownership/activity read-only API, honest no-coverage and
  unavailable-source messages; no synthetic NFTs, sales, prices or volume.
- Constrained HTTPS/IPFS on-chain metadata reads; operator-allowlisted hosts,
  content size caps, no redirects or untrusted URI fetching.
- Read-only comparison CLI checks PostgreSQL block/events against primary RPC,
  independently hosted RPC, and official Ultra EVM Testnet Blockscout block hash.
- Synthetic adversarial test fixtures run on an actual ephemeral PostgreSQL 16
  instance; fixtures are NOT actual Ultra blockchain activity.

## Evidence and acceptance

- [ ] M3 final exact-commit CI green: TypeScript, unit, PostgreSQL integration,
  reorg and adversarial tests, and Next.js production build.
- [ ] External-source health sample real RPC/explorer checked or blocker recorded.
- [ ] Operator identifies a real ERC-721/1155 Testnet contract + deployment block.
- [ ] Operator registers and scans real contract events without sample records.
- [ ] Independent RPC and Blockscout agreement on block hashes and token events.
- [ ] Verify actual ownerOf/balanceOf against finalized on-chain state for
  representative ERC-721 and ERC-1155 holdings (additional human/operator gate).
- [ ] Validate real NFT tokenURI/uri data against allowlisted gateway.
- [ ] Human UI walkthrough at mobile/tablet/desktop widths.
- [ ] M1/M2 outstanding wallet, identity and operator permissions signed off.
- [ ] Human security review before merge/public beta.

## External blockers

No actual Ultra EVM Testnet NFT deployment address and its block are supplied,
so the operator registration cannot be executed honestly. No separate independent
RPC URL, operator-backed PostgreSQL instance, wallet sessions, Reown Project ID
or Looke Social identity issuer are available in this task. A CI local Postgres
fixture is not a production data source.

## Operator release procedure

1. Deploy/provision PostgreSQL 16 with least privilege and migrations 001 then 002.
2. Run `npm run indexer:register` with real Testnet contract, standard and actual
   deployment block. Do not register synthetic test addresses.
3. Set `NEXT_PUBLIC_ULTRA_NETWORK=testnet` and `NFT_START_BLOCK` <= earliest
   registry deployment block. Run `npm run indexer:once` for bounded sync.
4. Supply independent HTTPS `NFT_INDEPENDENT_RPC_URL` and run
   `npm run indexer:verify`. Unavailable or mismatched sources must fail.
5. For historical additions, run the explicit operator-only reindex command;
   it deletes indexed blocks/events/cursor, preserving the approved registry.
6. Resolve M1/M2 inherited gates before approving M3 PR for merge or any release.

## Handoff M4

Design audited-standard ERC-721/ERC-1155 collection factory and wallet-approved
Testnet deployments. NO contracts are deployed or financial actions executed by M3.
