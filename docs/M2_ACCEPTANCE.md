# M2 — Signed wallet sessions, mobile pairing, Looke identity

## Implemented engineering scope
- Single React wallet-session provider; EIP-1193 injected providers and EIP-6963 discovery.
- App-level disconnect, account/chain listeners, reconnect only to previously authorised `eth_accounts`; no silent wallet signatures.
- Optional WalletConnect v2 QR pairing when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is configured.
- Explicit EIP-191 sign-in message including exact application origin, wallet, Ultra EVM chain, 36-character nonce and five-minute expiry.
- PostgreSQL-backed nonce storage using SHA-256 hashes; row-locked single use and rate-limited issue/verification.
- Atomic 12-hour sessions: opaque tokens with only SHA-256 hashes in SQL; HttpOnly, SameSite cookies, Secure on HTTPS production.
- Origin + JSON content-type checks on every state-changing authentication endpoint; bounded input size and parameterized SQL.
- Looke profile linking requires an EdDSA JWT from the separately configured trusted Looke Social issuer, bound to the exact signed-in wallet, unique profile and one-use jti. No self-claimed handles.
- PostgreSQL migration, unit/adversarial integration tests and GitHub Actions with actual PostgreSQL.

## Verification / release gates
- [ ] M2 final-commit CI typecheck, unit, PostgreSQL integration and production build green.
- [ ] Real desktop Testnet EVM wallet pairing + account-switch + signed login.
- [ ] Real mobile injection/WalletConnect QR pairing with operator-provided Project ID.
- [ ] Deployed PostgreSQL URL and schema provisioned with minimum-privilege credentials.
- [ ] HTTPS APP_ORIGIN set in release environment; inspect cookies in browser.
- [ ] Looke Social identity issuer PEM and issuer configured before calling profile linking operational.
- [ ] Human security review and authenticated cross-browser acceptance.
- [ ] M1 manual acceptance gates closed before any M1 merge.
- [ ] No mainnet release or on-chain financial execution.

## Known source/credential blockers
No live PostgreSQL instance, Reown Project ID, signed Looke Social issuer key or authorised real-wallet test session has been supplied. CI's ephemeral PostgreSQL verifies implementation behaviour but does not constitute production integration.

## M3 handoff
Build read-only ERC-721/1155 event indexer with finalized cursors, reorg rollback and independent Ultra EVM ownership checks. Do not invent NFTs, prices, volume or wallet signatures.
