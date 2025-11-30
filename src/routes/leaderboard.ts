import { Hono } from "hono";
import {
  leaderboardService,
  LeaderboardTimeframe,
} from "../services/leaderboardService.js";
import { isAddress } from "viem";

const leaderboard = new Hono();

/**
 * GET /api/leaderboard
 * Get the global leaderboard of user engagement
 * Query params:
 *   - limit: number of entries to return (default: 100, max: 500)
 *   - timeframe: daily | weekly | monthly | yearly | lifetime (default: lifetime)
 */
leaderboard.get("/", async (c) => {
  try {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam), 500) : 100;

    const timeframeParam = c.req.query("timeframe") as
      | LeaderboardTimeframe
      | undefined;
    const validTimeframes: LeaderboardTimeframe[] = [
      "daily",
      "weekly",
      "monthly",
      "yearly",
      "lifetime",
    ];
    const timeframe: LeaderboardTimeframe =
      timeframeParam && validTimeframes.includes(timeframeParam)
        ? timeframeParam
        : "lifetime";

    const results = await leaderboardService.getLeaderboard(limit, timeframe);

    return c.json({
      success: true,
      timeframe,
      count: results.length,
      leaderboard: results,
      scoring: {
        description:
          "Hybrid lifetime leaderboard that prevents whale dominance. 0 blessings = 0 points (NFTs don't give points directly).",
        strategy: "Combines square root scaling for volume with daily efficiency tracking over a 7-day rolling window",
        formula: {
          sqrtBlessingVolume: {
            weight: 50,
            type: "sqrt(total blessings)",
            explanation: "sqrt(blessings) × 50 - Logarithmic scaling prevents whale dominance",
            example: "100 blessings = sqrt(100) × 50 = 500 pts, 10 blessings = sqrt(10) × 50 = 158 pts (3x not 10x)",
          },
          blessingEfficiency: {
            weight: 100,
            type: "ratio (0-1)",
            explanation: "(Blessings in 7-day window / Max possible) × 100 - Rewards daily consistency",
            details: "Max = NFTs × Days Active × 1/day. Rolling 7-day window for fairness",
          },
          winningBlessings: {
            baseWeight: 50,
            earlyBirdMultiplier: "1x to 3x",
            explanation: "Base 50 pts × early bird multiplier - Earlier blessings on winners score more",
          },
          curationAccuracy: {
            weight: 150,
            type: "ratio (0-1)",
            explanation: "(Winning blessings / Total blessings) × 150 - Quality over quantity",
          },
          recencyBonus: {
            multiplier: 1.3,
            explanation: "1.3× total score if active in last 30 days",
          },
        },
        legend: {
          nftCount: "NFTs owned (enables blessings, doesn't give points)",
          blessingEfficiency: "How well you use your blessing power (0-1)",
          curationAccuracy: "Your winning percentage (0-1)",
          avgEarlyBirdScore: "How early you blessed winning seeds (0-1, higher = earlier)",
        },
      },
    });
  } catch (error) {
    console.error("Error generating leaderboard:", error);
    return c.json(
      {
        success: false,
        error: "Failed to generate leaderboard",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * GET /api/leaderboard/user/:address
 * Get rank and stats for a specific user
 * Query params:
 *   - timeframe: daily | weekly | monthly | yearly | lifetime (default: lifetime)
 */
leaderboard.get("/user/:address", async (c) => {
  try {
    const address = c.req.param("address");

    // Validate address
    if (!isAddress(address)) {
      return c.json(
        {
          success: false,
          error: "Invalid Ethereum address",
        },
        400
      );
    }

    const timeframeParam = c.req.query("timeframe") as
      | LeaderboardTimeframe
      | undefined;
    const validTimeframes: LeaderboardTimeframe[] = [
      "daily",
      "weekly",
      "monthly",
      "yearly",
      "lifetime",
    ];
    const timeframe: LeaderboardTimeframe =
      timeframeParam && validTimeframes.includes(timeframeParam)
        ? timeframeParam
        : "lifetime";

    const result = await leaderboardService.getUserRank(address, timeframe);

    return c.json({
      success: true,
      timeframe: result.timeframe,
      address: result.stats.address,
      rank: result.rank,
      totalParticipants: result.total,
      score: result.score,
      stats: {
        nftCount: result.stats.nftCount,
        blessingCount: result.stats.blessingCount,
        winningBlessings: result.stats.winningBlessings,
        recentActivity: result.stats.recentActivity,
      },
      blessings: result.stats.blessings,
    });
  } catch (error) {
    console.error("Error fetching user rank:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch user rank",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default leaderboard;
