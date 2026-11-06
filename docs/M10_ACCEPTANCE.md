# LookeNFT M10 — genuine Looke Social identity and Ultra EVM NFT proof (ENGINEERING DRAFT)

## Predecessor chain verified, 6 November 2026

All PRs #1–#9 were fetched from GitHub as **OPEN, DRAFT, UNMERGED**, not assumed accepted. Final heads:

| PR | Milestone | Exact head |
|---|---|---|
| #1 | M1 | `4071364c7acf6d2a6f8d9f3332c55415b0143941` |
| #2 | M2 | `a9bdecef40a54bdea166f935e318f615a87fa277` |
| #3 | M3 | `59cbcd92f1f4e2ea00330a331a469f7508d48e3c` |
| #4 | M4 | `fc764929fae59825607a8a62817c9fa555fc75f0` |
| #5 | M5 | `29bdf1c9ed3c8a876f98461667b6ef73af074700` |
| #6 | M6 | `cb800b98b890a02b9185a72f180da25c2910d395` |
| #7 | M7 | `8497461068383c5527bebe3c04e5a14e55dc7573` |
| #8 | M8 | `d7127522753ee4c4095168fb34c46e3d0204598f` |
| #9 | M9 | `ff0f0485212dc375aae5d9f9c2282bba7be9e615` |

