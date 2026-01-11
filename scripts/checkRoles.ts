import { createPublicClient, http, parseAbi, Address } from "viem";
import { baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/**
 * Check what roles an address has
 */

const theSeedsAbi = parseAbi([
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function getRoleMember(bytes32 role, uint256 index) external view returns (address)",
  "function getRoleMemberCount(bytes32 role) external view returns (uint256)",
]);

// Role hashes
const ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CREATOR_ROLE = "0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7";
const RELAYER_ROLE = "0xe2b7fb3b832174769106daebcfd6d1970523240dda11281102db9363b83b0dc4";

async function main() {
  const contractAddress = process.env.L2_SEEDS_CONTRACT;
  const checkAddress = process.argv[2] || "0x641f5ffC5F6239A0873Bd00F9975091FB035aAFC";

  if (!contractAddress) {
    throw new Error("L2_SEEDS_CONTRACT not set");
  }

  console.log(`\n=== Checking Roles for ${checkAddress} ===\n`);
  console.log(`Contract: ${contractAddress}\n`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  });

  // Check each role
  const hasAdmin = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "hasRole",
    args: [ADMIN_ROLE, checkAddress as Address],
  });

  const hasCreator = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "hasRole",
    args: [CREATOR_ROLE, checkAddress as Address],
  });

  const hasRelayer = await publicClient.readContract({
    address: contractAddress as Address,
    abi: theSeedsAbi,
    functionName: "hasRole",
    args: [RELAYER_ROLE, checkAddress as Address],
  });

  console.log(`ADMIN_ROLE:   ${hasAdmin ? "✓ YES" : "✗ NO"}`);
  console.log(`CREATOR_ROLE: ${hasCreator ? "✓ YES" : "✗ NO"}`);
  console.log(`RELAYER_ROLE: ${hasRelayer ? "✓ YES" : "✗ NO"}`);

  // Get all members of CREATOR_ROLE
  console.log("\n=== CREATOR_ROLE Members ===");
  try {
    const creatorCount = await publicClient.readContract({
      address: contractAddress as Address,
      abi: theSeedsAbi,
      functionName: "getRoleMemberCount",
      args: [CREATOR_ROLE],
    });

    console.log(`Total members: ${creatorCount}`);

    for (let i = 0; i < Number(creatorCount); i++) {
      const member = await publicClient.readContract({
        address: contractAddress as Address,
        abi: theSeedsAbi,
        functionName: "getRoleMember",
        args: [CREATOR_ROLE, BigInt(i)],
      });
      console.log(`  ${i + 1}. ${member}`);
    }
  } catch (error) {
    console.log("Could not fetch role members");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message || error);
    process.exit(1);
  });
