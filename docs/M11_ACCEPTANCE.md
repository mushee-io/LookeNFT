# LookeNFT M11 — Real Integration Source Security & Operator Acceptance

**State: engineering draft; real-world source acceptance and financial launch remain NO-GO. M12 is the FINAL milestone.**

## Verifications performed at the start of M11

Every predecessor **PR #1–#10** was retrieved from GitHub and found `open=true`, `draft=true`, `merged=false`. Exact heads:

| PR | Commit |
|---|---|
| #1 | `4071364c7acf6d2a6f8d9f3332c55415b0143941` |
| #2 | `a9bdecef40a54bdea166f935e318f615a87fa277` |
| #3 | `59cbcd92f1f4e2ea00330a331a469f7508d48e3c` |
| #4 | `fc764929fae59825607a8a62817c9fa555fc75f0` |
| #5 | `29bdf1c9ed3c8a876f98461667b6ef73af074700` |
| #6 | `cb800b98b890a02b9185a72f180da25c2910d395` |
| #7 | `8497461068383c5527bebe3c04e5a14e55dc7573` |
| #8 | `d7127522753ee4c4095168fb34c46e3d0204598f` |
| #9 | `ff0f0485212dc375aae5d9f9c2282bba7be9e615` |
| #10 | `6656d95e9998908b2e2b6641b134c97702f9c329` |

M10 final Actions **42158334711** passed **60/60 application tests**, **18/18 real ephemeral PostgreSQL tests**, **40/40 local Solidity tests**, TypeScript, Next production build and seven contract bytecode size limits. Its **external-source job failed** (official Blockscout Testnet HTTP 404). Overall green CI was obtained because this job is `continue-on-error`; it is NOT independent live-chain acceptance.

The real independent Looke Social source `mushee-io/looke` commit `958e56c7bdd6f95fed30791e833cad9966eafed1` has authentic wallet login, source SQL profiles, posts and moderation, **but no compatible signed EdDSA M2/M10 portable identity or Social assertion issuers**. The M11 JWT consumer is a verification interface only. No connected real users, moderation, signed JWT issuer, follow graph or live Social evidence is claimed.

## M11 acceptance/security architecture