M9 final Actions run [`42156161536`](https://github.com/mushee-io/LookeNFT/actions/runs/42156161536) passed 54/54 app tests, 16/16 ephemeral PostgreSQL, 40/40 local Solidity, strict TypeScript, Next build and seven EIP-170/3860 bytecode checks. **Independent external source job failed, Blockscout HTTP 404**, though its `continue-on-error` setting allows overall workflow success. No external NFT trading proof and NO-GO release.

## Inspect actual Looke Social source

**Looke Social repository:** `mushee-io/looke`, main commit `958e56c7bdd6f95fed30791e833cad9966eafed1` (checked 6 Nov 2026).

Verified source paths:

- `src/lib/social/auth.ts`: real EIP-191 wallet challenge, hashed cookie session, `social_profiles` row with wallet address as primary identity, suspended account checks. **No external EdDSA signed identity assertion issuer**.
- `src/app/api/social/auth/route.ts`: session/challenge/login/logout only. A Looke Social cookie is **not** portable to LookeNFT and is never forwarded.
- `src/app/api/social/route.ts`: SQL public feed, creator profile/directory; joins only non-suspended accounts, filters hidden/deleted/unapproved media and blocked/muted viewer relationships. It does NOT prove on-chain NFT ownership or issue portable signed profile claims.
- `src/app/api/experience/profile-posts/route.ts`: real creator posts and only approved media, audience filtering; no signed portable source statement.
- `src/app/api/social/moderation/route.ts`: real moderator/hidden-post decision workflow, which must be independently authorised and incorporated into the source issuer.
- `db/migrations/001_social_foundation.sql`: wallet-scoped creator/profile/post social schema, blocks/follows. Not mirrored into LookeNFT without a real operator-approved signed export.

**Critical blocker:** Looke Social `main` does not yet issue `lookenft` (M2) or `lookenft-social-proof` (M10) **EdDSA JWT** assertions. Operator must implement, review, deploy and independently verify that capability in Looke Social as a *separate authorised change*. M10 does **not** pretend to connect to production/social database or transform a publicly visible handle into identity proof. It never borrows Looke Social cookies or database credentials.

## Exact signed assertion contract for Looke Social backend operator

**M2 wallet link:** existing LookeNFT `POST /api/profile/link` already expects JWT with issuer `LOOKE_IDENTITY_ISSUER`, `aud=lookenft`, `sub=wallet`, `wallet`, `jti`, `iat`, `exp`; sign with an authorised private Ed25519 key *outside GitHub*; configure only the public PEM in LookeNFT. Import to authenticated wallet once. Never issue from a raw username or user-selected wallet without a real linked Social session.

**M10 moderated read snapshot (new):**

- Header: `alg=EdDSA` only. `iss=M10_SOCIAL_ISSUER` must be pinned HTTPS. `aud=lookenft-social-proof`, `sub=lowercase social wallet address`, unique `jti`, issued-at and expiry **<=10 minutes**.
- Claims: `wallet` (same authenticated, M2-linked address), `profileId` (same as wallet, because actual `social_profiles.address` identifies profile), `chainId:18881`, `source:"looke-social-postgres"`, `version:1`, `sourceCommit: <independently reviewed exact Social code SHA>`.
- `profile: {address,handle,displayName,bio,publicApproved:true,suspended:false}` must come from current actual Social SQL, not user-supplied JSON. Handles obey Social's `^[a-z][a-z0-9_]{2,23}$`. `publicApproved` requires explicit audited Social policy; it is NOT inferred just from a profile's existence.
- At most 12 publicly visible, source-backed moderated posts: `id` UUID, exact `author=wallet`, nonempty `body` 1–1000 chars, real timestamp, `hidden:false`, `deleted:false`, `moderationApproved:true`. `mediaUrl` may be non-null only with `mediaStatus:"approved"`, `mediaKind:"image"|"video"`, HTTPS approved hostname and no credentials/query/fragment.
- **Never sign** blocked or muted viewer-visible information for a viewer who should not see it. Public creator directory is independently disabled until a source-attested real block/mute visibility policy and human operator decision.
- Issuer must check real signed Social wallet session, current DB state/visibility/moderation and `social_blocks`/`social_mutes` immediately before issuing; have JWT revocation/suspension and key-rotation procedures. M10 currently has expiry-based freshness (max 10 minutes), NOT immediate revocation; do not turn on public beta without stronger real-world suspension propagation.
- Keys: no private key, credentials, social bearer cookie, or full JWT are persisted in LookeNFT database. `nft_m10_assertion_jtis` consumes one nonce transactionally; `source_jti` and SHA-256 JWT digest are retained only as audit metadata. Monotonically newer signed snapshots replace earlier posts atomically; absent posts are removed.

## M10 engineering scope and read-only evidence

- `/social-link`: **separate** M2 wallet linking and M10 signed moderated proof, real ERC721/1155 NFT avatar selection, non-transactional verified-holder collection deep links (NOT proof of original creator), creator directory behind explicit source policy, and real per-wallet M9 attested market notifications. No social post publishing, wallet consent on behalf of user, trading or account migration.
- `/api/social/bridge`: session, same-origin JSON POST, strict one-field JWT, signed issuer/wallet/audience/chain/commit/time moderation checks, one-use JTI, profile must already have matching M2 identity, atomic PostgreSQL replacement and bounded per-wallet rate limits. GET only displays current authenticated wallet and verified M9 notifications. Unknown/expired/suspended/different-wallet claims fail.
- `/api/social/avatar`: real logged-in wallet selects genuine approved M3 collection + standard + token. Read-only 12+ block ownership check at recent M3 canonical checkpoint. Two independent RPC providers must match chain 18881, exact block/parent hash, ERC165 interface, deployed runtime bytecode/approved code hash and `ownerOf(tokenId)` or positive `balanceOf(wallet,tokenId)`. **Official Blockscout** must agree with block hash. Any HTTP 404, RPC divergence, reorg, missing approved registry or missing social issuer fails before DB insert. Source owner proof expires after 5 minutes. No NFT transfers, approvals or EVM signatures. DELETE just unsets local reference.
- Display source-backed artwork **only** when M6 `chain_matched` metadata is attached to a genuinely moderated, malware-clean, pinned image with verified CID; all other tokens display numeric ID and chain proof only.
- `/api/social/creators`: no follower ranking, unfounded engagement or social fake posts. Only signed public creator metadata and verified NFT avatar with still-canonical block journal, and only after `M10_SOCIAL_BLOCK_POLICY_ATTESTED=true`. No source => no public discovery.
- Existing M9 `privateNotifications(wallet)` used; no user can request another wallet's activity. These are true independently witnessed canonical market events, **not** speculative tweets or unconfirmed transaction hashes.
- `db/migrations/008_m10_social_nft_bridge.sql`: constrained social/identity source proofs, moderated posts, trusted NFT avatar with <=5-minute TTL, local verified-holder collection links, one-use issuer JTI ledger and PostgreSQL wallet route rate counters. No seeded profiles or activities. Deleting M2 profile link cascades M10 profile/owner proof/public content.
- Unit/fuzz/adversarial tests: test-only locally generated Ed25519 signatures, pinning/mismatched issuer/chain, cross-account, expired JWT, replay, hidden/unapproved posts, malicious media, bad NFT, two-RPC disagreement, fake code hash, absent Blockscout, NFT transfer to another owner, ERC1155 mismatch, and read-only refusal.
- Real ephemeral CI PostgreSQL: synthetic fixtures labelled LOCAL ONLY, actual transactions for linking, replay and monotonic issue times, foreign key and row isolation, bounded rate limits, orphaned NFT block proof visibility and cascade. These tests **do not** constitute real Looke Social or Ultra Testnet user acceptance. All predecessor M1–M9 tests and 40 Solidity tests remain required.

## Configuration — every switch OFF until real signed source/operator authorization

```dotenv
NEXT_PUBLIC_ULTRA_NETWORK=testnet
M10_SOCIAL_SYNC_ENABLED=false
M10_OWNERSHIP_VERIFY_ENABLED=false
M10_PUBLIC_DISCOVERY_ENABLED=false
M10_SOCIAL_BLOCK_POLICY_ATTESTED=false
NEXT_PUBLIC_M10_SOCIAL_UI_ENABLED=false
NEXT_PUBLIC_M10_AVATAR_UI_ENABLED=false
NEXT_PUBLIC_M10_CREATOR_DIRECTORY_ENABLED=false
NEXT_PUBLIC_M10_LOOKE_SOCIAL_ORIGIN=
M10_SOCIAL_PUBLIC_KEY_PEM=
M10_SOCIAL_ISSUER=
M10_SOCIAL_SOURCE_COMMIT=
M10_SOCIAL_MEDIA_ALLOWED_HOSTS=
M10_APPROVED_IPFS_GATEWAY=
M10_INDEPENDENT_RPC_URL=
```

The operator-controlled private Looke Social Ed25519 key belongs solely on the Social issuer side. M10's `M10_SOCIAL_SOURCE_COMMIT` must be an independently approved Social code revision, not a fabricated version; the above observed head is *research evidence only*. Do not enable until source issuer exists.

## Unresolved hard release gates / M11 handoff

- [ ] Real, independently reviewed and deployed Looke Social M2 and M10 source JWT issuers, trusted public key management, authenticated Social account, suspension and cross-viewer block/mute propagation, account recovery and signed human reviewer.
- [ ] Real Reown mobile pairing, Windows/desktop manual layout and wallet acceptance, cross-account/signature/replay and device security review.
- [ ] Real authorised PostgreSQL instance, one-time migration and restore/rollback integrity checks (CI ephemeral database is NOT operator database).
- [ ] Real M3 approved Ultra EVM Testnet ERC721/1155 collection registry and genuine confirmed token ownership, two independently controlled RPC providers, official Blockscout (currently HTTP **404**), real Testnet Cancun MCOPY/PUSH0 opcode compatibility.
- [ ] Real approved Cloudinary media, ClamAV scans, Pinata/IPFS pinning and independent human moderation; no content may leak when hidden/suspended/blocked.
- [ ] Independent contract security audit, EIP712/EIP1271 signature and royalty settlement review, real M7/M8 financial proofs, human operator release signoff, protected rollback drill.
- [ ] Earlier PRs #1–#9 remain drafts, unmerged. M10 draft remains NO-GO for public beta, real minting/listings/escrow/trading/mainnet.

**M11 suggested scope:** Security/acceptance hardening for the two-product trusted issuer, real operator source connectors, moderation revocation, multi-device wallet verification, NFT metadata proof freshness, independent witness reconciler and controlled testnet acceptance dashboards. Build as stacked draft on M10, never bypass source/financial gates.
