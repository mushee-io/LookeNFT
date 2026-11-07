# LookeNFT — open NFT creation on Ultra EVM Testnet

**Anyone with a compatible EVM wallet can create and mint their own NFT on chain ID 18881. No admin wallet, approved deployment factory, paid platform fee, private key, or special permissions are required.**

## Simple creator flow
1. Connect a wallet to **Ultra EVM Testnet (18881)** at `/create`.
2. Enter the collection name, metadata IPFS base URI, supply and artwork cover. Use ERC-721 for unique NFTs or ERC-1155 for editions.
3. Click **Preview collection**, then **Deploy collection (wallet approval)**. The creator approves a direct contract-creation transaction. The wallet pays only normal Testnet gas.
4. After the confirmed deployment, click **Mint NFT #1 to my wallet (free)**. The owner approves one additional zero-value Testnet transaction. For ERC-721, the first sequential token is #1; ERC-1155 mints one unit of ID #1.
5. Optionally **Sign in** with the creator's wallet and click **List Testnet collection**. The server checks the successful contract-creation receipt, originating wallet, NFT standard, contract bytecode, and current contract ownership before saving a genuine catalogue entry.

Metadata is hosted separately, e.g. `ipfs://YOUR_METADATA_CID/metadata/` for ERC-721 tokens with filenames `1`, `2`, etc. Local artwork uploads are only for preview and do not automatically pin files to IPFS.

## Implementation
- `scripts/export-direct-nft-artifacts.cjs` compiles the existing creator-owned `Looke721Collection` and `Looke1155Collection` using pinned solc 0.8.30 with **Cancun** bytecode, required by the installed OpenZeppelin 5.6.1 dependency (which uses MCOPY). A successful build alone does not prove chain support; each creator must approve and confirm a genuine on-chain Testnet transaction. It runs as `npm prebuild` and writes public creator deployment artifacts.
- `app/create/page.tsx` uses `encodeDeployData` and the two local artifacts for a direct wallet deployment, checks the receipt and ownership and allows a separate free creator reserve mint.
- `components/WalletSessionProvider.tsx` restricts the wallet transaction methods to **chain 18881** with `value: 0`. A real wallet must explicitly approve each transaction.
- `app/api/creator/collections/route.ts` registers only genuine direct wallet contract creations, authenticated by the current creator, with an NFT interface and matching owner; no factory or admin key.
- Public paid minting, marketplace trading, funds handling and mainnet transactions remain disabled. Creator reserve mint is separate and nonpayable.

## What is not claimed
Code changes alone do not create on-chain transactions. The creator must still connect their wallet, have some Testnet gas, and approve the deployment and reserve mint. Successful local CI does not prove actual Ultra EVM Testnet RPC compatibility. No on-chain contract was deployed by this change.

## Deploying the website
The previous draft PR stack has not been merged to `main`, so this feature is not automatically live on the public URL. Deploy this branch only after CI passes and Vercel integration is available. No private key or admin factory environment variable is needed for **direct Testnet collection creation**. Configure the existing PostgreSQL migrations and authentication to enable optional catalogue listing.
