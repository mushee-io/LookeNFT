# Looke NFT Marketplace

LookeNFT is the **Ultra EVM-only** NFT marketplace that will integrate with Looke Social. It takes inspiration from VeryChat's simple in-app NFT Market without copying their assets or contract implementations.

**Current stage: M1 foundation.** No NFT or marketplace smart contracts are deployed by this project, and no minting, offers, purchases, fees, royalties or burn operations are active. No collections or trading activity are fabricated.

## Ultra EVM networks

| Environment | Chain ID | RPC | Explorer |
| --- | ---: | --- | --- |
| Testnet (default) | 18881 | https://evm.test.ultra.eosusa.io | https://evmexplorer.testnet.ultra.io |
| Mainnet (opt-in config only) | 19991 | https://evm.ultra.eosusa.io | https://evmexplorer.ultra.io |

Source: https://developers.ultra.io/tutorials/Ultra-EVM/Resources

**Scope:** EVM accounts and smart contracts only for initial delivery. Ultra Native accounts/Uniqs, Base, BNB and other chains are out of scope.

## Run locally

1. Install Node.js 22+ and npm.
2. Run npm install.
3. Copy .env.example to .env.local (testnet default).
4. Run npm run dev and open http://localhost:3000.
5. Run npm run check before merging (typecheck, smoke tests, production build).

## Security and product gates

- Wallet uses EIP-1193 requests only after an explicit Connect click. No private keys, seed phrases, custody or on-chain transactions.
- If needed, wallet network selection requests an explicit user-approved switch.
- Never change to mainnet solely by setting an environment variable; M15 requires independent audit, operator sign-off and deployment gates.
- Only real on-chain proof should populate listings, NFTs, sales, balances, charts or volume.
- Fixed-price and offers, protocol fees, burn mechanics and royalties are proposals until separately specified, implemented and reviewed.

See [M1–M15 detailed roadmap](docs/ROADMAP.md) and [M1 acceptance checklist](docs/M1_ACCEPTANCE.md).
