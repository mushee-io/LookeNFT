# M6 — Secure creator media and metadata acceptance (NO-GO for live release)

## Exact inherited predecessor checks

| PR | Final predecessor commit | Automated evidence | Merge |
| --- | --- | --- | --- |
| #1 M1 | `4071364c7acf6d2a6f8d9f3332c55415b0143941` | CI green; genuine wallet/mobile evidence missing | Open draft |
| #2 M2 | `a9bdecef40a54bdea166f935e318f615a87fa277` | CI green; identity issuer and authenticated real wallets missing | Open draft |
| #3 M3 | `59cbcd92f1f4e2ea00330a331a469f7508d48e3c` | CI green; independent RPC/Blockscout, NFT indexer acceptance missing | Open draft |
| #4 M4 | `fc764929fae59825607a8a62817c9fa555fc75f0` | engineering CI green, no factory deployment/Cancun proof | Open draft |
| #5 M5 | `29bdf1c9ed3c8a876f98461667b6ef73af074700` | run `42142098301`: 27/27 app, 8/8 PG, 23/23 Solidity, build; **external source job failed** | Open draft |

M6 stacks strictly on M5. The older Blockscout historical block endpoint returned HTTP 404, and subsequent source checks failed; do not treat overall success (where source checks are continue-on-error) as actual blockchain acceptance.

No genuine wallet signatures, operator-backed PostgreSQL, independent security audit, Cloudinary/ClamAV/Pinata credentials, actual creator uploads, moderation decisions, hosted delivery proofs, IPFS CIDs, NFT metadata, verified Cancun MCOPY/PUSH0 Ultra EVM Testnet opcode support or external operator sign-off have been provided. The following is **implementation**, not live deployment.

## M6 implemented security boundaries

1. **Signed-in wallet only.** All creator routes require an M2 server-side, revocable wallet cookie session; they scope reads/writes by that exact wallet. State changes enforce same-origin JSON or bounded multipart upload requests. No browser-side Cloudinary or Pinata secrets. No private keys.
2. **Private uploads.** `POST /api/media/assets` checks session, CSRF origin, limited multipart fields, byte cap even if Content-Length is absent/falsified, per-format cap (images 5 MiB; videos 10 MiB), sniffed PNG/JPEG/WebP/MP4/WebM header versus claimed MIME and file extension, and per-wallet hourly quotas with PostgreSQL advisory lock. No SVG, HTML, PDF, ZIP or arbitrary asset URLs.
3. **Actual malware scanning required.** The adapter uses ClamAV INSTREAM over a configured private operator network socket. A scanner error, unavailability, positive detection, timeout or unexpected response blocks hosting. A clean result is evidence of the configured scanner at that time; it is **not** a code audit nor human content-safety review.
4. **Private Cloudinary quarantine.** The server-only Cloudinary REST adapter uses backend HTTP Basic authentication and explicitly uploads as `authenticated` delivery type under a server-generated random ID. Cloudinary response must match file size, resource kind, private type and assigned ID. No public media delivery URL is returned or cached. Hosting failures remain `upload_failed`; an interrupted operation may leave an orphaned private remote asset for manual cleanup.
5. **Real human moderation.** `GET/POST /api/media/moderation` requires a real signed-in operator wallet in `M6_MODERATOR_WALLETS`; a creator cannot self-approve. A reviewer must actually inspect authenticated media within the protected Cloudinary admin console, record evidence/reason and approve or reject. The DB records reviewer wallet, time and append-only-by-application review history. No mock moderator decisions, auto-approval, public viewing or trust in scanner results as offensive-content approval.
6. **Safe media pinning.** Only approved creator assets can be published to IPFS. Creators must resubmit the **same original file**, checked by byte size, MIME, SHA-256 and a second clean malware scan. Pinata JWT must exist and `M6_IPFS_PINNING_ENABLED=true`. Returned CIDs alone are insufficient: the operator-HTTPS gateway must independently return bytes with the exact original SHA-256 before `pin_state=verified`.
7. **Immutable versioned metadata drafts.** `POST /api/media/metadata` requires owned, approved, gateway-verified IPFS media and **real M3 registry approval** plus `owner()` on the Ultra EVM Testnet collection contract matching signed-in wallet. Input is allowlisted (name/description/simple traits only; limited size; no HTML/script/remote URLs). Canonical JSON and SHA-256 stored as new, uniquely versioned rows; not overwritten by retries.
8. **Metadata pinning and read-only reconciliation.** Pinata adapter uploads a canonical JSON file, confirms independent gateway byte hash, and stores the real CID. `POST /api/media/metadata/reconcile` reads the actual ERC-721 `tokenURI` or ERC-1155 `uri` at an RPC block and requires exact verified CID equality. ERC-1155 additionally requires an M3 indexed token transfer. `chain_matched` is *primary-RPC-only URI consistency*; it is **not** independently validated NFT ownership or proof of a mint/sale. No on-chain metadata update is broadcast.
9. **Creator UI and moderation queue.** `/studio` offers upload, approved-media repin, metadata draft/pin/reconcile flows and wallet-scoped records. `/studio/moderation` exposes protected review entries and evidence collection only to configured moderators. Neither page invents artwork, published URLs or approvals.

