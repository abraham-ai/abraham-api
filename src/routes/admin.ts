import { Hono } from "hono";
import { updateSnapshotAndMerkle } from "../../scripts/updateSnapshot.js";
import { contractService } from "../services/contractService.js";
import { abrahamService } from "../services/abrahamService.js";

const admin = new Hono();

/**
 * Middleware to check admin key or cron secret
 * Supports two authentication methods:
 * 1. X-Admin-Key header (for manual API calls)
 * 2. Authorization Bearer token with CRON_SECRET (for Vercel cron jobs)
 */
function requireAdminKey(c: any, next: any) {
  const adminKey = c.req.header("X-Admin-Key");
  const authHeader = c.req.header("Authorization");

  // Check if CRON_SECRET is configured (for cron job authentication)
  const cronSecret = process.env.CRON_SECRET;

  // Check if request is from Vercel cron (has Authorization header with Bearer token)
  const isCronRequest = authHeader?.startsWith("Bearer ") && cronSecret;

  if (isCronRequest) {
    // Verify CRON_SECRET matches
    const token = authHeader.split(" ")[1];
    if (token === cronSecret) {
      console.log("Authenticated via CRON_SECRET");
      return next();
    }
  }

  // Fall back to X-Admin-Key authentication
  if (!process.env.ADMIN_KEY) {
    return c.json(
      {
        success: false,
        error: "Server configuration error - ADMIN_KEY not set",
      },
      500
    );
  }

  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return c.json(
      {
        success: false,
        error: "Unauthorized - Invalid or missing admin key",
      },
      401
    );
  }

  return next();
}

/**
 * POST/GET /admin/update-snapshot
 * Update FirstWorks snapshot, generate merkle tree, and update contract
 *
 * This endpoint performs all three steps in one action:
 * 1. Generate FirstWorks NFT ownership snapshot (using Alchemy NFT API - fast!)
 * 2. Generate Merkle tree from snapshot
 * 3. Update Merkle root on The Seeds contract (L2)
 *
 * ⚡ Performance: Completes in ~10-30 seconds with Alchemy API
 *
 * Authentication (either method):
 * - X-Admin-Key header (for manual API calls)
 * - Authorization Bearer token with CRON_SECRET (for Vercel cron jobs)
 *
 * Query Parameters:
 * - skipContract: Set to 'true' to skip contract update (optional)
 *
 * Request Headers:
 * - X-Admin-Key: Admin authentication key (for manual calls)
 * - Authorization: Bearer <CRON_SECRET> (for cron jobs)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "snapshotPath": string,
 *     "merklePath": string,
 *     "merkleRoot": string,
 *     "txHash": string (if contract updated),
 *     "blockNumber": number (if contract updated),
 *     "steps": {
 *       "snapshot": boolean,
 *       "merkle": boolean,
 *       "contract": boolean
 *     }
 *   }
 * }
 */

// Handler function for the update-snapshot endpoint
const updateSnapshotHandler = async (c: any) => {
  try {
    console.log(`Snapshot update requested at: ${new Date().toISOString()}`);

    // Check if contract update should be skipped
    const skipContract = c.req.query("skipContract") === "true";

    console.log(`Starting snapshot update (skipContract: ${skipContract})...`);

    // Run the update process
    const result = await updateSnapshotAndMerkle(skipContract);

    if (!result.success) {
      let statusCode: 500 | 503 = 500;
      if (result.error?.includes("RPC") || result.error?.includes("network")) {
        statusCode = 503;
      }

      return c.json(
        {
          success: false,
          error: result.error || "Update failed",
          steps: result.steps,
        },
        statusCode
      );
    }

    // Return success response
    return c.json({
      success: true,
      data: {
        snapshotPath: result.snapshotPath,
        merklePath: result.merklePath,
        merkleRoot: result.merkleRoot,
        txHash: result.txHash,
        blockNumber: result.blockNumber?.toString(),
        steps: result.steps,
        snapshot: result.snapshot, // Include the full snapshot data
        timestamp: new Date().toISOString(),
        // Add helpful message if contract wasn't updated
        message: !result.steps.contract
          ? "Contract already has this merkle root (no NFT ownership changes detected)"
          : "Snapshot updated and contract merkle root updated on-chain",
      },
    });
  } catch (error) {
    console.error("Error updating snapshot:", error);

    let statusCode: 500 | 503 = 500;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes("RPC") ||
      errorMessage.includes("network") ||
      errorMessage.includes("timeout")
    ) {
      statusCode = 503;
    }

    return c.json(
      {
        success: false,
        error: "Failed to update snapshot",
        details: errorMessage,
      },
      statusCode
    );
  }
};

