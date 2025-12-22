/**
 * Blessing Service
 *
 * Purpose: Orchestrate blessing operations including eligibility checks,
 * blockchain interactions, and rate limiting
 *
 * Logic:
 * - If you own N NFTs, you can perform B×N blessings per 24-hour period
 * - Each 24-hour period starts from midnight UTC
 * - Blessing count resets every 24 hours
 * - Blessings are written to and read from blockchain (TheSeeds contract)
 * - Local tracking ONLY for rate limiting (not blessing records)
 *
 * This implementation uses in-memory storage for rate limiting only.
 * For production, consider using Redis or a database.
 */

import {
  loadLatestSnapshot,
  getNFTsForAddress,
  FirstWorksSnapshot,
} from "../../lib/snapshots/firstWorksSnapshot.js";
import { loadMerkleTree } from "../../lib/snapshots/merkleTreeGenerator.js";
import { contractService } from "./contractService.js";
import type { Address, Hash } from "viem";

interface MerkleProof {
  root: string;
  proofs: Record<string, string[]>;
  leaves: Record<string, string>;
}

// Configuration: How many blessings per NFT owned
const BLESSINGS_PER_NFT = 1;

/**
 * User blessing data structure (for rate limiting only)
 */
interface UserBlessingData {
  walletAddress: string;
  nftCount: number;
  maxBlessings: number; // Total blessings allowed per period
  usedBlessings: number; // Blessings used in current period
  periodStart: string; // ISO timestamp of current period start
  periodEnd: string; // ISO timestamp of current period end
}

/**
 * Blessing tracking service
 */
class BlessingService {
  // In-memory storage for rate limiting: walletAddress -> UserBlessingData
  private blessingData: Map<string, UserBlessingData> = new Map();

  private snapshot: FirstWorksSnapshot | null = null;
  private merkleTree: MerkleProof | null = null;
  private lastSnapshotLoad: number = 0;
  private readonly SNAPSHOT_CACHE_MS = 5 * 60 * 1000; // Reload snapshot every 5 minutes

  constructor() {
    // Initialize snapshot and merkle tree on construction
    this.loadSnapshot();
    this.loadMerkleData();
  }

  /**
   * Load Merkle tree for proof generation
   */
  private async loadMerkleData(): Promise<void> {
    try {
      this.merkleTree = await loadMerkleTree();
      if (this.merkleTree) {
        console.log("✅ Loaded Merkle tree with root:", this.merkleTree.root.slice(0, 10) + "...");
      } else {
        console.warn("⚠️  No Merkle tree found. Run 'npm run merkle:generate' to create one.");
      }
    } catch (error) {
      console.error("❌ Error loading Merkle tree:", error);
    }
  }

  /**
   * Load or reload the NFT snapshot
   */
  private async loadSnapshot(): Promise<void> {
    const now = Date.now();

    // Only reload if cache is stale
    if (now - this.lastSnapshotLoad < this.SNAPSHOT_CACHE_MS && this.snapshot) {
      return;
    }

    try {
      this.snapshot = await loadLatestSnapshot();
      this.lastSnapshotLoad = now;

      if (this.snapshot) {
        console.log(
          `✅ Loaded snapshot: ${this.snapshot.totalHolders} holders, ${this.snapshot.totalSupply} NFTs`
        );
      } else {
        console.warn(
          "⚠️  No snapshot found. Run the snapshot generator first."
        );
      }
    } catch (error) {
      console.error("❌ Error loading snapshot:", error);
    }
  }

