import { Hono } from "hono";
import { withAuth, getAuthUser } from "../middleware/auth.js";
import { updateSnapshotAndMerkle } from "../../scripts/updateSnapshot.js";
const admin = new Hono();
/**
 * POST /admin/update-snapshot
 * Update FirstWorks snapshot, generate merkle tree, and update contract
 *
 * This endpoint performs all three steps in one action:
 * 1. Generate FirstWorks NFT ownership snapshot
 * 2. Generate Merkle tree from snapshot
 * 3. Update Merkle root on The Seeds contract (L2)
 *
 * Authentication: Requires admin key
 *
 * Query Parameters:
 * - skipContract: Set to 'true' to skip contract update (optional)
 *
 * Request Headers:
 * - X-Admin-Key: Admin authentication key (required)
 * - Authorization: Bearer token (required)
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
admin.post("/update-snapshot", withAuth, async (c) => {
    try {
        // Check admin key
        const adminKey = c.req.header("X-Admin-Key");
        if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
            return c.json({
                success: false,
                error: "Unauthorized - Invalid admin key",
            }, 401);
        }
        // Get authenticated user (for logging purposes)
        const user = getAuthUser(c);
        console.log(`Snapshot update requested by: ${user?.walletAddress || "unknown"}`);
        // Check if contract update should be skipped
        const skipContract = c.req.query("skipContract") === "true";
        console.log(`Starting snapshot update (skipContract: ${skipContract})...`);
        // Run the update process
        const result = await updateSnapshotAndMerkle(skipContract);
        if (!result.success) {
            let statusCode = 500;
            if (result.error?.includes("RPC") || result.error?.includes("network")) {
                statusCode = 503;
            }
            return c.json({
                success: false,
                error: result.error || "Update failed",
                steps: result.steps,
            }, statusCode);
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
                timestamp: new Date().toISOString(),
            },
        });
    }
    catch (error) {
        console.error("Error updating snapshot:", error);
        let statusCode = 500;
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("RPC") ||
            errorMessage.includes("network") ||
            errorMessage.includes("timeout")) {
            statusCode = 503;
        }
        return c.json({
            success: false,
            error: "Failed to update snapshot",
            details: errorMessage,
        }, statusCode);
    }
});
/**
 * POST /admin/reload-snapshot
 * Force reload the FirstWorks NFT ownership snapshot without updating merkle or contract
 *
 * This endpoint is useful for:
 * - Refreshing the in-memory snapshot cache
 * - Testing snapshot loading
 * - Quick updates without contract interaction
 *
 * Authentication: Requires admin key
 *
 * Request Headers:
 * - X-Admin-Key: Admin authentication key (required)
 * - Authorization: Bearer token (required)
 */
admin.post("/reload-snapshot", withAuth, async (c) => {
    try {
        // Check admin key
        const adminKey = c.req.header("X-Admin-Key");
        if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
            return c.json({
                success: false,
                error: "Unauthorized - Invalid admin key",
            }, 401);
        }
        // Dynamically import to reload
        const { loadLatestSnapshot } = await import("../../lib/snapshots/firstWorksSnapshot.js");
        const snapshot = await loadLatestSnapshot();
        if (!snapshot) {
            return c.json({
                success: false,
                error: "No snapshot available",
                message: "Run POST /admin/update-snapshot to generate a snapshot",
            }, 404);
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
    }
    catch (error) {
        console.error("Error reloading snapshot:", error);
        return c.json({
            success: false,
            error: "Failed to reload snapshot",
            details: error instanceof Error ? error.message : String(error),
        }, 500);
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
    }
    catch (error) {
        console.error("Error checking snapshot status:", error);
        return c.json({
            success: false,
            error: "Failed to check snapshot status",
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});
export default admin;
