# LookeNFT M12 — FINAL Testnet acceptance and source-backed NO-GO

**FINAL milestone: M12 of M12** in `mushee-io/LookeNFT`. Testnet chain ID **18881**. The outcome remains **NO_GO**, not an authorised launch, audit approval or evidence of verified NFTs.

## Independently verified predecessors

All PRs #1–#11 were retrieved from GitHub on 6 November 2026 and found **OPEN, DRAFT, UNMERGED**. Exact heads: #1 `4071364c7acf6d2a6f8d9f3332c55415b0143941`; #2 `a9bdecef40a54bdea166f935e318f615a87fa277`; #3 `59cbcd92f1f4e2ea00330a331a469f7508d48e3c`; #4 `fc764929fae59825607a8a62817c9fa555fc75f0`; #5 `29bdf1c9ed3c8a876f98461667b6ef73af074700`; #6 `cb800b98b890a02b9185a72f180da25c2910d395`; #7 `8497461068383c5527bebe3c04e5a14e55dc7573`; #8 `d7127522753ee4c4095168fb34c46e3d0204598f`; #9 `ff0f0485212dc375aae5d9f9c2282bba7be9e615`; #10 `6656d95e9998908b2e2b6641b134c97702f9c329`; **M11 #11** `5972f3b1f999de1b9e762af8524869e90228d643`.

