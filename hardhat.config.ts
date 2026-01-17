import { defineConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const privateKey = process.env.PRIVATE_KEY ?? "";
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";

export default defineConfig({
  plugins: [
    hardhatToolboxViem,
    hardhatEthers,
    hardhatVerify,
  ],

  // Include both root contracts folder and src subfolder
  paths: {
    sources: "./contracts",
  },

  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1, // Optimize for smallest deployment size
          },
          metadata: {
            bytecodeHash: "none" // Don't include metadata hash to save space
          }
        },
      },
      {
        version: "0.8.23",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1, // Minimize contract size
          },
          viaIR: true, // Enable IR optimization for smaller code
          metadata: {
            bytecodeHash: "none"
          }
        },
      },
    ],
  },

  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: 1337,
    },

    sepolia: {
      type: "http",
      url: sepoliaRpcUrl,
      accounts: privateKey ? [privateKey] : [],
      chainId: 11155111,
    },

    baseMainnet: {
      type: "http",
      url: "https://mainnet.base.org",
      accounts: privateKey ? [privateKey] : [],
      chainId: 8453,
    },

    baseSepolia: {
      type: "http",
      url: "https://sepolia.base.org",
      accounts: privateKey ? [privateKey] : [],
      chainId: 84532,
    },
  },

  /**
   * 🔍 Verification config
   * In Hardhat 3, use a single API key that works across all Etherscan-compatible explorers
   * Base networks use BASESCAN_API_KEY, Ethereum networks use ETHERSCAN_API_KEY
   */
  verify: {
    etherscan: {
      apiKey: process.env.BASESCAN_API_KEY ?? process.env.ETHERSCAN_API_KEY ?? "",
    },
  },

  /**
   * 🌐 Custom chain descriptors for non-default networks
   * Required for Base chains to work with verification
   * Updated to use Etherscan V2 API (unified endpoint for all chains)
   */
  chainDescriptors: {
    84532: {
      name: "baseSepolia",
      blockExplorers: {
        etherscan: {
          name: "BaseScan Sepolia",
          url: "https://sepolia.basescan.org",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
    8453: {
      name: "baseMainnet",
      blockExplorers: {
        etherscan: {
          name: "BaseScan",
          url: "https://basescan.org",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
  },
});
