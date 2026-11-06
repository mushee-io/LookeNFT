# LookeNFT curated mint-gallery release plan

## Public experience
Visitors see a branded landing, official published collection cards, collection preview pages and a wallet-signed mint flow only when enabled. No public Create, Studio, listings, orderbook, bids, trading, social or activity navigation. Collection inventory and sales must not be fabricated.

## Administrator
- An operator signs in with `LOOKE_NFT_OPERATOR_WALLET` on Ultra EVM Testnet (18881).
- The backend allows this wallet alone to register and publish a collection via `/admin`. Unknown wallets get HTTP 403; unset admin config fails closed.
- Register requires canonical database/indexer registration, live deployed bytecode, ERC-165 standard, V3 owner-restricted factory registration and live ownership of both factory and collection by the configured wallet.
- Register starts as private **draft**; publish exposes a **preview**; open mint requires extra per-drop flag and all global M12/M5 release gates.
- Approval of media is still independent; operator cannot self-moderate their uploaded assets.
- Cover images are optional and only permitted on hostnames in `LOOKE_NFT_COVER_HOSTS`.
- No seed collections or fictional volumes are inserted.

## Before usable publication
1. Run migrations 001–011 against an authorised PostgreSQL instance. Back up first.
2. Independently review, deploy and verify `LookeOwnerCollectionFactory` V3 on Ultra Testnet with the operator wallet. V3 uses `onlyOwner` for both ERC721 and ERC1155 creation. No private keys are stored or used by this site.
3. Configure `DATABASE_URL`, `APP_ORIGIN`, `LOOKE_NFT_OPERATOR_WALLET`, `LOOKE_NFT_OWNER_FACTORY_ADDRESS`, and `LOOKE_NFT_COVER_HOSTS` in Vercel. Set the public M4/M5 factory address to the same V3 address only after independent verification.
4. Create a collection through separately wallet-approved on-chain operator tooling. Register the genuine contract in the canonical indexer, then use `/admin` to create a curated draft, publish its public preview and later toggle minting only after security sign-off.
5. Keep `NEXT_PUBLIC_M5_ENABLE_MINTING=false`, `M12_FINAL_FINANCIAL_EXECUTION_ENABLED=false`, `M12_FINAL_PUBLIC_BETA_ENABLED=false` until the required human/independent tests are complete.

## Security limitation
The **legacy V2 factory is permissionless and cannot be retroactively made owner-only**. V3 is a new contract, currently only source code and tests. It must not be represented as deployed or audited. A third party may deploy NFT contracts outside the LookeNFT factory; the LookeNFT website only publishes a verifiable operator-owned allowlist. UI hiding is not a substitute for contract ownership checks.

## Database and deployment
This migration adds only `looke_curated_collections` and no data. Without DATABASE_URL/migration, the public gallery safely shows no configured drops and user minting is unavailable. Do not change automatic release gates merely to populate the UI; maintain the previous M12 NO-GO. All earlier draft PRs remain unmerged.
