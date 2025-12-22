import { Address } from "viem";
import { contractService } from "./contractService.js";
import { blessingService } from "./blessingService.js";

// Leaderboard timeframe options
export type LeaderboardTimeframe = "daily" | "weekly" | "monthly" | "yearly" | "lifetime";

// Timeframe durations in seconds
const TIMEFRAME_SECONDS: Record<LeaderboardTimeframe, number | null> = {
  daily: 24 * 60 * 60,        // 1 day
  weekly: 7 * 24 * 60 * 60,   // 7 days
  monthly: 30 * 24 * 60 * 60, // 30 days
  yearly: 365 * 24 * 60 * 60, // 365 days
  lifetime: null,              // All time
};

// Scoring weights for leaderboard calculation
// Hybrid approach: combines square root scaling with daily efficiency
// NFTs don't give points - they're just the prerequisite to bless
const WEIGHTS = {
  SQRT_BLESSING_BASE: 50, // Base points for sqrt(total blessings) - prevents whale dominance
  BLESSING_EFFICIENCY: 100, // Reward for using your blessing power effectively (7-day window)
  WINNING_BLESSING_BASE: 50, // Base points for blessing a winning seed
  EARLY_BIRD_MULTIPLIER: 2.0, // Multiplier for early blessings (up to 2x)
  CURATION_ACCURACY: 150, // Reward for high win rate (blessed winners / total blessings)
  RECENCY_MULTIPLIER: 1.3, // Multiplier for recent activity (last 30 days)
};

interface LeaderboardEntry {
  address: string;
  nftCount: number;
  blessingCount: number;
  winningBlessings: number;
  recentActivity: boolean;
  score: number;
  rank?: number;
  // New detailed stats
  blessingEfficiency: number;
  curationAccuracy: number;
  avgEarlyBirdScore?: number;
}

interface UserStats {
  address: string;
  nftCount: number;
  blessingCount: number;
  winningBlessings: number;
  recentActivity: boolean;
  blessings: Array<{
    seedId: number;
    timestamp: number;
    wasWinner: boolean;
    seedCreatedAt: number;
    earlyBirdScore: number; // 0-1 based on how early the blessing was
  }>;
  maxPossibleBlessings: number; // NFT count × daily limit
  blessingEfficiency: number; // 0-1 ratio
  curationAccuracy: number; // 0-1 ratio of winning blessings
}

class LeaderboardService {
  /**
   * Get all unique addresses from NFT holders and blessers
   */
  private async getAllParticipants(): Promise<Set<string>> {
    const participants = new Set<string>();

    // Get NFT holders from snapshot
    const snapshot = await blessingService.getSnapshot();
    if (snapshot) {
      snapshot.holders.forEach((holder) => {
        participants.add(holder.address.toLowerCase());
      });
    }

    // Note: The contract no longer stores individual blessing records
    // We can't get the list of all participants anymore
    // This functionality needs to be redesigned or removed
    console.warn("getAllParticipants: Individual blessing records are no longer available in the contract");

    // Return empty set for now
    // TODO: Implement alternative way to track participants (e.g., event logs, off-chain indexing)
    return participants;
  }

  /**
   * Get comprehensive stats for a user address
   * @param address - User's wallet address
   * @param timeframe - Time period to filter blessings (optional, defaults to lifetime)
   */
  private async getUserStats(
    address: Address,
    timeframe: LeaderboardTimeframe = "lifetime"
  ): Promise<UserStats> {
    const lowerAddress = address.toLowerCase() as Address;

    // Get NFT count from snapshot
    const snapshot = await blessingService.getSnapshot();
    const nftCount = snapshot?.holderIndex[lowerAddress]?.length || 0;

    // Note: The contract no longer stores individual blessing records
    // We can only get the daily blessing count
    console.warn("getUserStats: Individual blessing records are no longer available in the contract");

    // Get daily blessing count as a fallback
    const dailyBlessingCount = await contractService.getUserDailyBlessingCount(lowerAddress);

    // Return minimal stats based on available data
    // TODO: Implement alternative way to track user stats (e.g., event logs, off-chain indexing)
    const userBlessings: any[] = []; // Empty array since we don't have individual records

    // This section will not work without individual blessing records
    const blessingsWithWinStatus = await Promise.all(
      userBlessings.map(async (blessing) => {
        try {
          const seed = await contractService.getSeed(Number(blessing.seedId));
          const blessingTime = Number(blessing.timestamp);
          const seedCreatedAt = Number(seed.createdAt);

          // Calculate early bird score (0-1)
          // Earlier blessings get higher scores
          // If seed was a winner, calculate relative timing
          let earlyBirdScore = 0;
          if (seed.isWinner && blessingTime > seedCreatedAt) {
            // Assume average time to winner selection is 7 days (adjustable)
            const avgTimeToWinner = 7 * 24 * 60 * 60; // 7 days in seconds
            const timeSinceCreation = blessingTime - seedCreatedAt;
            const timeRatio = timeSinceCreation / avgTimeToWinner;

            // Score from 1 (immediate) to 0 (very late)
            // Using exponential decay for more dramatic early bird advantage
            earlyBirdScore = Math.max(0, Math.exp(-timeRatio * 2));
          } else if (!seed.isWinner && blessingTime > seedCreatedAt) {
            // For non-winning seeds, just give a small score for early blessing
            const daysSinceCreation = (blessingTime - seedCreatedAt) / (24 * 60 * 60);
            earlyBirdScore = Math.max(0, 1 - daysSinceCreation / 30); // Decay over 30 days
          }

          return {
            seedId: Number(blessing.seedId),
            timestamp: blessingTime,
            wasWinner: seed.isWinner,
            seedCreatedAt,
            earlyBirdScore: Math.max(0, Math.min(1, earlyBirdScore)), // Clamp 0-1
          };
        } catch (error) {
          return {
            seedId: Number(blessing.seedId),
            timestamp: Number(blessing.timestamp),
            wasWinner: false,
            seedCreatedAt: 0,
            earlyBirdScore: 0,
          };
        }
      })
    );

    const winningBlessings = blessingsWithWinStatus.filter(
      (b) => b.wasWinner
    ).length;

    // Check for recent activity (last 30 days)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const recentActivity = blessingsWithWinStatus.some(
      (b) => b.timestamp > thirtyDaysAgo
    );

