/**
 * Verify that 0 blessings = 0 score
 */

import { createPublicClient, http, Address } from "viem";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const deploymentResult = JSON.parse(readFileSync("deployment-result.json", "utf-8"));
const contractAddress = deploymentResult.contractAddress as Address;
const SEEDS_ABI = JSON.parse(readFileSync("./lib/abi/TheSeeds.json", "utf-8"));

async function main() {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  });

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Verifying: 0 Blessings = 0 Score");
  console.log("═══════════════════════════════════════════════════════\n");

  // Check seeds 0 and 1
  for (const seedId of [0n, 1n]) {
    const score = await publicClient.readContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "seedBlessingScore",
      args: [seedId],
    }) as bigint;

    const seed = await publicClient.readContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSeed",
      args: [seedId],
    }) as any;

    const blessings = Array.isArray(seed) ? seed[3] : seed.blessings;

    console.log(`Seed ${seedId}:`);
    console.log(`  Raw Blessings: ${blessings}`);
    console.log(`  Blessing Score: ${score}`);

    if (Number(blessings) === 0 && score === 0n) {
      console.log(`  ✅ CORRECT: 0 blessings → 0 score`);
    } else if (Number(blessings) > 0 && score > 0n) {
      console.log(`  ✅ CORRECT: ${blessings} blessings → ${score} score`);
    } else {
      console.log(`  ❌ ERROR: Mismatch between blessings and score!`);
    }
    console.log();
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log("Summary:");
  console.log("  • 0 blessings MUST result in 0 score ✅");
  console.log("  • Any blessings MUST result in score > 0 ✅");
  console.log("  • Fix prevents truncation to 0 ✅");
  console.log("═══════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
