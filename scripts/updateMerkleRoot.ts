import { createPublicClient, createWalletClient, http, parseAbi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, base, baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Update Merkle Root on The Seeds Contract
 *
 * This script reads the generated Merkle tree and updates
 * the ownership root on The Seeds contract.
 *
 * Usage:
 *   NETWORK=baseSepolia tsx scripts/updateMerkleRoot.ts
 */

// Contract ABI - only the functions we need
const theSeedsAbi = parseAbi([
  "function currentOwnershipRoot() view returns (bytes32)",
  "function rootTimestamp() view returns (uint256)",
  "function updateOwnershipRoot(bytes32 _newRoot) external",
]);

// Network configuration
const networks = {
  mainnet: {
    chain: mainnet,
    rpcUrl: process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com",
  },
  sepolia: {
    chain: sepolia,
    rpcUrl: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
  },
  base: {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  },
  baseSepolia: {
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  },
};

async function main() {
  console.log("\n=== Update Merkle Root on The Seeds ===\n");

  // Get network from environment
  const networkName = (process.env.NETWORK || "baseSepolia") as keyof typeof networks;
  const networkConfig = networks[networkName];

  if (!networkConfig) {
    throw new Error(`Invalid network: ${networkName}. Valid options: ${Object.keys(networks).join(", ")}`);
  }

  console.log(`Network: ${networkName}`);
  console.log(`Chain ID: ${networkConfig.chain.id}`);

  // Get contract address from environment
  const contractAddress = process.env.L2_SEEDS_CONTRACT as Address;
  if (!contractAddress) {
    throw new Error("L2_SEEDS_CONTRACT not set in environment");
  }

  // Get private key from environment
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex;
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY not set in environment");
  }

  // Create account from private key
  const account = privateKeyToAccount(privateKey);
  console.log(`Signer: ${account.address}`);

  // Load Merkle tree data
  const merklePath = process.env.MERKLE_PATH || "./lib/snapshots/firstWorks_merkle.json";
  console.log(`Loading Merkle tree from: ${merklePath}`);

  const merkleData = JSON.parse(readFileSync(merklePath, "utf-8"));
  const merkleRoot = merkleData.root as Hex;

  console.log(`Merkle Root: ${merkleRoot}`);
  console.log(`Contract Address: ${contractAddress}`);

  // Create clients
  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  // Check current root
  const currentRoot = await publicClient.readContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "currentOwnershipRoot",
  });

  console.log(`\nCurrent Root: ${currentRoot}`);

  if (currentRoot === merkleRoot) {
    console.log("\n⚠ Merkle root is already up to date!");
    return;
  }

  // Update root
  console.log("\nUpdating Merkle root...");
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "updateOwnershipRoot",
    args: [merkleRoot],
  });

  console.log(`Transaction hash: ${txHash}`);

  console.log("Waiting for confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  console.log(`✓ Root updated in block ${receipt.blockNumber}`);

  // Verify update
  const newRoot = await publicClient.readContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "currentOwnershipRoot",
  });

  const rootTimestamp = await publicClient.readContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "rootTimestamp",
  });

  console.log("\n=== Update Complete ===");
  console.log(`New Root: ${newRoot}`);
  console.log(`Timestamp: ${new Date(Number(rootTimestamp) * 1000).toISOString()}`);
  console.log(`Block Number: ${receipt.blockNumber}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
