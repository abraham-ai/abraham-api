/**
 * FirstWorks NFT Collection Snapshot Utility
 *
 * Purpose: Pre-compute and cache NFT ownership data to avoid slow on-demand lookups
 *
 * Why we need this:
 * 1. The FirstWorks collection may have thousands of NFTs
 * 2. On-demand ownership checks require iterating through all token IDs (slow)
 * 3. RPC rate limits make real-time lookups unreliable
 * 4. Users expect instant API responses, not 30+ second waits
 *
 * Solution:
 * - Run this snapshot script periodically (e.g., daily via cron)
 * - Store complete ownership mapping in JSON
 * - API reads from cached snapshot instantly
 * - Update snapshot every 24 hours
 */

import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { AbrahamFirstWorks } from "../abi/firstWorks.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FirstWorks contract address
const FIRSTWORKS_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
const FIRSTWORKS_RPC_URL = process.env.FIRSTWORKS_RPC_URL;

/**
 * Interface for holder data
 */
export interface HolderData {
  address: string;
  balance: number;
  tokenIds: number[];
}

/**
 * Interface for the complete snapshot
 */
export interface FirstWorksSnapshot {
  contractAddress: string;
  contractName: string;
  totalSupply: number;
  timestamp: string; // ISO timestamp of snapshot creation
  blockNumber: number; // Block number at snapshot time
  holders: HolderData[];
  totalHolders: number;
  // Index for fast lookups: address -> tokenIds
  holderIndex: Record<string, number[]>;
}

/**
 * Create viem client for reading contract
 */
function createClient() {
  return createPublicClient({
    chain: mainnet,
    transport: http(FIRSTWORKS_RPC_URL),
  });
}

/**
 * Main snapshot generation class
 */
export class FirstWorksSnapshotGenerator {
  private client;
  private snapshotDir: string;

  constructor() {
    this.client = createClient();
    // Store snapshots in the same directory as this file
    this.snapshotDir = __dirname;
  }

  /**
   * Step 1: Get contract metadata
   */
  private async getContractMetadata() {
    console.log("=Ê Getting FirstWorks contract metadata...");

    const [name, symbol, totalSupply] = await Promise.all([
      this.client.readContract({
        address: FIRSTWORKS_ADDRESS,
        abi: AbrahamFirstWorks,
        functionName: "name",
      }),
      this.client.readContract({
        address: FIRSTWORKS_ADDRESS,
        abi: AbrahamFirstWorks,
        functionName: "symbol",
      }),
      this.client.readContract({
        address: FIRSTWORKS_ADDRESS,
        abi: AbrahamFirstWorks,
        functionName: "totalSupply",
      }),
    ]);

    console.log(`   Contract: ${name} (${symbol})`);
    console.log(`   Total Supply: ${totalSupply}`);

    return {
      name: name as string,
      symbol: symbol as string,
      totalSupply: Number(totalSupply),
    };
  }

  /**
   * Step 2: Get all token ownership in batches
   */
  private async getAllOwners(
    totalSupply: number
  ): Promise<Map<string, number[]>> {
    console.log("\n= Fetching token ownership...");

    const holders = new Map<string, number[]>();
    const batchSize = 50; // Process 50 tokens at a time

    let successCount = 0;
    let errorCount = 0;

    // Process tokens in batches
    for (let start = 1; start <= totalSupply; start += batchSize) {
      const end = Math.min(start + batchSize - 1, totalSupply);

      // Create batch of ownership check promises
      const batchPromises = [];
      for (let tokenId = start; tokenId <= end; tokenId++) {
        batchPromises.push(
          this.client
            .readContract({
              address: FIRSTWORKS_ADDRESS,
              abi: AbrahamFirstWorks,
              functionName: "ownerOf",
              args: [BigInt(tokenId)],
            })
            .then((owner) => ({
              tokenId,
              owner: owner as string,
              success: true,
            }))
            .catch((error) => ({ tokenId, owner: null, success: false, error }))
        );
      }

      // Execute batch in parallel
      const results = await Promise.all(batchPromises);

      // Process results
      for (const result of results) {
        if (result.success && result.owner) {
          successCount++;

          // Add to holder map
          const ownerLower = result.owner.toLowerCase();
          if (!holders.has(ownerLower)) {
            holders.set(ownerLower, []);
          }
          holders.get(ownerLower)!.push(result.tokenId);
        } else {
          errorCount++;
        }
      }

      // Progress update every 200 tokens
      if (start % 200 === 1 || end === totalSupply) {
        console.log(
          `   Progress: ${end}/${totalSupply} tokens processed (${holders.size} holders found)`
        );
      }
    }

    console.log(`\n Completed ownership scan:`);
    console.log(`   - Total tokens: ${totalSupply}`);
    console.log(`   - Successful: ${successCount}`);
    console.log(`   - Failed: ${errorCount}`);
    console.log(`   - Unique holders: ${holders.size}`);

    return holders;
  }

