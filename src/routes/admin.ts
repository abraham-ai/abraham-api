import { Hono } from "hono";
import { updateSnapshotAndMerkle } from "../../scripts/updateSnapshot.js";
import { contractService } from "../services/contractService.js";

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
 * Automatically select the daily winner based on blessing scores
 *
 * This endpoint triggers the winner selection process:
 * 1. Calls selectDailyWinner() on The Seeds contract
 * 2. Winner is determined by: sqrt(per-user blessings) * time_decay
 * 3. Starts a new 24-hour blessing period
 *
 * Authentication (either method):
 * - X-Admin-Key header (for manual API calls)
 * - Authorization Bearer token with CRON_SECRET (for Vercel cron jobs)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "winningSeedId": number,
 *     "txHash": string,
 *     "blockExplorer": string,
 *     "seed": {...}
 *   }
 * }
 */

// Handler function for the select-winner endpoint
const selectWinnerHandler = async (c: any) => {
  try {
    console.log(`Winner selection requested at: ${new Date().toISOString()}`);

    // Call contract service to select winner
    const result = await contractService.selectDailyWinner();

    if (!result.success) {
      let statusCode: 400 | 500 | 503 = 500;
      if (result.error?.includes("not ended")) statusCode = 400;
      else if (result.error?.includes("No valid winner")) statusCode = 400;
      else if (result.error?.includes("RPC") || result.error?.includes("network")) {
        statusCode = 503;
      }

      return c.json(
        {
          success: false,
          error: result.error || "Winner selection failed",
        },
        statusCode
      );
    }

    // Get the winning seed details
    let seed = null;
    if (result.winningSeedId !== undefined) {
      try {
        seed = await contractService.getSeed(result.winningSeedId);
      } catch (error) {
        console.warn("Winner selected but couldn't fetch seed details:", error);
      }
    }

    const blockExplorer =
      process.env.NETWORK === "base"
        ? `https://basescan.org/tx/${result.txHash}`
        : `https://sepolia.basescan.org/tx/${result.txHash}`;

    return c.json({
      success: true,
      data: {
        winningSeedId: result.winningSeedId,
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
      },
    });
  } catch (error) {
    console.error("Error selecting winner:", error);

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
        error: "Failed to select winner",
        details: errorMessage,
      },
      statusCode
    );
  }
};

// Register both POST and GET handlers for the select-winner endpoint
admin.post("/select-winner", requireAdminKey, selectWinnerHandler);
admin.get("/select-winner", requireAdminKey, selectWinnerHandler);

export default admin;
