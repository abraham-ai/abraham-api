import { createPublicClient, createWalletClient, http, parseAbi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Create a Test Seed on TheSeeds Contract
 *
 * This script submits a test seed to verify:
 * 1. Contract deployment is working
 * 2. CREATOR_ROLE is set up correctly
 * 3. Seed submission flow is functional
 *
 * Usage:
 *   NETWORK=baseSepolia tsx scripts/createTestSeed.ts
 *   NETWORK=base tsx scripts/createTestSeed.ts
 */

// Contract ABI - only the functions we need
const theSeedsAbi = parseAbi([
  "function submitSeed(string memory _ipfsHash) external returns (uint256)",
  "function getSeed(uint256 _seedId) external view returns (uint256 id, address creator, string ipfsHash, uint256 votes, uint256 blessings, uint256 createdAt, bool minted, uint256 mintedInRound)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function seedCount() external view returns (uint256)",
  "function CREATOR_ROLE() external view returns (bytes32)",
]);

// Test IPFS hash - can be overridden via command line argument
const TEST_IPFS_HASH = process.argv[2] || "ipfs://QmTiAN3G6xvgnE6hEgUMbs8T2zCZzuwEm1zPvvn4iQgKNa";

// Network configuration
const networks = {
  base: {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    name: "Base Mainnet",
    explorer: "https://basescan.org",
  },
  baseSepolia: {
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    name: "Base Sepolia",
    explorer: "https://sepolia.basescan.org",
  },
};

async function main() {
  console.log("\n=== Create Test Seed on TheSeeds ===\n");

  // Get network from environment
  const networkName = (process.env.NETWORK || "baseSepolia") as keyof typeof networks;
  const networkConfig = networks[networkName];

  if (!networkConfig) {
    throw new Error(`Invalid network: ${networkName}. Valid options: ${Object.keys(networks).join(", ")}`);
  }

  console.log(`Network: ${networkConfig.name}`);
  console.log(`Chain ID: ${networkConfig.chain.id}`);

  // Get contract address from environment
  const contractAddress = process.env.L2_SEEDS_CONTRACT;
  if (!contractAddress) {
    throw new Error("L2_SEEDS_CONTRACT not set in environment");
  }

  // Get private key from environment - try multiple key names
  const privateKeyRaw =
    process.env.RELAYER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY;

  if (!privateKeyRaw) {
    throw new Error("No private key found. Set RELAYER_PRIVATE_KEY, PRIVATE_KEY, or DEPLOYER_PRIVATE_KEY");
  }

  // Normalize private key (add 0x prefix if missing)
  const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as Hex;

  // Create account from private key
  const account = privateKeyToAccount(privateKey);
  console.log(`Signer: ${account.address}`);
  console.log(`Contract: ${contractAddress}\n`);

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

  // Check if signer has CREATOR_ROLE
  console.log("Checking permissions...");
  const CREATOR_ROLE = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "CREATOR_ROLE",
  });
  const hasCreatorRole = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "hasRole",
    args: [CREATOR_ROLE, account.address],
  });

  if (!hasCreatorRole) {
    console.error(`\n❌ Error: ${account.address} does not have CREATOR_ROLE`);
    console.log("\nTo grant CREATOR_ROLE, run:");
    console.log(`  CREATOR_ADDRESS=${account.address} npm run grant-creator:${networkName === "base" ? "base" : "base-sepolia"}`);
    process.exit(1);
  }

  console.log("✓ Signer has CREATOR_ROLE\n");

  // Get current seed count
  const currentSeedCount = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "seedCount",
  });

  console.log(`Current seed count: ${currentSeedCount}`);
  console.log(`Test IPFS hash: ${TEST_IPFS_HASH}\n`);

  // Submit test seed
  console.log("Submitting test seed...");
  const txHash = await walletClient.writeContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "submitSeed",
    args: [TEST_IPFS_HASH],
  });

  console.log(`Transaction hash: ${txHash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  if (receipt.status !== "success") {
    console.error("\n❌ Transaction failed!");
    process.exit(1);
  }

  console.log(`✓ Transaction confirmed in block ${receipt.blockNumber}\n`);

  // Get the newly created seed ID (should be currentSeedCount)
  const newSeedId = currentSeedCount;

  // Fetch and display the created seed
  console.log("=== Created Seed ===");
  const seed = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "getSeed",
    args: [newSeedId],
  });

  const [id, creator, ipfsHash, votes, blessings, createdAt, minted, mintedInRound] = seed as [
    bigint,
    Address,
    string,
    bigint,
    bigint,
    bigint,
    boolean,
    bigint
  ];

  console.log(`ID: ${id}`);
  console.log(`Creator: ${creator}`);
  console.log(`IPFS Hash: ${ipfsHash}`);
  console.log(`Votes: ${votes}`);
  console.log(`Blessings: ${blessings}`);
  console.log(`Created At: ${new Date(Number(createdAt) * 1000).toISOString()}`);
  console.log(`Minted: ${minted}`);
  console.log(`Minted In Round: ${mintedInRound}`);

  console.log("\n=== Success ===");
  console.log(`Test seed #${id} created successfully!`);
  console.log(`Transaction: ${networkConfig.explorer}/tx/${txHash}`);
  console.log(`\nYou can now test blessings on seed #${id}`);
  console.log("\nNext steps:");
  console.log("1. Start the API: npm run dev");
  console.log(`2. Test blessing via API: POST /api/blessings { "seedId": ${id} }`);
  console.log(`3. View seed via API: GET /api/seeds/${id}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message || error);
    process.exit(1);
  });