// Register both POST and GET handlers for the update-snapshot endpoint
admin.post("/update-snapshot", requireAdminKey, updateSnapshotHandler);
admin.get("/update-snapshot", requireAdminKey, updateSnapshotHandler);

/**
 * POST /admin/reload-snapshot
 * Force reload the FirstWorks NFT ownership snapshot without updating merkle or contract
 *
 * This endpoint is useful for:
 * - Refreshing the in-memory snapshot cache
 * - Testing snapshot loading
 * - Quick updates without contract interaction
 *
 * Authentication: X-Admin-Key header only (no Privy token required)
 *
 * Request Headers:
 * - X-Admin-Key: Admin authentication key (required)
 */
admin.post("/reload-snapshot", requireAdminKey, async (c) => {
  try {

    // Dynamically import to reload
    const { loadLatestSnapshot } = await import("../../lib/snapshots/firstWorksSnapshot.js");
    const snapshot = await loadLatestSnapshot();

    if (!snapshot) {
      return c.json(
        {
          success: false,
          error: "No snapshot available",
          message: "Run POST /admin/update-snapshot to generate a snapshot",
        },
        404
      );
    }

    return c.json({
      success: true,
      message: "FirstWorks snapshot reloaded successfully",
      data: {
        totalHolders: snapshot.totalHolders,
        totalSupply: snapshot.totalSupply,
        timestamp: snapshot.timestamp,
        blockNumber: snapshot.blockNumber,
      },
    });
  } catch (error) {
    console.error("Error reloading snapshot:", error);
    return c.json(
      {
        success: false,
        error: "Failed to reload snapshot",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /admin/snapshot-status
 * Get the current status of the snapshot and merkle tree
 *
 * Authentication: None required (public info)
 */
admin.get("/snapshot-status", async (c) => {
  try {
    const { loadLatestSnapshot } = await import("../../lib/snapshots/firstWorksSnapshot.js");
    const { readFileSync, existsSync } = await import("fs");

    // Load snapshot
    const snapshot = await loadLatestSnapshot();

    if (!snapshot) {
      return c.json({
        success: true,
        data: {
          snapshotExists: false,
          merkleExists: false,
          message: "No snapshot available. Run POST /admin/update-snapshot to generate.",
        },
      });
    }

    // Check if merkle tree exists
    const merklePath = "./lib/snapshots/firstWorks_merkle.json";
    const merkleExists = existsSync(merklePath);

    let merkleInfo = null;
    if (merkleExists) {
      const merkleData = JSON.parse(readFileSync(merklePath, "utf-8"));
      merkleInfo = {
        root: merkleData.root,
        totalLeaves: Object.keys(merkleData.leaves || {}).length,
        totalProofs: Object.keys(merkleData.proofs || {}).length,
      };
    }

    return c.json({
      success: true,
      data: {
        snapshotExists: true,
        merkleExists,
        snapshot: {
          totalHolders: snapshot.totalHolders,
          totalSupply: snapshot.totalSupply,
          timestamp: snapshot.timestamp,
          blockNumber: snapshot.blockNumber,
          contractAddress: snapshot.contractAddress,
        },
        merkle: merkleInfo,
      },
    });
  } catch (error) {
    console.error("Error checking snapshot status:", error);
    return c.json(
      {
        success: false,
        error: "Failed to check snapshot status",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * POST/GET /admin/select-winner
 * Select the daily winner on TheSeeds contract with optional auto-elevation
 *
 * This endpoint:
 * 1. Calls selectDailyWinner() on The Seeds contract (Base)
 * 2. Winner is determined by: sqrt(per-user blessings) * time_decay
 * 3. Starts a new 24-hour blessing period
 * 4. Optionally elevates winner to Abraham creation (if autoElevate=true)
 *
 * Query Parameters:
 * - autoElevate: Set to 'true' to automatically elevate winner to Abraham creation (optional)
 *
 * Authentication (either method):
 * - X-Admin-Key header (for manual API calls)
 * - Authorization Bearer token with CRON_SECRET (for Vercel cron jobs)
 *
 * Response (without autoElevate):
 * {
 *   "success": true,
 *   "data": {
 *     "winningSeedId": number,
 *     "seed": {...},
 *     "nextStep": "Call POST /admin/elevate-seed?seedId=X to mint Abraham creation"
 *   }
 * }
 *
 * Response (with autoElevate=true):
 * {
 *   "success": true,
 *   "data": {
 *     "winningSeedId": number,
 *     "seed": {...},
 *     "abraham": {
 *       "tokenId": number,
 *       "auctionId": number,
 *       "mintTxHash": string,
 *       "auctionTxHash": string
 *     }
 *   }
 * }
 */

// Handler function for the select-winner endpoint
const selectWinnerHandler = async (c: any) => {
  try {
    const autoElevate = c.req.query("autoElevate") === "true";

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 Winner selection ${autoElevate ? '& auto-elevation ' : ''}started`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   Auto-Elevate: ${autoElevate ? 'YES' : 'NO'}`);
    console.log(`${"=".repeat(60)}\n`);

    // ============================================================
    // STEP 1: Select winner on TheSeeds (Base)
    // ============================================================
    console.log("📍 STEP 1: Selecting winner on TheSeeds (Base)...");
    const result = await contractService.selectDailyWinner();

    if (!result.success) {
      let statusCode: 400 | 500 | 503 = 500;
      if (result.error?.includes("not ended")) statusCode = 400;
      else if (result.error?.includes("No valid winner")) statusCode = 400;
      else if (result.error?.includes("RPC") || result.error?.includes("network")) {
        statusCode = 503;
      }

      console.error(`❌ Winner selection failed: ${result.error}`);

      // Log diagnostics if available
      if (result.diagnostics) {
        console.error(`\n📊 Diagnostics:`);
        console.error(`   Round: ${result.diagnostics.currentRound}`);
        console.error(`   Seeds in Round: ${result.diagnostics.seedsInRound}`);
        console.error(`   Time Remaining: ${result.diagnostics.timeRemaining}s`);
        console.error(`   Leader Seed ID: ${result.diagnostics.currentLeader.seedId}`);
        console.error(`   Leader Score: ${result.diagnostics.currentLeader.score}`);
        console.error(`   Leader Blessings: ${result.diagnostics.currentLeader.blessings}`);
      }

      return c.json(
        {
          success: false,
          error: result.error || "Winner selection failed",
          diagnostics: result.diagnostics,
        },
        statusCode
      );
    }

    console.log(`✅ Winner selected on Base`);
    console.log(`   Seed ID: ${result.winningSeedId}`);
    console.log(`   Tx Hash: ${result.txHash}`);
    console.log("");

    // Get winning seed details
    let seed = null;
    if (result.winningSeedId !== undefined) {
      try {
        seed = await contractService.getSeed(result.winningSeedId);
        console.log(`✅ Seed details retrieved`);
        console.log(`   IPFS Hash: ${seed.ipfsHash}`);
        console.log(`   Creator: ${seed.creator}`);
        console.log(`   Blessings: ${seed.blessings}`);
        console.log("");
      } catch (error) {
        console.warn("⚠️  Couldn't fetch seed details:", error);
      }
    }

    // Get current round (it's now incremented after winner selection)
    const currentRound = await contractService.getCurrentRound();
    const winnerRound = Number(currentRound) - 1; // Winner is from previous round

    const blockExplorer =
      process.env.NETWORK === "base"
        ? `https://basescan.org/tx/${result.txHash}`
        : `https://sepolia.basescan.org/tx/${result.txHash}`;

    // ============================================================
    // STEP 2: Auto-elevate if requested and configured
    // ============================================================
    if (autoElevate && seed) {
      console.log("📍 STEP 2: Auto-elevating to Abraham creation (Sepolia)...");

      // Check if Abraham service is configured
      if (!abrahamService.isConfigured()) {
        console.warn("⚠️  Abraham service not configured - skipping auto-elevation");
        console.log(`${"=".repeat(60)}`);
        console.log(`✅ WINNER SELECTED (elevation skipped)`);
        console.log(`${"=".repeat(60)}\n`);

        return c.json({
          success: true,
          data: {
            winningSeedId: result.winningSeedId,
            round: winnerRound,
            txHash: result.txHash,
            blockExplorer,
            seed: {
              id: Number(seed.id),
              creator: seed.creator,
              ipfsHash: seed.ipfsHash,
              blessings: Number(seed.blessings),
              createdAt: Number(seed.createdAt),
              isWinner: seed.isWinner,
              winnerInRound: Number(seed.winnerInRound),
            },
            abraham: null,
            warning: "Abraham service not configured - auto-elevation skipped",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Validate seed data before elevation
      if (!seed.ipfsHash || seed.ipfsHash.trim() === "") {
        console.error(`❌ Seed ${result.winningSeedId} has no IPFS hash - cannot elevate`);
        return c.json({
          success: false,
          error: `Seed ${result.winningSeedId} has no IPFS hash - cannot elevate to Abraham creation`,
          data: {
            winningSeedId: result.winningSeedId,
            round: winnerRound,
            txHash: result.txHash,
            blockExplorer,
            seed: {
              id: Number(seed.id),
              creator: seed.creator,
              ipfsHash: seed.ipfsHash,
              blessings: Number(seed.blessings),
            },
          },
        }, 400);
      }

      // Elevate the seed to an Abraham creation
      const elevationResult = await abrahamService.elevateSeedToCreation(
        {
          id: result.winningSeedId!,
          ipfsHash: seed.ipfsHash,
          creator: seed.creator,
          blessings: Number(seed.blessings),
        },
        winnerRound
      );

      if (!elevationResult.success) {
        console.error(`❌ Auto-elevation failed: ${elevationResult.error}`);

        // Return partial success - winner was selected but elevation failed
        return c.json({
          success: false,
          error: `Winner selected but elevation failed: ${elevationResult.error}`,
          step: "elevation",
          data: {
            winningSeedId: result.winningSeedId,
            round: winnerRound,
            txHash: result.txHash,
            blockExplorer,
            seed: {
              id: Number(seed.id),
              creator: seed.creator,
              ipfsHash: seed.ipfsHash,
              blessings: Number(seed.blessings),
              createdAt: Number(seed.createdAt),
              isWinner: seed.isWinner,
              winnerInRound: Number(seed.winnerInRound),
            },
            abraham: null,
            timestamp: new Date().toISOString(),
            nextStep: `Retry elevation with: POST /admin/elevate-seed?seedId=${result.winningSeedId}`,
          },
        }, 500);
      }

      // Success - both winner selection and elevation completed
      console.log(`${"=".repeat(60)}`);
      console.log(`✅ COMPLETE SUCCESS (winner selected & elevated)`);
      console.log(`${"=".repeat(60)}\n`);

      return c.json({
        success: true,
        data: {
          winningSeedId: result.winningSeedId,
          round: winnerRound,
          txHash: result.txHash,
          blockExplorer,
          seed: {
            id: Number(seed.id),
            creator: seed.creator,
            ipfsHash: seed.ipfsHash,
            blessings: Number(seed.blessings),
            createdAt: Number(seed.createdAt),
            isWinner: seed.isWinner,
            winnerInRound: Number(seed.winnerInRound),
          },
          abraham: {
            tokenId: elevationResult.tokenId,
            auctionId: elevationResult.auctionId,
            mintTxHash: elevationResult.mintTxHash,
            auctionTxHash: elevationResult.auctionTxHash,
            mintExplorer: `https://sepolia.etherscan.io/tx/${elevationResult.mintTxHash}`,
            auctionExplorer: `https://sepolia.etherscan.io/tx/${elevationResult.auctionTxHash}`,
          },
          timestamp: new Date().toISOString(),
          message: "Winner selected and auto-elevated to Abraham creation. Daily auction started.",
        },
      });
    }

    // No auto-elevation requested - return winner only
    console.log(`${"=".repeat(60)}`);
    console.log(`✅ WINNER SELECTED`);
    console.log(`${"=".repeat(60)}\n`);

    return c.json({
      success: true,
      data: {
        winningSeedId: result.winningSeedId,
        round: winnerRound,
        txHash: result.txHash,
        blockExplorer,
        seed: seed
          ? {
              id: Number(seed.id),
              creator: seed.creator,
              ipfsHash: seed.ipfsHash,
              blessings: Number(seed.blessings),
              createdAt: Number(seed.createdAt),
              isWinner: seed.isWinner,
              winnerInRound: Number(seed.winnerInRound),
            }
          : null,
        timestamp: new Date().toISOString(),
        message: "Winner selected successfully. New blessing period started.",
        nextStep: `To elevate to Abraham creation, call: POST /admin/elevate-seed?seedId=${result.winningSeedId}`,
      },
    });
  } catch (error) {
    console.error("❌ Error in winner selection flow:", error);

    let statusCode: 500 | 503 = 500;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes("RPC") ||
      errorMessage.includes("network") ||
      errorMessage.includes("timeout")
    ) {
      statusCode = 503;
    }

    return c.json(
      {
        success: false,
        error: "Failed to complete winner selection flow",
        details: errorMessage,
      },
      statusCode
    );
  }
};

/**
 * GET /admin/winner-diagnostics
 * Check winner selection readiness without executing the transaction
 *
 * Returns diagnostic information about:
 * - Current round and seeds
 * - Voting period status
 * - Current leader and blessing scores
 * - Eligibility for winner selection
 */
admin.get("/winner-diagnostics", requireAdminKey, async (c) => {
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔍 Winner Selection Diagnostics`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`${"=".repeat(60)}\n`);

    // Get current round
    const currentRound = await contractService.getCurrentRound();
    console.log(`Current Round: ${currentRound}`);

    // Get seeds in current round
    const roundSeeds = await contractService.getCurrentRoundSeeds();
    console.log(`Seeds in Round: ${roundSeeds.length}`);

    // Get time remaining
    const timeRemaining = await contractService.getTimeUntilPeriodEnd();
    console.log(`Time Until Period End: ${timeRemaining}s`);

    // Get current leader
    const leader = await contractService.getCurrentLeader();
    console.log(`Leading Seed ID: ${leader.leadingSeedId}`);
    console.log(`Leading Blessing Score: ${leader.score}`);

    // Get leader details
    let leaderSeed = null;
    if (leader.leadingSeedId > 0n) {
      leaderSeed = await contractService.getSeed(Number(leader.leadingSeedId));
      console.log(`Leader Raw Blessings: ${leaderSeed.blessings}`);
      console.log(`Leader Is Winner: ${leaderSeed.isWinner}`);
    }

    // Check eligible seeds
    const eligibleSeeds = roundSeeds.filter(seed => !seed.isWinner);
    console.log(`Eligible Seeds (not winners): ${eligibleSeeds.length}`);

    // Get blessing scores for all seeds in round
    const seedScores = await Promise.all(
      roundSeeds.map(async (seed) => ({
        id: Number(seed.id),
        blessings: Number(seed.blessings),
        isWinner: seed.isWinner,
        score: Number(await contractService.getSeedBlessingScore(Number(seed.id))),
      }))
    );

    // Get detailed blessing info for leading seed to diagnose scoring issue
    let blessingDetails = null;
    if (leader.leadingSeedId > 0n) {
      const blessings = await contractService.getSeedBlessings(Number(leader.leadingSeedId));

      // Group blessings by user to see blessing count per user
      const blesserCounts = new Map<string, number>();
      for (const blessing of blessings) {
        const blesser = blessing.blesser.toLowerCase();
        blesserCounts.set(blesser, (blesserCounts.get(blesser) || 0) + 1);
      }

      blessingDetails = {
        totalBlessings: blessings.length,
        uniqueBlessers: blesserCounts.size,
        blessingsPerUser: Array.from(blesserCounts.entries()).map(([user, count]) => ({
          user,
          count,
          sqrtCount: Math.floor(Math.sqrt(count)),
        })),
      };

      console.log(`\nBlessing Distribution for Seed ${leader.leadingSeedId}:`);
      console.log(`  Total Blessings: ${blessingDetails.totalBlessings}`);
      console.log(`  Unique Users: ${blessingDetails.uniqueBlessers}`);
      console.log(`  Blessings per user:`, blessingDetails.blessingsPerUser);
    }

    // Determine readiness
    const isReady =
      roundSeeds.length > 0 &&
      timeRemaining === 0n &&
      eligibleSeeds.length > 0 &&
      leader.score > 0n;

    const issues = [];
    if (roundSeeds.length === 0) {
      issues.push("No seeds in current round");
    }
    if (timeRemaining > 0n) {
      issues.push(`Voting period not ended (${timeRemaining}s remaining)`);
    }
    if (eligibleSeeds.length === 0) {
      issues.push("All seeds have already won");
    }
    if (leader.score === 0n) {
      issues.push("Leading seed has blessing score of 0");
    }

    console.log(`\nReady for winner selection: ${isReady ? '✅ YES' : '❌ NO'}`);
    if (!isReady) {
      console.log(`Issues: ${issues.join(', ')}`);
    }

    return c.json({
      success: true,
      ready: isReady,
      issues: issues.length > 0 ? issues : undefined,
      diagnostics: {
        currentRound: Number(currentRound),
        seedsInRound: roundSeeds.length,
        timeRemaining: Number(timeRemaining),
        votingPeriodEnded: timeRemaining === 0n,
        currentLeader: {
          seedId: Number(leader.leadingSeedId),
          score: leader.score.toString(),
          blessings: leaderSeed ? leaderSeed.blessings.toString() : "0",
          isWinner: leaderSeed?.isWinner || false,
          blessingDistribution: blessingDetails,
        },
        eligibleSeeds: eligibleSeeds.length,
        allSeedScores: seedScores,
      },
    });
  } catch (error: any) {
    console.error("Error running diagnostics:", error);
    return c.json(
      {
        success: false,
        error: error.message || "Failed to run diagnostics",
      },
      500
    );
  }
});

// Register both POST and GET handlers for the select-winner endpoint
admin.post("/select-winner", requireAdminKey, selectWinnerHandler);
admin.get("/select-winner", requireAdminKey, selectWinnerHandler);

/**
 * POST /admin/elevate-seed
 * Elevate a winning seed to an Abraham creation
 *
 * This endpoint takes a seed ID and:
 * 1. Fetches the seed details from TheSeeds contract
 * 2. Mints it as an Abraham creation NFT on Sepolia
 * 3. Creates a daily auction for it
 *
 * Query Parameters:
 * - seedId: The ID of the seed to elevate (required)
 *
 * Authentication (either method):
 * - X-Admin-Key header (for manual API calls)
 * - Authorization Bearer token with CRON_SECRET (for Vercel cron jobs)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "seedId": number,
 *     "seed": {...},
 *     "abraham": {
 *       "tokenId": number,
 *       "auctionId": number,
 *       "mintTxHash": string,
 *       "auctionTxHash": string
 *     }
 *   }
 * }
 */
admin.post("/elevate-seed", requireAdminKey, async (c) => {
  try {
    const seedIdParam = c.req.query("seedId");

    if (!seedIdParam) {
      return c.json(
        {
          success: false,
          error: "Missing seedId query parameter",
        },
        400
      );
    }

    const seedId = parseInt(seedIdParam);
    if (isNaN(seedId)) {
      return c.json(
        {
          success: false,
          error: "Invalid seedId - must be a number",
        },
        400
      );
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🌟 Elevating seed ${seedId} to Abraham creation`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`${"=".repeat(60)}\n`);

    // Check if Abraham service is configured
    if (!abrahamService.isConfigured()) {
      return c.json(
        {
          success: false,
          error: "Abraham service not configured - deploy contracts and set environment variables first",
        },
        503
      );
    }

    // Fetch seed details
    console.log("📍 Fetching seed details from TheSeeds...");
    let seed;
    try {
      seed = await contractService.getSeed(seedId);
    } catch (error) {
      console.error("❌ Failed to fetch seed:", error);
      return c.json(
        {
          success: false,
          error: `Seed ${seedId} not found`,
        },
        404
      );
    }

    // Verify seed is a winner
    if (!seed.isWinner) {
      return c.json(
        {
          success: false,
          error: `Seed ${seedId} is not a winner - only winning seeds can be elevated`,
        },
        400
      );
    }

    // Verify seed has IPFS hash
    if (!seed.ipfsHash || seed.ipfsHash.trim() === "") {
      return c.json(
        {
          success: false,
          error: `Seed ${seedId} has no IPFS hash - cannot elevate to Abraham creation`,
        },
        400
      );
    }

    console.log(`✅ Seed details retrieved`);
    console.log(`   IPFS Hash: ${seed.ipfsHash}`);
    console.log(`   Creator: ${seed.creator}`);
    console.log(`   Blessings: ${seed.blessings}`);
    console.log(`   Winner in Round: ${seed.winnerInRound}`);
    console.log("");

    // Elevate the seed
    const elevationResult = await abrahamService.elevateSeedToCreation(
      {
        id: seedId,
        ipfsHash: seed.ipfsHash,
        creator: seed.creator,
        blessings: Number(seed.blessings),
      },
      Number(seed.winnerInRound)
    );

    if (!elevationResult.success) {
      console.error(`❌ Elevation failed: ${elevationResult.error}`);
      return c.json(
        {
          success: false,
          error: elevationResult.error,
        },
        500
      );
    }

    console.log(`${"=".repeat(60)}`);
    console.log(`✅ ELEVATION COMPLETE`);
    console.log(`${"=".repeat(60)}\n`);

    return c.json({
      success: true,
      data: {
        seedId,
        seed: {
          id: Number(seed.id),
          creator: seed.creator,
          ipfsHash: seed.ipfsHash,
          blessings: Number(seed.blessings),
          createdAt: Number(seed.createdAt),
          isWinner: seed.isWinner,
          winnerInRound: Number(seed.winnerInRound),
        },
        abraham: {
          tokenId: elevationResult.tokenId,
          auctionId: elevationResult.auctionId,
          mintTxHash: elevationResult.mintTxHash,
          auctionTxHash: elevationResult.auctionTxHash,
          mintExplorer: `https://sepolia.etherscan.io/tx/${elevationResult.mintTxHash}`,
          auctionExplorer: `https://sepolia.etherscan.io/tx/${elevationResult.auctionTxHash}`,
        },
        timestamp: new Date().toISOString(),
        message: "Seed elevated to Abraham creation successfully. Daily auction started.",
      },
    });
  } catch (error) {
    console.error("❌ Error elevating seed:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json(
      {
        success: false,
        error: "Failed to elevate seed",
        details: errorMessage,
      },
      500
    );
  }
});

/**
 * POST /admin/create-auction
 * Create an auction for an already-minted Abraham creation
 *
 * This endpoint is useful when:
 * - A token was minted but auction creation failed
 * - You want to re-auction a token after a previous auction ended
 *
 * Query Parameters:
 * - tokenId: The ID of the token to auction (required)
 * - durationInDays: Auction duration in days (optional, default: 1)
 * - minBidInEth: Minimum bid in ETH (optional, default: 0.01)
 *
 * Authentication: X-Admin-Key header required
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "tokenId": number,
 *     "auctionId": number,
 *     "txHash": string,
 *     "explorer": string
 *   }
 * }
 */
admin.post("/create-auction", requireAdminKey, async (c) => {
  try {
    const tokenIdParam = c.req.query("tokenId");
    const durationParam = c.req.query("durationInDays") || "1";
    const minBidParam = c.req.query("minBidInEth") || "0.01";

    if (!tokenIdParam) {
      return c.json(
        {
          success: false,
          error: "Missing tokenId query parameter",
        },
        400
      );
    }

    const tokenId = parseInt(tokenIdParam);
    const durationInDays = parseFloat(durationParam);
    const minBidInEth = minBidParam;

    if (isNaN(tokenId)) {
      return c.json(
        {
          success: false,
          error: "Invalid tokenId - must be a number",
        },
        400
      );
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 Creating auction for Token ID ${tokenId}`);
    console.log(`   Duration: ${durationInDays} day(s)`);
    console.log(`   Min Bid: ${minBidInEth} ETH`);
    console.log(`${"=".repeat(60)}\n`);

    // Check if Abraham service is configured
    if (!abrahamService.isConfigured()) {
      return c.json(
        {
          success: false,
          error: "Abraham service not configured",
        },
        503
      );
    }

    // Create the auction
    const result = await abrahamService.createDailyAuction(
      tokenId,
      durationInDays,
      minBidInEth
    );

    if (!result.success) {
      console.error(`❌ Auction creation failed: ${result.error}`);
      return c.json(
        {
          success: false,
          error: result.error,
        },
        500
      );
    }

    console.log(`✅ Auction created successfully`);
    console.log(`   Auction ID: ${result.auctionId}`);
    console.log(`   Tx Hash: ${result.txHash}\n`);

    return c.json({
      success: true,
      data: {
        tokenId,
        auctionId: result.auctionId,
        txHash: result.txHash,
        explorer: `https://sepolia.etherscan.io/tx/${result.txHash}`,
        auctionExplorer: `https://sepolia.etherscan.io/address/${process.env.ABRAHAM_AUCTION_ADDRESS}#readContract`,
        message: "Auction created successfully",
      },
    });
  } catch (error) {
    console.error("❌ Error creating auction:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json(
      {
        success: false,
        error: "Failed to create auction",
        details: errorMessage,
      },
      500
    );
  }
});

export default admin;
