import { createPublicClient, createWalletClient, http, parseAbi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, base, baseSepolia } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: '.env.local' });
dotenv.config();

/**
 * Update Merkle Root on MerkleGating or TheSeeds Contract
 *
 * This script reads the generated Merkle tree and updates
 * the ownership root on the appropriate contract.
 *
 * For AbrahamSeeds: Updates MerkleGating contract (L2_GATING_CONTRACT)
 * For TheSeeds (legacy): Updates TheSeeds contract (L2_SEEDS_CONTRACT)
 *
 * Usage:
 *   NETWORK=baseSepolia tsx scripts/updateMerkleRoot.ts
 */

// Contract ABIs
const merkleGatingAbi = parseAbi([
  "function merkleRoot() view returns (bytes32)",
  "function rootTimestamp() view returns (uint256)",
  "function updateRoot(bytes32 newRoot) external",
]);

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
  console.log("\n=== Update Merkle Root ===\n");

  // Get network from environment
  const networkName = (process.env.NETWORK || "baseSepolia") as keyof typeof networks;
  const networkConfig = networks[networkName];

  if (!networkConfig) {
    throw new Error(`Invalid network: ${networkName}. Valid options: ${Object.keys(networks).join(", ")}`);
  }

  console.log(`Network: ${networkName}`);
  console.log(`Chain ID: ${networkConfig.chain.id}`);

  // Determine which contract to use
  // If L2_GATING_CONTRACT is set, use MerkleGating (new contract)
  // Otherwise fall back to L2_SEEDS_CONTRACT (old contract)
  const gatingContractAddress = process.env.L2_GATING_CONTRACT as Address | undefined;
  const seedsContractAddress = process.env.L2_SEEDS_CONTRACT as Address | undefined;

  let contractAddress: Address;
  let isNewContract: boolean;
  let contractAbi: any;
  let getRootFunction: string;
  let updateRootFunction: string;

  if (gatingContractAddress) {
    contractAddress = gatingContractAddress;
    isNewContract = true;
    contractAbi = merkleGatingAbi;
    getRootFunction = "merkleRoot";
    updateRootFunction = "updateRoot";
    console.log("Contract Type: MerkleGating (new)");
  } else if (seedsContractAddress) {
    contractAddress = seedsContractAddress;
    isNewContract = false;
    contractAbi = theSeedsAbi;
    getRootFunction = "currentOwnershipRoot";
    updateRootFunction = "updateOwnershipRoot";
    console.log("Contract Type: TheSeeds (legacy)");
  } else {
    throw new Error("No contract address set. Set L2_GATING_CONTRACT (new) or L2_SEEDS_CONTRACT (legacy)");
  }

  console.log(`Contract Address: ${contractAddress}`);

  // Get private key from environment
  const privateKeyRaw = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKeyRaw) {
    throw new Error("DEPLOYER_PRIVATE_KEY or PRIVATE_KEY not set in environment");
  }

  // Normalize private key (add 0x prefix if missing)
  const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as Hex;

  // Create account from private key
  const account = privateKeyToAccount(privateKey);
  console.log(`Signer: ${account.address}`);

  // Load Merkle tree data
  const merklePath = process.env.MERKLE_PATH || "./lib/snapshots/firstWorks_merkle.json";
  console.log(`Loading Merkle tree from: ${merklePath}`);

  if (!existsSync(merklePath)) {
    throw new Error(`Merkle tree file not found: ${merklePath}. Run 'npm run merkle:generate' first.`);
  }

  const merkleData = JSON.parse(readFileSync(merklePath, "utf-8"));
  const merkleRoot = merkleData.root as Hex;

  console.log(`Merkle Root: ${merkleRoot}`);

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
  let currentRoot: Hex;
  try {
    currentRoot = await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: getRootFunction,
    }) as Hex;
  } catch (error: any) {
    if (error.message.includes("0x")) {
      // Contract exists but might be uninitialized
      currentRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
    } else {
      throw error;
    }
  }

  console.log(`\nCurrent Root: ${currentRoot}`);

  if (currentRoot === merkleRoot) {
    console.log("\n✅ Merkle root is already up to date!");
    return;
  }

  // Update root
  console.log("\nUpdating Merkle root...");
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: updateRootFunction,
    args: [merkleRoot],
  });

  console.log(`Transaction hash: ${txHash}`);

  console.log("Waiting for confirmation...");
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  console.log(`✅ Root updated in block ${receipt.blockNumber}`);

  // Verify update
  const newRoot = await publicClient.readContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: getRootFunction,
  }) as Hex;

  const rootTimestamp = await publicClient.readContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "rootTimestamp",
  }) as bigint;

  console.log("\n=== Update Complete ===");
  console.log(`New Root: ${newRoot}`);
  console.log(`Timestamp: ${new Date(Number(rootTimestamp) * 1000).toISOString()}`);
  console.log(`Block Number: ${receipt.blockNumber}`);

  const explorerUrl = networkName === "base" || networkName === "baseSepolia"
    ? `https://${networkName === "base" ? "" : "sepolia."}basescan.org/tx/${txHash}`
    : `https://${networkName === "mainnet" ? "" : "sepolia."}etherscan.io/tx/${txHash}`;

  console.log(`Explorer: ${explorerUrl}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