    // Calculate blessing efficiency over time (accumulated daily)
    // Measures if user is consistently using their daily blessing allowance
    // Uses 7-day rolling window for fairness (matches our snapshot retention)
    const BLESSINGS_PER_NFT_PER_DAY = 1;
    const EFFICIENCY_WINDOW_DAYS = 7;

    // Determine the time period to measure efficiency
    // Use either 7 days or time since first blessing (whichever is shorter)
    let daysActive = 0;
    let blessingsInPeriod = 0;

    if (userBlessings.length > 0) {
      // Find earliest blessing timestamp
      const firstBlessingTime = Math.min(...blessingsWithWinStatus.map(b => b.timestamp));
      const now = Math.floor(Date.now() / 1000);

      // Calculate days since first blessing (max 7 days for efficiency window)
      const daysSinceFirst = Math.floor((now - firstBlessingTime) / (24 * 60 * 60));
      daysActive = Math.min(EFFICIENCY_WINDOW_DAYS, Math.max(1, daysSinceFirst)); // At least 1 day

      // Count blessings within the measurement period
      const periodStart = now - (daysActive * 24 * 60 * 60);
      blessingsInPeriod = blessingsWithWinStatus.filter(
        b => b.timestamp >= periodStart
      ).length;
    }

    // Calculate max possible blessings over the active period
    // maxPossible = NFTs × days active × blessings per NFT per day
    const maxPossibleBlessings = nftCount * daysActive * BLESSINGS_PER_NFT_PER_DAY;

    // Calculate efficiency: actual usage vs. potential over time
    const blessingEfficiency = maxPossibleBlessings > 0
      ? Math.min(1, blessingsInPeriod / maxPossibleBlessings)
      : 0;

    // Calculate curation accuracy (winning rate)
    const curationAccuracy = userBlessings.length > 0
      ? winningBlessings / userBlessings.length
      : 0;

