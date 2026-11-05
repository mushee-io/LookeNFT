# Looke NFT Marketplace

LookeNFT is an **Ultra EVM-only**, social-first NFT marketplace, inspired by VeryChat's simple integrated NFT Market. It will link to Looke Social but currently has **no live minting, listings, offers, purchases, fees or synthetic NFT records**.

## Networks

| Environment | Chain ID | RPC | Explorer |
| --- | ---: | --- | --- |
| Testnet (default) | 18881 | https://evm.test.ultra.eosusa.io | https://evmexplorer.testnet.ultra.io |
| Mainnet (NO-GO) | 19991 | https://evm.ultra.eosusa.io | https://evmexplorer.ultra.io |

Official network source: https://developers.ultra.io/tutorials/Ultra-EVM/Resources

## M2 setup

- Install Node 22+ and PostgreSQL 16+; create a separate database and least-privilege role.
- `npm install`; copy `.env.example` to `.env.local` and fill `DATABASE_URL` and `APP_ORIGIN`.
- Apply `db/migrations/001_m2_wallet_auth.sql` once with your database client.
- `npm run dev`; visit http://localhost:3000. Never put private key material into environment files.
- `npm run check` (requires PostgreSQL) runs types, unit/adversarial PostgreSQL integration tests and production build.
- Optional: configure public `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for WalletConnect v2 QR mobile pairing.
- Optional: configure `LOOKE_IDENTITY_PUBLIC_KEY_PEM` and `LOOKE_IDENTITY_ISSUER` only after Looke Social securely publishes issuer-signed wallet identity assertions with audience `lookenft`.

## Wallet-authentication model

1. User explicitly connects with EIP-1193/EIP-6963/WalletConnect.
2. User explicitly clicks **Sign in**. LookeNFT issues a short-lived EIP-4361-style message containing host, URI, chain ID, account, one-time nonce and expiry.
3. Wallet returns an EIP-191 personal signature; server verifies it against the exact persisted challenge (EOA accounts at this stage), consumes the nonce atomically in PostgreSQL and issues a 12-hour HttpOnly cookie.
4. Every authenticated route checks session expiration, revocation and the configured Ultra EVM chain; disconnect revokes the server token.
5. Browser reload silently queries `eth_accounts` only for an already-authorised provider and matches it with the existing server session. Account/network changes clear the UI auth state and revoke cookies.
6. Looke Social profile linking is **disabled without a real signed assertion issuer**. A display name or handle is not identity proof; verified JWTs are bound to the authenticated wallet, issuer, audience, expiry and unique jti.

**Not supported yet:** EIP-1271 contract-account sign-in; wallet execution; NFT ownership reads; real Looke Social SSO issuance; mainnet release. This code is testnet-first, not production identity sign-off.

Review [M1 evidence and missing acceptance](docs/M1_REVIEW.md), [M2 acceptance](docs/M2_ACCEPTANCE.md) and the [M1–M15 roadmap](docs/ROADMAP.md).
