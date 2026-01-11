import { createPublicClient, createWalletClient, http, parseAbi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/**
 * Grant CREATOR_ROLE to an address
 *
 * Usage:
 *   CREATOR_ADDRESS=0x... NETWORK=baseSepolia npx tsx scripts/grantCreatorRole.ts
 */

// Contract ABI - only the functions we need
const theSeedsAbi = parseAbi([
  "function addCreator(address _creator) external",
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
]);

// CREATOR_ROLE hash
const CREATOR_ROLE = "0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7";

// Network configuration
const networks = {
  base: {
    chain: base,
    rpcUrl: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
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
  console.log("\n=== Grant CREATOR_ROLE ===\n");

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

  // Get admin private key from environment
  const privateKeyRaw =
    process.env.DEPLOYER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;

  if (!privateKeyRaw) {
    throw new Error("No admin private key found. Set DEPLOYER_PRIVATE_KEY or PRIVATE_KEY");
  }

  // Get creator address from environment or command line
  const creatorAddress = process.env.CREATOR_ADDRESS || process.argv[2];
  if (!creatorAddress) {
    throw new Error("CREATOR_ADDRESS not set. Set via env var or pass as argument");
  }

  // Normalize private key (add 0x prefix if missing)
  const privateKey = (privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`) as Hex;

  // Create account from private key
  const account = privateKeyToAccount(privateKey);
  console.log(`Admin: ${account.address}`);
  console.log(`Contract: ${contractAddress}`);
  console.log(`Granting CREATOR_ROLE to: ${creatorAddress}\n`);

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

  // Check if address already has CREATOR_ROLE
  console.log("Checking current role status...");
  const hasCreatorRole = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "hasRole",
    args: [CREATOR_ROLE, creatorAddress as Address],
  });

  if (hasCreatorRole) {
    console.log(`\n✓ ${creatorAddress} already has CREATOR_ROLE!`);
    process.exit(0);
  }

  console.log("✗ Does not have CREATOR_ROLE yet\n");

  // Grant CREATOR_ROLE using grantRole directly
  console.log("Granting CREATOR_ROLE using grantRole...");
  const txHash = await walletClient.writeContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "grantRole",
    args: [CREATOR_ROLE, creatorAddress as Address],
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

  // Wait a moment for state to update
  console.log("Waiting for blockchain state to update...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Verify the role was granted
  const hasRoleAfter = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "hasRole",
    args: [CREATOR_ROLE, creatorAddress as Address],
  });

  console.log("=== Success ===");
  console.log(`CREATOR_ROLE granted: ${hasRoleAfter ? "✓ YES" : "✗ NO (check transaction)"}`);
  console.log(`Transaction: ${networkConfig.explorer}/tx/${txHash}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message || error);
    process.exit(1);
  });