## Test/CI requirements

- Migration `db/migrations/004_m6_creator_media.sql` after migrations 001–003: real PostgreSQL 16 constraints for chain ID 18881, wallet ownership, private delivery, clean scan + human approval, pin witness, version uniqueness and URI evidence.
- `npm run test:media`: media signatures, size and content-type misrepresentation, hostile metadata, cross-origin/oversized upload, fail-closed service gates, and PostgreSQL negative constraints. All fixtures are **synthetic local bytes/records** and deleted; not media from external sources.
- Full `npm run check`: TypeScript, all M1–M6 unit tests, all PostgreSQL integration tests, production Next.js build.
- Full Solidity M1–M5 regression compilation, EIP-170/EIP-3860 bytecode limits and mint/security tests, **without deploying contracts**.
- External source sample remains separate and failed until real RPC/explorer reconciliation is possible. Any external provider evidence must be an actual source-backed response, never an inferred success.

## Exact operator blockers and fail-closed setup

```dotenv
M6_MEDIA_UPLOADS_ENABLED=false
M6_CLOUDINARY_CLOUD_NAME=
M6_CLOUDINARY_API_KEY=
M6_CLOUDINARY_API_SECRET=
M6_CLAMAV_HOST=
M6_CLAMAV_PORT=3310
M6_MODERATOR_WALLETS=
M6_IPFS_PINNING_ENABLED=false
M6_PINATA_JWT=
M6_IPFS_GATEWAY=
```

1. Operator must configure a *real* PostgreSQL connection and migration 004, Cloudinary authenticated storage, a reachable **private** ClamAV scanner, approved reviewer wallet(s) and validated production APP_ORIGIN. Test malicious files with the live scanner and perform an actual private upload/retention/recovery check before toggling uploads.
2. A human moderator must inspect each remote private asset in Cloudinary and make an actual signed-wallet moderation decision. Scanner clean != offensive-content safe.
3. Configure an actual Pinata token and independently controlled allowlisted HTTPS IPFS gateway; verify a real uploaded file and pinned JSON by SHA-256 before enabling pinning.
4. Ensure M3 indexer has a real registered NFT Testnet collection with independent chain evidence, then verify real on-chain collection ownership and tokenURI/uri against an actual metadata CID.
5. Conduct independent review of upload scanning protocol, private Cloudinary delivery, deletion/orphan cleanup, moderation powers, IPFS permanence, malicious polyglots and JWT/session isolation. Human 375/768/1440px screen checks.
6. Resolve all inherited real-wallet, Reown, trusted Looke identity, Blockscout 404, independent RPC, Cancun MCOPY/PUSH0 and security audit gates before any financial/public beta release. Do not merge M1–M6 until evidence and approvals are complete.

## What M6 does not claim

No scanned live files, hosted screenshots, IPFS pins, actual human reviews, testnet NFT metadata, audits or chain transactions were produced in this milestone. Cloudinary asset IDs remain private. Public image delivery, actual provider dashboards and independent NFT checks remain operator acceptance steps. All transaction/financial flags from M4/M5 stay disabled.

## M7 handoff

M7 can stack on M6 (draft only) to design NFT fixed-price listings, seller-signed listing authorisation, escrowless transfers, royalty display and wallet-confirmed purchases with UOS on Ultra EVM Testnet. Preserve existing security/identity/deployment gates and never invent sales or move funds without explicit user wallet confirmation.