1. **Signed revocation and replay control.** `lib/m11/source.ts` accepts only genuine pinned EdDSA JWTs from authorised Looke Social issuer, `aud:lookenft-revocation`, chain 18881, source commit and subject-wallet match, unique JTI and <=60-second lifespan. Operator-only `npm run m11:revocation` is default-OFF, consumes a signed source JWT, stores a monotonic revocation, revokes M2 local wallet sessions and pending auth challenges, deletes M2 profile link (which cascades public M10 profile/posts/avatar/holder links), and prevents any new Social import without an independently signed human recovery procedure. Replaying a revocation fails. **A local wallet login is not social account permission.**
2. **Viewer-specific moderated visibility.** Signed `aud:lookenft-visibility`, action `view_profile`, viewer wallet, subject wallet, checked-at time and policy `allowed/blocked_by_viewer/blocked_by_subject/muted_by_viewer/hidden`. `POST /api/social/visibility` authenticates the exact viewer, verifies issuer, consumes a one-use signed policy JTI in PostgreSQL, checks revocations, and returns an approved subject only if source explicitly allows. The M10 broad public directory is **hard-disabled**, even if old public directory flag is set. No global list without reliable viewer-specific blocking and moderation.
3. **Operator acceptance.** `POST /api/acceptance` accepts *only* an externally reviewed EdDSA assertion `aud:lookenft-m11-evidence`, addressed to an explicitly configured human operator wallet, including evidence type, real HTTPS source URL, SHA256, observation time, and one-time reviewer JTI. `nft_m11_evidence_candidates` enforces status `submitted_unverified` by SQL CHECK and never exposes an auto-approve/update endpoint. `GET /api/acceptance` and `/acceptance` require an actual M2 Testnet wallet session that matches operator allowlist; all gates remain false regardless of candidate count. No evidence is presumed real merely by a valid JWT or submission.
4. **NFT + metadata owner rechecking.** `lib/m11/nft.ts` is an operator-only Testnet read-only rechecker. Requires the real M3 approved ERC721/1155 contract, recent canonical indexer block, two separate real Testnet RPC witnesses with chain 18881 and >=12 confirmations, matching runtime bytecode/ERC165 and ERC721 `ownerOf` or positive ERC1155 `balanceOf`, independent official Blockscout block hash (HTTP 404 must be fixed), actual M6 moderator-approved ClamAV-clean Pinata CID, signed media evidence, chain-matched `tokenURI`/`uri` and byte-exact IPFS JSON SHA256 at operator-approved HTTPS gateway. Any missing source -> reject; no fake balances or visible user tokens. NFT owner status is a historical checkpoint with <=5-minute TTL, not an indefinite present ownership claim.
5. **Source-backed media inventory.** `lib/m11/media.ts` checks internal real M6 creator-owned Cloudinary authenticated asset ID, ClamAV clean scan evidence hash, pinned Pinata CID, human moderation event/approved state. Any missing/mismatched record blocks. Optional storage in `nft_m11_media_witness_checks` is always `candidate_unverified`, NEVER audit completion. Cross-provider authenticated source assertions still require actual operators/provider credentials; the code does not synthesize those or claim a genuine independent scan from a database row.
6. **Real CI PostgreSQL restore / rollback.** `npm run m11:restore-rehearsal` (opt-in CI only) uses PostgreSQL native `pg_dump`, `createdb`, `pg_restore`, isolated scratch clone, compares all `nft_*` table row counts plus total public constraints, performs a synthetic session insert and `ROLLBACK` in the scratch copy, verifies scratch/source unchanged, then drops scratch DB and backup. Strictly refuses non-local connection, wrong database or absent opt-in flag. **This is a real ephemeral LOCAL rehearsal, not operator production recovery acceptance**. Actual production backup encryption, RPO/RTO, access controls, rollback signatures and protected Vercel alias recovery must be evidenced independently in M12.
7. **Adversarial tests.** Only CI-local synthetic signed Ed25519 keys/tokens and deterministic/mocked NFT witnesses; nothing signed with a real user key. Signed JWT issuer/audience/chain/expiry/tamper, revoked session and identity purge, cross-wallet viewer policy and one-time token, blocked profile non-disclosure, evidence never auto-approving, unsafe media/CID/metadata mismatch, and actual ephemeral PostgreSQL uniqueness, FK and rollback. Existing 40 Solidity tests and bytecode gates rerun unchanged.
8. **No financial pathway changes.** All M4/M5/M7/M8 wallet-transaction controls, M9 event scanner, M10 Social sync, M11 evidence source operations, mainnet and public beta remain OFF. Test-only proofs cannot be used as registry entries or real social profiles. PRs #1–#10 remain drafts/unmerged.

## Critical missing operator evidence (18 explicit NO-GO categories)

| Gate | Required real-world proof |
|---|---|
| `looke_m2_issuer` | Authorised real Looke Social M2 `aud:lookenft` EdDSA source, wallet-session binding, trusted key rotation/revocation |
| `looke_m10_issuer` | Compatible `aud:lookenft-social-proof` signer reading current Social SQL profile, posts and moderation |
| `social_revocation` | Genuine signed account suspension/delete, emergency recovery and time-bound propagation |
| `blocked_viewer_policy` | Server-side issued, signed source current viewer↔subject block/mute/visibility and human oversight |
| `reown_mobile` | Genuine mobile wallet pairing, Testnet 18881 auth, sign-in, logout/re-auth and loss of device |
| `reown_desktop` | Windows desktop Reown pairing, browser extension, 375/768/1440px UX and wallet-signed acceptance |
| `operator_postgres_restore` | Real operator SQL credentials, 9 migrations, full backup restore, 1:1 rows/FKs, RPO/RTO/security signoff |
| `protected_rollback` | Genuine protected Vercel alias, version pinning, DB migration rollback, signed operator record |
| `cloudinary_delivery` | Genuine authenticated hosted image/video and hashed provider-returned bytes |
| `clamav_scan` | Actual ClamAV INSTREAM scan log and independent engine version/checksum |
| `pinata_cid` | Real Pinata pin receipt/CID independently resolved, byte-exact expected metadata/media |
| `human_moderation` | Signed human reviewer authorization, clean approvals and later revocation/appeal |
| `approved_nft_registry` | Real approved deployed ERC721/1155 factory and token contract addresses, bytecode, original deployment block |
| `independent_rpc` | Two truly independent HTTPS Testnet RPC providers agreeing on chain 18881/receipt/owner/block |
| `blockscout` | Official explorer's current HTTP 404 resolved, independently verified receipts/blocks |
| `cancun_mcopy_push0` | Real Ultra EVM Testnet deployment and MCOPY/PUSH0 transaction readback |
| `contract_security_audit` | External independent full M4–M8 NFT/royalty/escrow/EIP1271/reentrancy audit and signed findings closure |
| `human_operator_review` | Signed accountable human release decision with emergency-stop and rollback acceptance |

