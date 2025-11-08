import "@nomicfoundation/hardhat-toolbox-viem";
import { config as dotenvConfig } from "dotenv";
// Load .env.local file
dotenvConfig({ path: ".env.local" });
const privateKey = process.env.PRIVATE_KEY || "";
const config = {
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
                    type: "http",
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
};
export default config;
