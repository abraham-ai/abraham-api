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

// Load environment variables from .env files in development
// In production (Vercel), environment variables are provided by the platform
if (process.env.NODE_ENV !== "production") {
  // Dynamically import dotenv only in development
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FirstWorks contract address
const FIRSTWORKS_ADDRESS =
  (process.env.FIRSTWORKS_CONTRACT_ADDRESS as `0x${string}`) ||
  "0x8F814c7C75C5E9e0EDe0336F535604B1915C1985";
const FIRSTWORKS_RPC_URL = process.env.FIRSTWORKS_RPC_URL;

/**
 * Validate environment variables (only when running as script)
 */
function validateEnvironmentVariables(): void {
  if (!FIRSTWORKS_ADDRESS) {
    console.error("❌ Error: FIRSTWORKS_CONTRACT_ADDRESS is not set");
    console.error(
      "   Please add it to your .env.local file or Vercel environment variables"
    );
    process.exit(1);
  }

  if (
    !FIRSTWORKS_RPC_URL ||
    FIRSTWORKS_RPC_URL === "your_ethereum_rpc_url_here"
  ) {
    console.error(
      "❌ Error: FIRSTWORKS_RPC_URL is not set or using placeholder"
    );
    console.error(
      "   Please add a valid Ethereum RPC URL to your .env.local file"
    );
    console.error("   Or set it in Vercel environment variables dashboard");
    console.error(
      "   Example: FIRSTWORKS_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
    );
    console.error("\n   Get a free RPC URL from:");
    console.error("   - Alchemy: https://www.alchemy.com/");
    console.error("   - Infura: https://www.infura.io/");
    process.exit(1);
  }
}

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
    // On Vercel, use /tmp (only writable location)
    // Locally, use the snapshots directory
    this.snapshotDir = process.env.VERCEL ? '/tmp' : __dirname;
  }

  /**
   * Step 1: Get contract metadata
   */
  private async getContractMetadata() {
    console.log("=� Getting FirstWorks contract metadata...");

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
   * Step 2: Get all token ownership using Alchemy NFT API (FAST)
   * Falls back to RPC calls if Alchemy is not available
   */
  private async getAllOwners(
    totalSupply: number
  ): Promise<Map<string, number[]>> {
    console.log("\n⚡ Fetching token ownership...");

    // Debug: Log the RPC URL (masked for security)
    const maskedUrl = FIRSTWORKS_RPC_URL
      ? FIRSTWORKS_RPC_URL.replace(/\/([^/]{10})[^/]*$/, '/$1***')
      : 'NOT SET';
    console.log(`   RPC URL: ${maskedUrl}`);

    // Try Alchemy NFT API first (much faster - completes in seconds)
    const isAlchemy = FIRSTWORKS_RPC_URL &&
      (FIRSTWORKS_RPC_URL.includes('alchemy.com') || FIRSTWORKS_RPC_URL.includes('alchemyapi.io'));

    console.log(`   Alchemy detected: ${isAlchemy}`);

    if (isAlchemy) {
      try {
        console.log("   Using Alchemy NFT API (fast method)...");
        return await this.getAllOwnersViaAlchemy();
      } catch (error) {
        console.warn("   ⚠️ Alchemy API failed, falling back to RPC calls...");
        console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      console.log("   ⚠️ Alchemy not detected - using slower RPC method");
      console.log("   💡 Tip: Use Alchemy RPC for 100x faster snapshot generation");
    }

    // Fallback to traditional RPC method (slower but works with any RPC)
    console.log("   Using RPC calls (slower method)...");
    return await this.getAllOwnersViaRPC(totalSupply);
  }

  /**
   * Get all owners using Alchemy's NFT API (FAST - ~2-5 seconds)
   */
  private async getAllOwnersViaAlchemy(): Promise<Map<string, number[]>> {
    const holders = new Map<string, number[]>();

    // Extract Alchemy API key from RPC URL
    const alchemyKey = FIRSTWORKS_RPC_URL!.split('/').pop();
    const alchemyBaseUrl = `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey}`;

    let pageKey: string | undefined;
    let totalFetched = 0;

    do {
      const url = new URL(`${alchemyBaseUrl}/getOwnersForContract`);
      url.searchParams.set('contractAddress', FIRSTWORKS_ADDRESS);
      url.searchParams.set('withTokenBalances', 'true');
      if (pageKey) {
        url.searchParams.set('pageKey', pageKey);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Alchemy API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Process owners from this page
      for (const owner of data.owners || []) {
        const address = owner.ownerAddress.toLowerCase();
        // Alchemy returns tokenIds as decimal strings or hex strings with "0x" prefix
        // Use Number() to correctly parse both formats:
        //   - Decimal: "628" → 628 ✓
        //   - Hex: "0x274" → 628 ✓
        // CRITICAL: DO NOT use parseInt(x, 16) - it treats decimal strings as hex!
        //   - parseInt("628", 16) = 1576 ❌ (treats 628 as hex)
        //   - parseInt("2281", 16) = 8833 ❌ (treats 2281 as hex)
        const tokenIds = owner.tokenBalances?.map((t: any) => Number(t.tokenId)) || [];

        if (tokenIds.length > 0) {
          holders.set(address, tokenIds);
          totalFetched += tokenIds.length;
        }
      }

      pageKey = data.pageKey;
      console.log(`   Fetched ${totalFetched} tokens so far...`);
    } while (pageKey);

    console.log(`   ✅ Fetched all ${totalFetched} tokens via Alchemy API`);
    return holders;
  }

  /**
   * Get all owners using RPC calls (SLOW - fallback method)
   */
  private async getAllOwnersViaRPC(
    totalSupply: number
  ): Promise<Map<string, number[]>> {
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

    console.log(`\n Completed ownership scan:`);
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
    console.log("=� Starting FirstWorks snapshot generation...\n");

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

      console.log("\n=� Snapshot Summary:");
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
   * Step 4: Save snapshot to file and upload to Vercel Blob
   */
  async saveSnapshot(snapshot: FirstWorksSnapshot): Promise<string> {
    const filename = `snapshot-${Date.now()}.json`;
    const filepath = path.join(this.snapshotDir, filename);

    // Save full snapshot locally
    await fs.promises.writeFile(filepath, JSON.stringify(snapshot, null, 2));
    console.log(`\n=� Snapshot saved: ${filepath}`);

    // Also save as "latest" for easy access
    const latestPath = path.join(this.snapshotDir, "latest.json");
    await fs.promises.writeFile(latestPath, JSON.stringify(snapshot, null, 2));
    console.log(`=� Latest snapshot: ${latestPath}`);

    // Upload to Vercel Blob storage (if configured)
    try {
      const { uploadToBlob, cleanupOldBlobs, isBlobStorageConfigured } = await import("../storage/blobStorage.js");

      if (isBlobStorageConfigured()) {
        console.log("\n☁️  Uploading snapshot to Vercel Blob storage...");
        await uploadToBlob(snapshot, 'snapshot');

        // Clean up old snapshots (keep last 5 versions)
        await cleanupOldBlobs('snapshot', 5);

        console.log("✓ Snapshot uploaded and old versions cleaned up");
      } else {
        console.log("\n⚠️  Blob storage not configured (BLOB_READ_WRITE_TOKEN missing)");
        console.log("   Skipping upload to blob storage");
      }
    } catch (error) {
      console.error("⚠️  Failed to upload to blob storage:", error);
      console.log("   Continuing with local snapshot only");
    }

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
      console.log(`=� Snapshots directory: ${this.snapshotDir}`);
    } catch (error) {
      console.error("L Snapshot process failed:", error);
      process.exit(1);
    }
  }
}

/**
 * Helper function to load the latest snapshot
 * Priority order:
 * 1. Vercel Blob storage (if configured and on Vercel)
 * 2. Local /tmp directory (if on Vercel and file exists)
 * 3. Committed snapshot from source
 */
export async function loadLatestSnapshot(): Promise<FirstWorksSnapshot | null> {
  try {
    // Try Vercel Blob storage first (if configured)
    try {
      const { downloadFromBlob, isBlobStorageConfigured } = await import("../storage/blobStorage.js");

      if (isBlobStorageConfigured()) {
        console.log("Attempting to load snapshot from Vercel Blob storage...");
        const blobData = await downloadFromBlob('snapshot');
        if (blobData) {
          console.log("✓ Loaded snapshot from Vercel Blob storage");
          return blobData;
        }
      }
    } catch (error) {
      console.log("Blob storage not available, falling back to local files");
    }

    // Fallback to local files
    // On Vercel, check /tmp first (if snapshot was just generated)
    // Otherwise use the committed snapshot from source
    const paths = process.env.VERCEL
      ? ["/tmp/latest.json", path.join(__dirname, "latest.json")]
      : [path.join(__dirname, "latest.json")];

    for (const latestPath of paths) {
      if (fs.existsSync(latestPath)) {
        const data = await fs.promises.readFile(latestPath, "utf-8");
        console.log(`Loaded snapshot from ${latestPath}`);
        return JSON.parse(data);
      }
    }

    console.log("No snapshot found");
    return null;
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
  // Validate environment variables before running
  validateEnvironmentVariables();
  new FirstWorksSnapshotGenerator().run();
}
