import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-ethers";
import { config as dotenvConfig } from "dotenv";

// Load .env.local file
dotenvConfig({ path: ".env.local" });

const privateKey = process.env.PRIVATE_KEY || "";
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org";

// Build API keys object only for networks with configured keys
const apiKeys: Record<string, string> = {};
if (process.env.ETHERSCAN_API_KEY) {
  apiKeys.sepolia = process.env.ETHERSCAN_API_KEY;
}
if (process.env.BASESCAN_API_KEY) {
  apiKeys.baseMainnet = process.env.BASESCAN_API_KEY;
  apiKeys.baseSepolia = process.env.BASESCAN_API_KEY;
}

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
};

// Add verification config if we have API keys
if (Object.keys(apiKeys).length > 0) {
  config.verify = {
    etherscan: {
      apiKey: apiKeys as any,
      customChains: [
        {
          network: "baseMainnet",
          chainId: 8453,
          urls: {
            apiURL: "https://api.basescan.org/api",
            browserURL: "https://basescan.org",
          },
        },
        {
          network: "baseSepolia",
          chainId: 84532,
          urls: {
            apiURL: "https://api-sepolia.basescan.org/api",
            browserURL: "https://sepolia.basescan.org",
          },
        },
      ],
    } as any,
    sourcify: {
      enabled: false,
    },
  };
}

export default config;
