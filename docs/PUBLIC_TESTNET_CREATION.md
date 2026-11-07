# LookeNFT — permissionless creator-owned Ultra EVM Testnet collections

Scope: self-service ERC-721/ERC-1155 **collection creation and preview listing** on Ultra EVM Testnet, chain ID **18881**. This supersedes the operator-only creator UI in the stacked PR branch, without changing the existing owner-only V3 factory or the human-reviewed M12 public-mint release gates.

## How it works
1. A visitor connects any EVM wallet, switches to Ultra EVM Testnet, signs into the existing replay-protected session, and supplies genuinely hosted metadata.
2. The browser verifies that the configured **permissionless V2** factory has deployed code and reports VERSION=2 before it requests a transaction. It computes the deterministic collection address, submits exactly the allowed factory call with `eth_sendTransaction`, and checks receipt success, code and factory registration.
3. After **12 blocks**, `POST /api/creator/collections` verifies authenticated creator = receipt sender = `CollectionCreated.creator` = current collection owner, the approved factory, version, chain, emitted contract address, bytecode, ERC-165 interface, and canonical indexer checkpoint.
4. The endpoint writes a real indexed collection and a publicly visible Testnet preview with **mint_enabled=false**. It never mints, sells, funds, creates placeholder tokens, or changes mainnet.
5. The curated operator API remains separate for official publisher responsibilities; public creator listings must not show an official/audited badge.

## Non-negotiable prerequisites
- Set `NEXT_PUBLIC_M4_FACTORY_ADDRESS` to a **real deployed and independently verified V2 permissionless factory**, not the owner-only V3. Merely changing frontend text cannot remove `onlyOwner` from V3.
- Obtain genuine Ultra Cancun/MCOPY evidence; set `NEXT_PUBLIC_M4_CANCUN_VERIFIED=true` only once independently checked.
- Enable `NEXT_PUBLIC_M4_ENABLE_DEPLOYMENT=true` **only** once public factory bytecode, wallet approval and chain-ID tests are confirmed. No private key, backend signing or automatic wallet action.
- Apply all existing database migrations through `011_curated_mint_catalog.sql` and configure PostgreSQL; users' own Testnet deployments still cost wallet-signed gas.
- Keep `NEXT_PUBLIC_M5_ENABLE_MINTING`, `M12_FINAL_FINANCIAL_EXECUTION_ENABLED` and `M12_FINAL_PUBLIC_BETA_ENABLED` false unless independently approved. A catalogue listing is not an open mint, financial execution, or mainnet launch.

## Test expectations
Run `npm run typecheck`, `npm run test`, `npm run contracts:compile` and `npm run contracts:test`. V2 Solidity tests already prove independent wallets can create collections and own their deployments. This change adds coverage of the new registration route's proof requirements and cover-host restrictions. End-to-end hosted database, independent RPC and wallet acceptance are still required before enabling deployment; none is fabricated here.
