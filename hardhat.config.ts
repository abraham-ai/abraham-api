import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const privateKey = process.env.PRIVATE_KEY ?? "";
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
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
   * 🔍 Verification config (NEW)
   */
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    },

    // Optional: disable explorers you don't want
    blockscout: {
      enabled: true,
    },

    sourcify: {
      enabled: false,
    },
  },

  /**
   * 🌐 Chain descriptors for non-native networks
   */
  chainDescriptors: {
    8453: {
      name: "Base",
      blockExplorers: {
        etherscan: {
          name: "BaseScan",
          url: "https://basescan.org",
          apiUrl: "https://api.basescan.org/api",
        },
      },
    },

    84532: {
      name: "Base Sepolia",
      blockExplorers: {
        etherscan: {
          name: "BaseScan Sepolia",
          url: "https://sepolia.basescan.org",
          apiUrl: "https://api-sepolia.basescan.org/api",
        },
      },
    },
  },
};

export default config;