M11 final GitHub Actions [run 42174260968](https://github.com/mushee-io/LookeNFT/actions/runs/42174260968): **69/69 application, 22/22 real disposable PostgreSQL integration, 40/40 pinned local Solidity** passed, strict TypeScript, Next production build, seven local bytecode size checks and scratch restore+rollback across **33 tables, 350 constraints** passed. **External-source job FAILED**: official independent Blockscout **HTTP 404**. This job uses `continue-on-error`, so GitHub overall success does NOT imply on-chain proof.

The real `mushee-io/looke` source at `958e56c7bdd6f95fed30791e833cad9966eafed1` supports EIP191 wallet authentication, SQL social profiles/posts and moderation, but **does NOT provide the compatible trusted externally signed EdDSA M2/M10 identity or M11 signed revocation/visibility issuers**. M12 does not add fake issuer credentials or claim actual Social integration.

## M12 final engineering

- `db/migrations/010_m12_final_acceptance.sql`: immutable **NO_GO only** review rows and 18 gate observations. SQL CHECK constraints reject `GO`, `approved`, `execution_authorised=true`, `human_release_approved=true`, `independent_source_approved=true`. M11 records remain submitted/unverified and new signed human statements remain `signature_valid_source_unverified`. No account, NFT, artwork, sale, signature or financial event seeded.
- `lib/m12/final.ts`: deterministic sha256 digest of explicit 18-gate Testnet NO_GO snapshot, bound to exact predecessor M11 head, with separate current candidate counts; only allowed operator may record a NO_GO review and duplicate digests are rejected. `GET /api/final-acceptance` reads, `POST /api/final-acceptance` records explicitly confirmed NO_GO only.
- `lib/m12/human.ts`: independent EdDSA `security_reviewer` and `release_operator`, distinct wallet, issuer and Ed25519 public keys, pinned KID, `aud:lookenft-m12-final-review`, 2-minute nonce/time window, exact review UUID and bundle SHA, chain 18881. Replays and cross-role signatures rejected. Even an authentic `GO_PROPOSAL_UNVERIFIED` stays source-unverified and **cannot** set GO, approve an audit or enable transactions. `POST /api/final-acceptance/human` remains off until real separate reviewers exist.
- `lib/m12/witness.ts`: read-only two HTTPS RPC chain 18881, >=12-confirmation canonical height, matching block hash+parent, official Blockscout REST agreement, independently matching pinned factory/market/vault runtime bytecode. Distinct hostnames are **necessary but not proof of independent operator control**. A matching block/bytecode is NOT NFT ownership, media approval, a security audit or a signed transaction.
- `scripts/m12-readonly-source-check.ts`: operator-opt-in Testnet-only network probe, writes `.artifacts/m12-final-readiness.json` recording observed sources or exact error; **always NO_GO**. No transfers, approvals, signed wallets, contract deployment, automated trades or mainnet access. No credentials invented. No recurring/automatic source checks scheduled.
- `app/final-acceptance/page.tsx`: protected human-readable final NO_GO dashboard, all 18 real-world source and reviewer blockers, explicit operator review action, signed human candidate intake, previous review digest list.
- `tests/m12.test.ts` and `tests/m12.integration.test.ts`: local synthetic EdDSA JWTs verify wrong issuer/audience/chain/KID, user confusion, role separation, signed nonce replay, time expiry, digest mismatch, signed unverified GO never authorises live action, two-RPC code/chain/block divergence, Blockscout rejection, protected URLs, default-off flags. **Real disposable localhost PostgreSQL** verifies 18 constrained gates, duplicate NO_GO record prevention, two distinct signing candidates, SQL rejection of GO/approved, separate one-time reviewer/URL evidence, source observations always unverified. These fixtures are local synthetic values only.
- Full inherited M1–M12 app, PostgreSQL, pinned Solidity regression, TypeScript, Next production build, and scratch full logical PostgreSQL backup/restore+rollback. The scratch database is **not a production restore**, nor external source approval.

## Final 18 external / human release blockers

| NO-GO gate | Required evidence, not presently verified |
|---|---|
| `looke_m2_issuer` | Real Looke Social signed M2 identity and session binding |
| `looke_m10_issuer` | Source-backed signed profile/post moderation/issuer |
| `social_revocation` | Operational real signed account suspension and key rotation/recovery |
| `blocked_viewer_policy` | Independent signed viewer-specific block/mute visibility |
| `reown_mobile` | Authenticated real iOS/Android Reown paired wallet walkthrough |
| `reown_desktop` | Windows desktop/injected wallet session, logout and 375/768/1440 UX |
| `operator_postgres_restore` | Operator PostgreSQL approved restore and independent record integrity |
| `protected_rollback` | Real production/Testnet protected deployment alias, backup and rollback drill |
| `cloudinary_delivery` | Authenticated provider image/video hashes and permissions |
| `clamav_scan` | Real ClamAV engine/source malware scan logs |
| `pinata_cid` | Independently resolved Pinata pinned content bytes/CID |
| `human_moderation` | Actual authorised human media moderation and suspension records |
| `approved_nft_registry` | Genuinely source-verified ERC721/1155 factory/collections and ownership |
| `independent_rpc` | Two genuinely independent Ultra EVM Testnet RPC operators and agreeing blocks/receipts |
| `blockscout` | Official explorer HTTP 404 resolution, independent canonical block and receipts |
| `cancun_mcopy_push0` | Actual 18881 transaction proof for MCOPY/PUSH0, not local Hardhat success |
| `contract_security_audit` | Independent contract security review including mint, UOS custody, royalties, nonce/cancellation, reentrancy, EIP712/EIP1271 and remediations |
| `human_operator_review` | Actual out-of-band signatures, key separation and human accountable GO/NO-GO decision |

## Operator acceptance — precise NO-GO handling

1. On the separate Looke Social repository, implement and independently review an approved **real** EdDSA portable identity/moderation/revocation/visibility issuer. Do not forward Social cookies or emulate existing users. Leave `M10_SOCIAL_SYNC_ENABLED=false` until live trusted source evidence and moderation revocation are checked.
2. Run wallet pairing on actual Windows and iOS/Android with Reown public Project ID; independently sign Testnet wallet-auth challenges; verify account changes, revoke/logout, multiple viewport sizes, and capture approved human records. Never give private keys to CI.
3. Have the real operator provision PostgreSQL, back up and restore into separately protected account, compare every migration 001–010 and integrity keys, and rehearse real protected rollback. The 33-table CI sample is **not** this evidence.
4. Have independent humans examine actual Cloudinary delivery, ClamAV INSTREAM scan provenance, Pinata signed CID pin and fetched bytes, human moderation, source token metadata. Reject unsupported/hidden/unsafe media.
5. Validate authentic deployed NFT contracts, independent RPC providers, official Blockscout (HTTP 404 must resolve), >=12 blocks, ownerOf/balanceOf and tokenURI/uri, genuine operator runtime code hashes, real Cancun MCOPY/PUSH0 receipt. Do not create mock NFTs or on-chain transactions for acceptance.
6. Obtain independent security audit, close critical findings, and collect **two separate** actual human security and operator signoffs. The M12 signed reviewer API stores only provenance candidates; explicit out-of-band human audit findings are still required.
7. Final record is **NO_GO** while any proof is missing. Do not merge M1–M12, enable beta, deploy mainnet, release custody/escrow or broadcast financial transactions on a merely successful CI run. A future real launch would require a **separate authorised release process outside this final milestone**.

### Off-by-default configuration

```dotenv
M12_OPERATOR_RECORD_NO_GO=false
M12_SIGNED_HUMAN_CANDIDATES_ENABLED=false
M12_SOURCE_CHECK_ENABLED=false
M12_FINAL_PUBLIC_BETA_ENABLED=false
M12_FINAL_MAINNET_ENABLED=false
M12_FINAL_FINANCIAL_EXECUTION_ENABLED=false
M12_INDEPENDENT_RPC_URL=
M12_APPROVED_FACTORY_ADDRESS=
M12_APPROVED_FACTORY_CODE_HASH=
M12_APPROVED_MARKET_ADDRESS=
M12_APPROVED_MARKET_CODE_HASH=
M12_APPROVED_OFFER_VAULT_ADDRESS=
M12_APPROVED_OFFER_CODE_HASH=
M12_SECURITY_REVIEWER_ISSUER=
M12_SECURITY_REVIEWER_PUBLIC_KEY_PEM=
M12_SECURITY_REVIEWER_KEY_ID=
M12_SECURITY_REVIEWER_WALLET=
M12_RELEASE_OPERATOR_ISSUER=
M12_RELEASE_OPERATOR_PUBLIC_KEY_PEM=
M12_RELEASE_OPERATOR_KEY_ID=
M12_RELEASE_OPERATOR_WALLET=
```

**M12 is the final LookeNFT milestone. Final decision: NO_GO pending independent source-backed proof and real human authorisation.** No M13 or automatic launch.