## Default-OFF configuration

```dotenv
M11_REVOCATION_SYNC_ENABLED=false
M11_VISIBILITY_CHECK_ENABLED=false
M11_ACCEPTANCE_READ_ENABLED=false
M11_EVIDENCE_SUBMISSIONS_ENABLED=false
M11_MEDIA_RECONCILE_ENABLED=false
M11_NFT_WITNESS_RECHECK_ENABLED=false
M11_OPERATOR_READONLY_CHECK_ENABLED=false
M11_LOCAL_RESTORE_REHEARSAL=false
M11_OPERATOR_WALLETS=
M11_EVIDENCE_ISSUER=
M11_EVIDENCE_PUBLIC_KEY_PEM=
M11_PINNED_METADATA_GATEWAY=
M11_SIGNED_REVOCATION_JWT=
```

No private issuer/signing/wallet keys or actual operator source JWTs committed. The M11 JWT revocation script is **never** run in CI against real Social identity or PostgreSQL.

## Operator acceptance playbook: step by step

1. Independently audit and implement portable issuer in **Looke Social** first with actual authorised, wallet-session-bound moderation data. Review/merge Social changes only under Social repository's own gates. Configure public source key and signed code hash, not any Social private keys in LookeNFT.
2. Provision genuine Testnet wallet and Reown project; perform Windows/mobile physical device sessions and logout/wallet unlink tests. Collect signed human evidence and independent screenshots/logs under protected source URLs; do not forward cookies between apps.
3. Provision private real operator PostgreSQL credentials to Vercel's protected environment only. Apply migration 009 after 001–008 with operator authorisation, obtain encrypted full backup, independently restore and rehearse rollback into protected isolated DB. CI local backup is not a substitute.
4. Configure actual Cloudinary authenticated media and independent ClamAV/Pinata source credentials. Verify content hashes and human moderation evidence before considering any public media.
5. Supply genuine approved M3 ERC721/1155 contract and independent second RPC; resolve Blockscout 404; verify real chain receipts and Cancun opcodes. Use M11 read-only owner+metadata witness; any disagreement = NO-GO.
6. Obtain independent third-party audit covering contracts and operator data permissions, proof replay and financial custody. Real human reviewer signs evidence with an authorised out-of-band issuer; M11 only stores submitted/unverified candidate receipts, never auto-approves.
7. **M12 FINAL:** conduct real source-backed full Testnet acceptance, run real wallet-approved transactions *only if authorised*, close every security and rollback issue, and record a genuinely signed GO/NO-GO decision. If any item remains blocked, M12 ends with **NO-GO**, not fabricated launch. Mainnet remains separate and never follows automatically.

## M11 implementation status

- Signed source consumption, candidate recording, frontend/operator UX, no-go matrix, local security and database integration tests: engineering implemented.
- Real independent providers, Social issuers, human reviewers, real NFT/media sources, approved contracts, Cancun proof, Blockscout and production database restore: **not supplied; explicitly blocked**.
- Mainnet, UOS escrow, financial execution, public beta and production merge: **disabled / unapproved**.

**NEXT: M12 (FINAL MILESTONE) — Real Testnet acceptance & independent operator launch/NO-GO decision.**