  /**
   * Get the current 24-hour period start and end times (UTC)
   */
  private getCurrentPeriod(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0); // Start of today (UTC)

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1); // Start of tomorrow (UTC)

    return { start, end };
  }

  /**
   * Check if a period has expired
   */
  private isPeriodExpired(periodEnd: string): boolean {
    return new Date(periodEnd) <= new Date();
  }

  /**
   * Get NFT count for a wallet address
   */
  private async getNFTCount(walletAddress: string): Promise<number> {
    await this.loadSnapshot();

    if (!this.snapshot) {
      return 0;
    }

    const nfts = getNFTsForAddress(this.snapshot, walletAddress);
    return nfts.length;
  }

  /**
   * Get tokenIds and Merkle proof for a user
   * Required for on-chain eligibility verification
   */
  private async getTokenIdsAndProof(
    walletAddress: string
  ): Promise<{ tokenIds: number[]; proof: string[] } | null> {
    await this.loadSnapshot();

    if (!this.snapshot || !this.merkleTree) {
      console.error("Snapshot or Merkle tree not loaded");
      return null;
    }

    const addressLower = walletAddress.toLowerCase();

    // Get token IDs from snapshot
    const tokenIds = this.snapshot.holderIndex[addressLower] || [];

    // Get Merkle proof
    const proof = this.merkleTree.proofs[addressLower] || [];

    if (tokenIds.length === 0) {
      return null; // User owns no NFTs
    }

    return { tokenIds, proof };
  }

  /**
   * Count how many blessings a user has performed in the current period
   * Uses the contract's built-in daily blessing counter (resets at midnight UTC)
   */
  private async countBlessingsInCurrentPeriod(
    walletAddress: string
  ): Promise<number> {
    try {
      // Get the daily blessing count directly from the contract
      // The contract tracks this internally and resets at midnight UTC
      const dailyCount = await contractService.getUserDailyBlessingCount(
        walletAddress as Address
      );

      return Number(dailyCount);
    } catch (error) {
      console.error(
        `Error fetching daily blessing count for ${walletAddress}:`,
        error
      );
      // Return 0 if we can't fetch from blockchain
      return 0;
    }
  }

  /**
   * Initialize or reset user blessing data
   * Fetches actual blessing count from blockchain to ensure accuracy
   */
  private async initializeUserData(
    walletAddress: string
  ): Promise<UserBlessingData> {
    const nftCount = await this.getNFTCount(walletAddress);
    const maxBlessings = nftCount * BLESSINGS_PER_NFT;
    const { start, end } = this.getCurrentPeriod();

    // Fetch actual number of blessings used today from the blockchain
    const usedBlessings = await this.countBlessingsInCurrentPeriod(
      walletAddress
    );

    const data: UserBlessingData = {
      walletAddress: walletAddress.toLowerCase(),
      nftCount,
      maxBlessings,
      usedBlessings,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };

    this.blessingData.set(walletAddress.toLowerCase(), data);
    return data;
  }

  /**
   * Get user blessing data (creates/resets if needed)
   */
  private async getUserData(
    walletAddress: string
  ): Promise<UserBlessingData> {
    const addressLower = walletAddress.toLowerCase();
    let data = this.blessingData.get(addressLower);

    // If no data exists or period has expired, initialize/reset
    if (!data || this.isPeriodExpired(data.periodEnd)) {
      data = await this.initializeUserData(walletAddress);
    }

    return data;
  }

  /**
   * Check if a user is eligible to bless
   */
  async canBless(walletAddress: string): Promise<{
    eligible: boolean;
    nftCount: number;
    maxBlessings: number;
    usedBlessings: number;
    remainingBlessings: number;
    periodEnd: string;
    reason?: string;
  }> {
    const data = await this.getUserData(walletAddress);

    const remainingBlessings = data.maxBlessings - data.usedBlessings;
    const eligible = remainingBlessings > 0;

    let reason: string | undefined;
    if (!eligible) {
      if (data.nftCount === 0) {
        reason = "No NFTs owned";
      } else {
        reason = "All blessings used for this period";
      }
    }

    return {
      eligible,
      nftCount: data.nftCount,
      maxBlessings: data.maxBlessings,
      usedBlessings: data.usedBlessings,
      remainingBlessings,
      periodEnd: data.periodEnd,
      reason,
    };
  }

  /**
   * Perform a blessing onchain (backend-signed, gasless for user)
   * This is the main method that orchestrates the entire blessing flow
   * Now with on-chain eligibility verification using Merkle proofs
   */
  async performBlessingOnchain(
    walletAddress: string,
    seedId: number
  ): Promise<{
    success: boolean;
    txHash?: Hash;
    blessingCount?: number;
    remainingBlessings?: number;
    error?: string;
    blockExplorer?: string;
  }> {
    // 1. Get tokenIds and Merkle proof for on-chain verification
    const proofData = await this.getTokenIdsAndProof(walletAddress);

    if (!proofData) {
      return {
        success: false,
        error: "No NFTs owned or unable to generate proof",
      };
    }

    // 2. Check if backend can submit blessings
    if (!contractService.canSubmitBlessings()) {
      return {
        success: false,
        error: "Backend blessing service not configured (RELAYER_PRIVATE_KEY not set)",
      };
    }

    // 3. Check if blessing period has ended
    const timeRemaining = await contractService.getTimeUntilPeriodEnd();
    if (timeRemaining === 0n) {
      return {
        success: false,
        error: "Blessing period has ended. Waiting for winner selection to start new round.",
      };
    }

    // 4. Check if seed exists and is not a winner
    try {
      const seed = await contractService.getSeed(seedId);
      if (seed.isWinner) {
        return {
          success: false,
          error: "Cannot bless a winning seed",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: "Seed not found",
      };
    }

    // 5. Submit blessing to blockchain with NFT proof
    // Contract will verify ownership and daily limits on-chain
    const result = await contractService.blessSeedFor(
      seedId,
      walletAddress as Address,
      proofData.tokenIds,
      proofData.proof
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to submit blessing to blockchain",
      };
    }

    // 6. Get updated seed info and calculate remaining blessings
    const updatedSeed = await contractService.getSeed(seedId);

    // Calculate remaining blessings based on on-chain data
    const maxBlessings = proofData.tokenIds.length * BLESSINGS_PER_NFT;
    const usedBlessings = await this.countBlessingsInCurrentPeriod(walletAddress);
    const remainingBlessings = Math.max(0, maxBlessings - usedBlessings);

    // 7. Update cached user data with the new blessing count
    const addressLower = walletAddress.toLowerCase();
    const cachedData = this.blessingData.get(addressLower);
    if (cachedData) {
      cachedData.usedBlessings = usedBlessings;
      cachedData.maxBlessings = maxBlessings;
      cachedData.nftCount = proofData.tokenIds.length;
      this.blessingData.set(addressLower, cachedData);
    }

    const blockExplorer =
      process.env.NETWORK === "base"
        ? `https://basescan.org/tx/${result.txHash}`
        : `https://sepolia.basescan.org/tx/${result.txHash}`;

    console.log(
      `✅ Blessing performed onchain: ${walletAddress} -> seed ${seedId} (${remainingBlessings} remaining)`
    );
    console.log(`   Tx: ${result.txHash}`);

    return {
      success: true,
      txHash: result.txHash,
      blessingCount: Number(updatedSeed.blessings),
      remainingBlessings,
      blockExplorer,
    };
  }

  /**
   * Prepare a blessing transaction for client-side signing
   * Returns transaction data for user to sign with their wallet
   * Now includes NFT ownership proof for on-chain verification
   */
  async prepareBlessingTransaction(
    walletAddress: string,
    seedId: number
  ): Promise<{
    success: boolean;
    transaction?: {
      to: Address;
      data: `0x${string}`;
      from: Address;
      chainId?: number;
    };
    seedInfo?: {
      id: number;
      ipfsHash: string;
      creator: Address;
      currentBlessings: number;
    };
    userInfo?: {
      address: string;
      nftCount: number;
      remainingBlessings: number;
    };
    error?: string;
  }> {
    // 1. Get tokenIds and Merkle proof
    const proofData = await this.getTokenIdsAndProof(walletAddress);

    if (!proofData) {
      return {
        success: false,
        error: "No NFTs owned or unable to generate proof",
      };
    }

    // 2. Check if blessing period has ended
    const timeRemaining = await contractService.getTimeUntilPeriodEnd();
    if (timeRemaining === 0n) {
      return {
        success: false,
        error: "Blessing period has ended. Waiting for winner selection to start new round.",
      };
    }

    // 3. Check if seed exists and is not a winner
    let seed;
    try {
      seed = await contractService.getSeed(seedId);
      if (seed.isWinner) {
        return {
          success: false,
          error: "Cannot bless a winning seed",
        };
      }
    } catch (error) {
      return {
        success: false,
        error: "Seed not found",
      };
    }

    // 4. Prepare transaction data with NFT proof
    const transaction = contractService.prepareBlessingTransaction(
      seedId,
      walletAddress as Address,
      proofData.tokenIds,
      proofData.proof
    );

    // Calculate remaining blessings
    const maxBlessings = proofData.tokenIds.length * BLESSINGS_PER_NFT;
    const usedBlessings = await this.countBlessingsInCurrentPeriod(walletAddress);
    const remainingBlessings = Math.max(0, maxBlessings - usedBlessings);

    return {
      success: true,
      transaction,
      seedInfo: {
        id: Number(seed.id),
        ipfsHash: seed.ipfsHash,
        creator: seed.creator,
        currentBlessings: Number(seed.blessings),
      },
      userInfo: {
        address: walletAddress,
        nftCount: proofData.tokenIds.length,
        remainingBlessings,
      },
    };
  }

  /**
   * Prepare delegate approval transaction for client-side signing
   * Users must approve backend to enable gasless blessings
   */
  async prepareDelegateApprovalTransaction(
    walletAddress: string,
    approved: boolean = true
  ): Promise<{
    success: boolean;
    transaction?: {
      to: Address;
      data: `0x${string}`;
      from: Address;
      chainId?: number;
    };
    delegateAddress?: Address;
    currentStatus?: string;
    error?: string;
  }> {
    const relayerAddress = contractService.getRelayerAddress();
    if (!relayerAddress) {
      return {
        success: false,
        error: "Backend relayer not configured",
      };
    }

    // Check current delegation status
    const isCurrentlyDelegate = await contractService.isDelegate(
      walletAddress as Address,
      relayerAddress
    );

    // Prepare transaction
    const transaction = contractService.prepareDelegateApprovalTransaction(
      walletAddress as Address,
      relayerAddress,
      approved
    );

    return {
      success: true,
      transaction,
      delegateAddress: relayerAddress,
      currentStatus: isCurrentlyDelegate ? "Already approved" : "Not yet approved",
    };
  }

  /**
   * Legacy method: Update rate limiting after a blessing
   * Used for backwards compatibility - just updates local rate limit tracking
   * @deprecated This is automatically handled by performBlessingOnchain
   */
  async performBlessing(
    walletAddress: string,
    targetId: string
  ): Promise<{
    success: boolean;
    remainingBlessings: number;
    error?: string;
  }> {
    // Just update rate limiting
    const data = await this.getUserData(walletAddress);
    data.usedBlessings += 1;

    const remainingBlessings = data.maxBlessings - data.usedBlessings;

    console.log(
      `✅ Rate limit updated: ${walletAddress} -> ${targetId} (${remainingBlessings} remaining)`
    );

    return {
      success: true,
      remainingBlessings,
    };
  }

  /**
   * Get blessing stats for a user
   */
  async getBlessingStats(walletAddress: string): Promise<{
    nftCount: number;
    maxBlessings: number;
    usedBlessings: number;
    remainingBlessings: number;
    periodStart: string;
    periodEnd: string;
  }> {
    const data = await this.getUserData(walletAddress);

    return {
      nftCount: data.nftCount,
      maxBlessings: data.maxBlessings,
      usedBlessings: data.usedBlessings,
      remainingBlessings: data.maxBlessings - data.usedBlessings,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
    };
  }

  /**
   * Get blessing count for a specific user on a seed
   * @deprecated The contract no longer stores individual blessing records.
   * Use contractService.getBlessingCount(userAddress, seedId) instead.
   */
  async getBlessingCount(userAddress: string, seedId: number): Promise<number> {
    const count = await contractService.getBlessingCount(
      userAddress as Address,
      seedId
    );
    return Number(count);
  }

  /**
   * Get user's daily blessing count
   * Returns how many blessings the user has performed today
   */
  async getUserDailyBlessingCount(userAddress: string): Promise<number> {
    const count = await contractService.getUserDailyBlessingCount(
      userAddress as Address
    );
    return Number(count);
  }

  /**
   * Get total blessing count from blockchain
   * @deprecated Use contractService.getTotalBlessings() directly
   */
  async getTotalBlessingsCount(): Promise<number> {
    const total = await contractService.getTotalBlessings();
    return Number(total);
  }

  /**
   * Get the current snapshot
   */
  async getSnapshot(): Promise<FirstWorksSnapshot | null> {
    await this.loadSnapshot();
    return this.snapshot;
  }

  /**
   * Force reload the snapshot (useful after snapshot generation)
   */
  async reloadSnapshot(): Promise<void> {
    this.lastSnapshotLoad = 0;
    await this.loadSnapshot();
  }
}

// Singleton instance
export const blessingService = new BlessingService();
