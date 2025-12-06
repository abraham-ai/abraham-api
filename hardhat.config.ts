import { defineConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { config as dotenvConfig } from "dotenv";

// Load .env.local file
dotenvConfig({ path: ".env.local" });

const privateKey = process.env.PRIVATE_KEY || "";

export default defineConfig({
  plugins: [hardhatVerify],
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
    ...(process.env.SEPOLIA_RPC_URL && process.env.SEPOLIA_PRIVATE_KEY
      ? {
          sepolia: {
            type: "http" as const,
            url: process.env.SEPOLIA_RPC_URL,
            accounts: [process.env.SEPOLIA_PRIVATE_KEY],
          },
        }
      : {}),
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
  verify: {
    etherscan: {
      apiKey: process.env.BASESCAN_API_KEY || "",
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
    } as any, // Type assertion for custom chains support
    sourcify: {
      enabled: false,
    },
  },
});
