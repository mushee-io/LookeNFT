# M1 verification handoff (no invented acceptance)

- Repository `mushee-io/LookeNFT`, draft PR #1.
- Last M1 commit: `4071364c7acf6d2a6f8d9f3332c55415b0143941`.
- GitHub Actions run #2: `42105369118`, job `127518658842`, **success**.
- Verified GitHub CI evidence: npm install, TypeScript typecheck, 3 source-smoke tests, production build all green.
- Reviewed EIP-1193 wallet source; it was a basic injected wallet connection, not signed backend authentication.
- No proof of manual desktop/mobile interface walkthrough in the provided evidence.
- No proof of actual Ultra EVM Testnet wallet pairing, chain transition, signature or signed transaction in the provided evidence.
- No proof of controlled preview/deployment authorization.
- Therefore PR #1 stays draft and unmerged. These are not sign-offs. M2 is stacked on the exact M1 final SHA.

## Human acceptance steps before merging M1
1. In an isolated preview/local build, inspect navigation and layout at 375, 768 and 1440px, recording screenshots/issues.
2. With an authorised external EIP-1193 wallet, confirm Ultra EVM Testnet chain ID 18881, address selection, disconnect and wrong-network flow. Record only public address, non-sensitive screenshot and network evidence.
3. Check expected provider-chain switch and refusal behaviour on mobile wallet and desktop extension; capture tester confirmation. Never share seed or private keys.
4. Review exact PR diff and test outputs; only then merge M1, and retarget M2 PR against main as appropriate.
