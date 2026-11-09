# M1 — Ultra EVM marketplace foundation acceptance

## Delivered in this PR
- [x] Next.js 16 App Router + TypeScript scaffold and responsive UI.
- [x] Landing page, Explore, Creator Studio, My NFTs, Activity navigation.
- [x] Ultra EVM network definitions verified against official docs: testnet 18881, mainnet 19991.
- [x] EIP-1193 browser-wallet Connect, wallet switch/add flow and account listener.
- [x] Explicit zero-state for real inventory and disabled on-chain execution.
- [x] CI quality workflow and basic no-fake-data checks.
- [x] Ultra EVM-only boundaries and future milestone plan.

## Required verification before marking M1 complete
- [ ] GitHub Actions typecheck, smoke tests, production build pass on final commit.
- [ ] Human UI check at desktop and mobile widths.
- [ ] Human wallet check with a real EIP-1193 wallet on Ultra EVM Testnet.
- [ ] Verify original deployment permissions before any Vercel preview release.
- [ ] Review PR diff and merge only after checks pass.

## Explicitly not delivered in M1
No signed mints, no deployed marketplace, no on-chain bids, no collection registration, no indexing, no social integration, no production release.
