/* M4 intentionally has NO testnet/mainnet private keys or remote deploy tasks. */
require("@nomicfoundation/hardhat-ethers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

/* Offline-reproducible compiler: pinned solc-js from package.json, no remote download. */
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion === "0.8.30") {
    const solc = require("solc");
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: solcVersion,
      longVersion: solc.version()
    };
  }
  return runSuper();
});

module.exports = {
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
      metadata: { bytecodeHash: "ipfs" }
    }
  },
  networks: {
    /* A *local* Hardhat VM that emulates chain ID 18881; never a real Testnet. */
    hardhat: { chainId: 18881, hardfork: "cancun", allowUnlimitedContractSize: false }
  },
  paths: {
    sources: "./contracts",
    tests: "./contract-tests",
    cache: "./.hardhat/cache",
    artifacts: "./artifacts/contracts"
  },
  mocha: { timeout: 120000 }
};
