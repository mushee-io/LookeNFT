import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("network settings match documented Ultra EVM RPC and chain IDs", async () => {
  const config = await read("lib/network.ts");
  assert.match(config, /chainId: 18881/);
  assert.match(config, /chainId: 19991/);
  assert.match(config, /https:\/\/evm\.test\.ultra\.eosusa\.io/);
  assert.match(config, /https:\/\/evmexplorer\.testnet\.ultra\.io/);
  assert.match(config, /NEXT_PUBLIC_ULTRA_NETWORK === "mainnet"/);
});

test("wallet requires user-initiated connection and verifies chain", async () => {
  const code = await read("components/WalletConnect.tsx");
  assert.match(code, /onClick=\{connect\}/);
  assert.match(code, /eth_requestAccounts/);
  assert.match(code, /wallet_switchEthereumChain/);
  assert.match(code, /wallet_addEthereumChain/);
  assert.match(code, /Wallet network does not match Ultra EVM/);
  assert.doesNotMatch(code, /eth_sendTransaction|eth_signTransaction/);
});

test("discovery has honest zero state and routes do not claim live execution", async () => {
  const home = await read("app/page.tsx");
  const create = await read("app/create/page.tsx");
  const layout = await read("app/layout.tsx");
  assert.match(home, /No NFTs have been indexed yet/);
  assert.match(create, /Nothing is minted in M1/);
  for (const path of ["/explore", "/create", "/portfolio", "/activity"]) {
    assert.ok(layout.includes('href="' + path + '"'));
  }
});