    return {
      address: lowerAddress,
      nftCount,
      blessingCount: userBlessings.length,
      winningBlessings,
      recentActivity,
      blessings: blessingsWithWinStatus,
      maxPossibleBlessings,
      blessingEfficiency,
      curationAccuracy,
    };
  }

  /**
   * Calculate engagement score for a user using sophisticated multi-factor formula
   *
   * Hybrid Lifetime Leaderboard Strategy:
   * - Square root scaling for total blessing volume (prevents whale dominance)
   * - Daily efficiency over 7-day rolling window (rewards consistency)
   * - Early bird bonus for winning blessings (rewards early curation)
   * - Curation accuracy (rewards quality over quantity)
   *
   * Design Goals:
   * - Reward quality curation over quantity
   * - NFTs don't give points directly - they're just the prerequisite to bless
   * - Prevent whales from dominating through sheer volume
   * - Incentivize efficient use of blessing power
   * - Reward early and accurate curation
   *
   * IMPORTANT: 0 blessings = 0 points, regardless of NFT count
   */
  private calculateScore(stats: UserStats): number {
    // No blessings = no points (NFTs alone don't count)
    if (stats.blessingCount === 0) {
      return 0;
    }

    let score = 0;

    // 1. Square Root Scaling for Total Blessings
    // Prevents whale dominance - 100 blessings isn't 10x better than 10 blessings
    // sqrt(100) = 10, sqrt(10) = 3.16, so 100 is only ~3x better than 10
    const sqrtBlessingScore = Math.sqrt(stats.blessingCount) * WEIGHTS.SQRT_BLESSING_BASE;
    score += sqrtBlessingScore;

    // 2. Blessing Efficiency Score (7-day rolling window)
    // Rewards using your blessings effectively relative to your NFT count
    // Someone with 10 NFTs using 10 blessings scores higher than
    // someone with 100 NFTs using 20 blessings
    if (stats.blessingEfficiency > 0) {
      const efficiencyScore = stats.blessingEfficiency * WEIGHTS.BLESSING_EFFICIENCY;
      score += efficiencyScore;
    }

    // 3. Winning Blessings with Early Bird Bonus
    // Rewards blessing winning seeds, with extra points for early blessings
    const winningBlessings = stats.blessings.filter(b => b.wasWinner);
    if (winningBlessings.length > 0) {
      const totalWinningScore = winningBlessings.reduce((sum, blessing) => {
        // Base points for blessing a winning seed
        const basePoints = WEIGHTS.WINNING_BLESSING_BASE;

        // Apply early bird multiplier (1x to 3x based on earlyBirdScore)
        const earlyBirdMultiplier = 1 + (blessing.earlyBirdScore * WEIGHTS.EARLY_BIRD_MULTIPLIER);

        return sum + (basePoints * earlyBirdMultiplier);
      }, 0);

      score += totalWinningScore;
    }

    // 4. Curation Accuracy Score
    // Rewards high winning percentage (quality over quantity)
    // 10 blessings with 8 wins (80%) > 100 blessings with 20 wins (20%)
    if (stats.curationAccuracy > 0) {
      const accuracyScore = stats.curationAccuracy * WEIGHTS.CURATION_ACCURACY;
      score += accuracyScore;
    }

    // 5. Recent Activity Multiplier
    // Bonus for being active in the last 30 days
    // Multiplies the entire score to reward current engagement
    if (stats.recentActivity) {
      score *= WEIGHTS.RECENCY_MULTIPLIER;
    }

    return Math.round(score);
  }

  /**
   * Generate complete leaderboard
   * @param limit - Maximum number of entries to return
   * @param timeframe - Time period for the leaderboard
   */
  async getLeaderboard(
    limit = 100,
    timeframe: LeaderboardTimeframe = "lifetime"
  ): Promise<LeaderboardEntry[]> {
    // Get all participants
    const participants = await this.getAllParticipants();

    // Calculate stats and scores for each participant
    const entries: LeaderboardEntry[] = [];

    for (const address of participants) {
      try {
        const stats = await this.getUserStats(address as Address, timeframe);
        const score = this.calculateScore(stats);

        // Only include users with some activity
        if (score > 0) {
          // Calculate average early bird score for winning blessings
          const winningBlessings = stats.blessings.filter(b => b.wasWinner);
          const avgEarlyBirdScore = winningBlessings.length > 0
            ? winningBlessings.reduce((sum, b) => sum + b.earlyBirdScore, 0) / winningBlessings.length
            : 0;

          entries.push({
            address: stats.address,
            nftCount: stats.nftCount,
            blessingCount: stats.blessingCount,
            winningBlessings: stats.winningBlessings,
            recentActivity: stats.recentActivity,
            score,
            blessingEfficiency: stats.blessingEfficiency,
            curationAccuracy: stats.curationAccuracy,
            avgEarlyBirdScore: avgEarlyBirdScore > 0 ? avgEarlyBirdScore : undefined,
          });
        }
      } catch (error) {
        console.error(`Error calculating stats for ${address}:`, error);
      }
    }

    // Sort by score (descending) and add ranks
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    // Return top N entries
    return entries.slice(0, limit);
  }

  /**
   * Get stats and rank for a specific user
   * @param address - User's wallet address
   * @param timeframe - Time period for the rank calculation
   */
  async getUserRank(
    address: Address,
    timeframe: LeaderboardTimeframe = "lifetime"
  ): Promise<{
    stats: UserStats;
    score: number;
    rank: number | null;
    total: number;
    timeframe: LeaderboardTimeframe;
  }> {
    const stats = await this.getUserStats(address, timeframe);
    const score = this.calculateScore(stats);

    // Get full leaderboard to determine rank
    const leaderboard = await this.getLeaderboard(1000, timeframe);
    const userEntry = leaderboard.find(
      (entry) => entry.address.toLowerCase() === address.toLowerCase()
    );

    return {
      stats,
      score,
      rank: userEntry?.rank || null,
      total: leaderboard.length,
      timeframe,
    };
  }
}

export const leaderboardService = new LeaderboardService();
