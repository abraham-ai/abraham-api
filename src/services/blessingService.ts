/**
 * Blessing Tracking Service
 *
 * Purpose: Track blessings per user with 24-hour reset logic
 *
 * Logic:
 * - If you own N NFTs, you can perform B×N blessings per 24-hour period
 * - Each 24-hour period starts from midnight UTC
 * - Blessing count resets every 24 hours
 *
 * This implementation uses in-memory storage.
 * For production, consider using Redis or a database.
 */

import {
  loadLatestSnapshot,
  getNFTsForAddress,
  FirstWorksSnapshot,
} from "../../lib/snapshots/firstWorksSnapshot.js";

// Configuration: How many blessings per NFT owned
const BLESSINGS_PER_NFT = 1;

/**
 * User blessing data structure
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
 * Individual blessing record
 */
export interface BlessingRecord {
  id: string; // Unique blessing ID
  walletAddress: string; // Address that performed the blessing
  targetId: string; // ID of the creation/content that was blessed
  timestamp: string; // ISO timestamp of when the blessing occurred
  nftCount: number; // Number of NFTs owned at time of blessing
}

/**
 * Blessing tracking service
 */
class BlessingService {
  // In-memory storage: walletAddress -> UserBlessingData
  private blessingData: Map<string, UserBlessingData> = new Map();

  // Store all blessing records
  private blessingRecords: BlessingRecord[] = [];

  private snapshot: FirstWorksSnapshot | null = null;
  private lastSnapshotLoad: number = 0;
  private readonly SNAPSHOT_CACHE_MS = 5 * 60 * 1000; // Reload snapshot every 5 minutes

  constructor() {
    // Initialize snapshot on construction
    this.loadSnapshot();
  }

  /**
   * Generate a unique blessing ID
   */
  private generateBlessingId(): string {
    return `blessing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
   * Initialize or reset user blessing data
   */
  private async initializeUserData(
    walletAddress: string
  ): Promise<UserBlessingData> {
    const nftCount = await this.getNFTCount(walletAddress);
    const maxBlessings = nftCount * BLESSINGS_PER_NFT;
    const { start, end } = this.getCurrentPeriod();

    const data: UserBlessingData = {
      walletAddress: walletAddress.toLowerCase(),
      nftCount,
      maxBlessings,
      usedBlessings: 0,
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
   * Perform a blessing (decrements remaining blessings and stores the record)
   */
  async performBlessing(
    walletAddress: string,
    targetId: string
  ): Promise<{
    success: boolean;
    remainingBlessings: number;
    blessing?: BlessingRecord;
    error?: string;
  }> {
    // Check eligibility first
    const eligibility = await this.canBless(walletAddress);

    if (!eligibility.eligible) {
      return {
        success: false,
        remainingBlessings: eligibility.remainingBlessings,
        error: eligibility.reason,
      };
    }

    // Perform the blessing
    const data = await this.getUserData(walletAddress);
    data.usedBlessings += 1;

    const remainingBlessings = data.maxBlessings - data.usedBlessings;

    // Create and store the blessing record
    const blessingRecord: BlessingRecord = {
      id: this.generateBlessingId(),
      walletAddress: walletAddress.toLowerCase(),
      targetId,
      timestamp: new Date().toISOString(),
      nftCount: data.nftCount,
    };

    this.blessingRecords.push(blessingRecord);

    console.log(
      `✅ Blessing performed: ${walletAddress} -> ${targetId} (${remainingBlessings} remaining)`
    );

    return {
      success: true,
      remainingBlessings,
      blessing: blessingRecord,
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
   * Get all blessing records with optional filters
   */
  getAllBlessings(options?: {
    walletAddress?: string;
    targetId?: string;
    limit?: number;
    offset?: number;
    sortOrder?: "asc" | "desc";
  }): {
    blessings: BlessingRecord[];
    total: number;
    limit: number;
    offset: number;
  } {
    let filteredBlessings = [...this.blessingRecords];

    // Filter by wallet address
    if (options?.walletAddress) {
      const addressLower = options.walletAddress.toLowerCase();
      filteredBlessings = filteredBlessings.filter(
        (b) => b.walletAddress === addressLower
      );
    }

    // Filter by targetId
    if (options?.targetId) {
      filteredBlessings = filteredBlessings.filter(
        (b) => b.targetId === options.targetId
      );
    }

    // Sort by timestamp (default: most recent first)
    const sortOrder = options?.sortOrder || "desc";
    filteredBlessings.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });

    const total = filteredBlessings.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || total;

    // Apply pagination
    const paginatedBlessings = filteredBlessings.slice(offset, offset + limit);

    return {
      blessings: paginatedBlessings,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get blessings for a specific target
   */
  getBlessingsForTarget(targetId: string): BlessingRecord[] {
    return this.blessingRecords
      .filter((b) => b.targetId === targetId)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }

  /**
   * Get blessings by a specific wallet
   */
  getBlessingsByWallet(walletAddress: string): BlessingRecord[] {
    const addressLower = walletAddress.toLowerCase();
    return this.blessingRecords
      .filter((b) => b.walletAddress === addressLower)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }

  /**
   * Get blessing count for a target
   */
  getBlessingCountForTarget(targetId: string): number {
    return this.blessingRecords.filter((b) => b.targetId === targetId).length;
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