  /**
   * Step 3: Generate snapshot
   */
  async generateSnapshot(): Promise<FirstWorksSnapshot> {
    console.log("=€ Starting FirstWorks snapshot generation...\n");

    try {
      // Get contract metadata
      const metadata = await this.getContractMetadata();

      // Get current block number for snapshot metadata
      const blockNumber = await this.client.getBlockNumber();
      console.log(`   Snapshot at block: ${blockNumber}`);

      // Get all token owners
      const holdersMap = await this.getAllOwners(metadata.totalSupply);

      // Convert map to array format
      const holders: HolderData[] = Array.from(holdersMap.entries())
        .map(([address, tokenIds]) => ({
          address,
          balance: tokenIds.length,
          tokenIds: tokenIds.sort((a, b) => a - b), // Sort token IDs
        }))
        .sort((a, b) => b.balance - a.balance); // Sort by balance descending

      // Create fast lookup index
      const holderIndex: Record<string, number[]> = {};
      holders.forEach((holder) => {
        holderIndex[holder.address] = holder.tokenIds;
      });

      // Build final snapshot
      const snapshot: FirstWorksSnapshot = {
        contractAddress: FIRSTWORKS_ADDRESS,
        contractName: metadata.name,
        totalSupply: metadata.totalSupply,
        timestamp: new Date().toISOString(),
        blockNumber: Number(blockNumber),
        holders,
        totalHolders: holders.length,
        holderIndex,
      };

      console.log("\n=Ë Snapshot Summary:");
      console.log(`   Total Holders: ${snapshot.totalHolders}`);
      console.log(`   Total NFTs: ${snapshot.totalSupply}`);
      console.log(
        `   Top Holder: ${holders[0]?.address} (${holders[0]?.balance} NFTs)`
      );

      return snapshot;
    } catch (error) {
      console.error("L Snapshot generation failed:", error);
      throw error;
    }
  }

  /**
   * Step 4: Save snapshot to file
   */
  async saveSnapshot(snapshot: FirstWorksSnapshot): Promise<string> {
    const filename = `snapshot-${Date.now()}.json`;
    const filepath = path.join(this.snapshotDir, filename);

    // Save full snapshot
    await fs.promises.writeFile(filepath, JSON.stringify(snapshot, null, 2));
    console.log(`\n=¾ Snapshot saved: ${filepath}`);

    // Also save as "latest" for easy access
    const latestPath = path.join(this.snapshotDir, "latest.json");
    await fs.promises.writeFile(latestPath, JSON.stringify(snapshot, null, 2));
    console.log(`=¾ Latest snapshot: ${latestPath}`);

    return filepath;
  }

  /**
   * Main execution
   */
  async run(): Promise<void> {
    try {
      const snapshot = await this.generateSnapshot();
      await this.saveSnapshot(snapshot);

      console.log("\n( Snapshot generation completed successfully!");
      console.log(`=Á Snapshots directory: ${this.snapshotDir}`);
    } catch (error) {
      console.error("L Snapshot process failed:", error);
      process.exit(1);
    }
  }
}

/**
 * Helper function to load the latest snapshot
 */
export async function loadLatestSnapshot(): Promise<FirstWorksSnapshot | null> {
  try {
    const latestPath = path.join(__dirname, "latest.json");

    if (!fs.existsSync(latestPath)) {
      return null;
    }

    const data = await fs.promises.readFile(latestPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading snapshot:", error);
    return null;
  }
}

/**
 * Helper function to get NFTs for a specific address
 */
export function getNFTsForAddress(
  snapshot: FirstWorksSnapshot,
  address: string
): number[] {
  const addressLower = address.toLowerCase();
  return snapshot.holderIndex[addressLower] || [];
}

// Allow running as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  new FirstWorksSnapshotGenerator().run();
}
