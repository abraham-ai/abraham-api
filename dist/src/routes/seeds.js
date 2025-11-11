import { Hono } from "hono";
import { withAuth, getAuthUser } from "../middleware/auth.js";
import { contractService } from "../services/contractService.js";
const seeds = new Hono();
/**
 * POST /seeds
 * Create a new seed onchain (backend-signed, gasless for user)
 *
 * This endpoint requires admin authorization (ADMIN_KEY in Authorization header).
 * The backend submits the transaction on behalf of the creator.
 *
 * Requirements:
 * - User must be authenticated
 * - Request must include valid ADMIN_KEY
 * - Backend relayer must have CREATOR_ROLE on the contract
 *
 * Request body:
 * {
 *   "ipfsHash": string,     // IPFS hash of the artwork
 *   "title": string,        // Title of the seed
 *   "description": string   // Description of the seed
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "seedId": number,
 *     "txHash": "0x...",
 *     "blockExplorer": string,
 *     "seed": {...}
 *   }
 * }
 */
seeds.post("/", withAuth, async (c) => {
    try {
        // Check for admin authorization
        const adminKey = c.req.header("X-Admin-Key") || c.req.header("x-admin-key");
        const expectedAdminKey = process.env.ADMIN_KEY;
        if (!expectedAdminKey) {
            return c.json({
                success: false,
                error: "Admin key not configured on server",
            }, 500);
        }
        if (!adminKey || adminKey !== expectedAdminKey) {
            return c.json({
                success: false,
                error: "Unauthorized - Invalid admin key",
            }, 401);
        }
        // Parse and validate request body
        const body = await c.req.json();
        const { ipfsHash, title, description } = body;
        if (!ipfsHash || !title) {
            return c.json({
                success: false,
                error: "ipfsHash and title are required",
            }, 400);
        }
        // Validate input
        if (typeof ipfsHash !== "string" || typeof title !== "string") {
            return c.json({
                success: false,
                error: "ipfsHash and title must be strings",
            }, 400);
        }
        if (description && typeof description !== "string") {
            return c.json({
                success: false,
                error: "description must be a string",
            }, 400);
        }
        // Submit seed to blockchain
        const result = await contractService.submitSeed(ipfsHash, title, description || "");
        if (!result.success) {
            let statusCode = 500;
            if (result.error?.includes("not have CREATOR_ROLE"))
                statusCode = 403;
            else if (result.error?.includes("not initialized"))
                statusCode = 503;
            return c.json({
                success: false,
                error: result.error,
            }, statusCode);
        }
        // Get the created seed details
        let seed = null;
        if (result.seedId !== undefined) {
            try {
                seed = await contractService.getSeed(result.seedId);
            }
            catch (error) {
                // Seed was created but we couldn't fetch details
                console.warn("Seed created but couldn't fetch details:", error);
            }
        }
        const blockExplorer = process.env.NETWORK === "base"
            ? `https://basescan.org/tx/${result.txHash}`
            : `https://sepolia.basescan.org/tx/${result.txHash}`;
        return c.json({
            success: true,
            data: {
                seedId: result.seedId,
                txHash: result.txHash,
                blockExplorer,
                seed: seed
                    ? {
                        id: Number(seed.id),
                        creator: seed.creator,
                        ipfsHash: seed.ipfsHash,
                        title: seed.title,
                        description: seed.description,
                        votes: Number(seed.votes),
                        blessings: Number(seed.blessings),
                        createdAt: Number(seed.createdAt),
                        minted: seed.minted,
                    }
                    : null,
            },
        });
    }
    catch (error) {
        console.error("Error creating seed:", error);
        return c.json({
            success: false,
            error: "Failed to create seed",
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});
/**
 * POST /seeds/prepare
 * Prepare a seed creation transaction for CLIENT-SIDE signing
 *
 * This returns transaction data that the user can sign with their wallet.
 * Use this when creators want to sign the transaction themselves.
 *
 * Requirements:
 * - User must be authenticated
 * - User's wallet must have CREATOR_ROLE on the contract
 *
 * Request body:
 * {
 *   "ipfsHash": string,     // IPFS hash of the artwork
 *   "title": string,        // Title of the seed
 *   "description": string   // Description of the seed
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transaction": {
 *       "to": "0x...",      // Contract address
 *       "data": "0x...",    // Encoded function call
 *       "from": "0x...",    // User's address
 *       "chainId": number
 *     },
 *     "hasCreatorRole": boolean,
 *     "instructions": {...}
 *   }
 * }
 */
seeds.post("/prepare", withAuth, async (c) => {
    try {
        const user = getAuthUser(c);
        if (!user || !user.walletAddress) {
            return c.json({
                success: false,
                error: "Wallet address not found",
            }, 400);
        }
        // Parse and validate request body
        const body = await c.req.json();
        const { ipfsHash, title, description } = body;
        if (!ipfsHash || !title) {
            return c.json({
                success: false,
                error: "ipfsHash and title are required",
            }, 400);
        }
        // Validate input types
        if (typeof ipfsHash !== "string" || typeof title !== "string") {
            return c.json({
                success: false,
                error: "ipfsHash and title must be strings",
            }, 400);
        }
        if (description && typeof description !== "string") {
            return c.json({
                success: false,
                error: "description must be a string",
            }, 400);
        }
        // Check if user has CREATOR_ROLE
        const hasCreatorRole = await contractService.hasCreatorRole(user.walletAddress);
        // Prepare transaction data
        const transaction = contractService.prepareSeedSubmissionTransaction(ipfsHash, title, description || "", user.walletAddress);
        return c.json({
            success: true,
            data: {
                transaction,
                hasCreatorRole,
                userAddress: user.walletAddress,
                instructions: {
                    step1: "Send this transaction using your wallet",
                    step2: "Wait for transaction confirmation",
                    step3: "Your seed will be created on-chain",
                    note: hasCreatorRole
                        ? "You have CREATOR_ROLE and can create seeds"
                        : "Warning: You don't have CREATOR_ROLE - transaction will fail",
                },
            },
        });
    }
    catch (error) {
        console.error("Error preparing seed creation:", error);
        return c.json({
            success: false,
            error: "Failed to prepare seed creation transaction",
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});
/**
 * GET /seeds/:seedId
 * Get details of a specific seed
 */
seeds.get("/:seedId", async (c) => {
    try {
        const seedId = parseInt(c.req.param("seedId"));
        if (isNaN(seedId) || seedId < 0) {
            return c.json({
                success: false,
                error: "Invalid seedId",
            }, 400);
        }
        const seed = await contractService.getSeed(seedId);
        return c.json({
            success: true,
            data: {
                id: Number(seed.id),
                creator: seed.creator,
                ipfsHash: seed.ipfsHash,
                title: seed.title,
                description: seed.description,
                votes: Number(seed.votes),
                blessings: Number(seed.blessings),
                createdAt: Number(seed.createdAt),
                minted: seed.minted,
                mintedInRound: Number(seed.mintedInRound),
            },
        });
    }
    catch (error) {
        console.error("Error fetching seed:", error);
        return c.json({
            success: false,
            error: "Failed to fetch seed",
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});
/**
 * GET /seeds/count
 * Get total number of seeds
 */
seeds.get("/count", async (c) => {
    try {
        const count = await contractService.getSeedCount();
        return c.json({
            success: true,
            data: {
                count: Number(count),
            },
        });
    }
    catch (error) {
        console.error("Error fetching seed count:", error);
        return c.json({
            success: false,
            error: "Failed to fetch seed count",
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});
/**
 * GET /seeds/creator/:address/check
 * Check if an address has CREATOR_ROLE
 */
seeds.get("/creator/:address/check", async (c) => {
    try {
        const address = c.req.param("address");
        if (!address || !address.startsWith("0x")) {
            return c.json({
                success: false,
                error: "Invalid address",
            }, 400);
        }
        const hasRole = await contractService.hasCreatorRole(address);
        return c.json({
            success: true,
            data: {
                address,
                hasCreatorRole: hasRole,
            },
        });
    }
    catch (error) {
        console.error("Error checking creator role:", error);
        return c.json({
            success: false,
            error: "Failed to check creator role",
            details: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});
export default seeds;
