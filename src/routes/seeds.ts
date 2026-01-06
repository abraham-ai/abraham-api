import { Hono } from "hono";
import { withAuth, getAuthUser } from "../middleware/auth.js";
import { contractService } from "../services/contractService.js";
import { commandmentService } from "../services/commandmentService.js";
import type { Address } from "viem";

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
      return c.json(
        {
          success: false,
          error: "Admin key not configured on server",
        },
        500
      );
    }

    if (!adminKey || adminKey !== expectedAdminKey) {
      return c.json(
        {
          success: false,
          error: "Unauthorized - Invalid admin key",
        },
        401
      );
    }

    // Parse and validate request body
    const body = await c.req.json();
    const { ipfsHash } = body;

    if (!ipfsHash) {
      return c.json(
        {
          success: false,
          error: "ipfsHash is required",
        },
        400
      );
    }

    // Validate input
    if (typeof ipfsHash !== "string") {
      return c.json(
        {
          success: false,
          error: "ipfsHash must be a string",
        },
        400
      );
    }

    // Submit seed to blockchain
    const result = await contractService.submitSeed(ipfsHash);

    if (!result.success) {
      let statusCode: 403 | 500 | 503 = 500;
      if (result.error?.includes("not have CREATOR_ROLE")) statusCode = 403;
      else if (result.error?.includes("not initialized")) statusCode = 503;

      return c.json(
        {
          success: false,
          error: result.error,
        },
        statusCode
      );
    }

    // Get the created seed details
    let seed = null;
    if (result.seedId !== undefined) {
      try {
        seed = await contractService.getSeed(result.seedId);
      } catch (error) {
        // Seed was created but we couldn't fetch details
        console.warn("Seed created but couldn't fetch details:", error);
      }
    }

    const blockExplorer =
      process.env.NETWORK === "base"
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
              blessings: Number(seed.blessings),
              createdAt: Number(seed.createdAt),
              isWinner: seed.isWinner,
              isRetracted: seed.isRetracted,
              winnerInRound: Number(seed.winnerInRound),
              submittedInRound: Number(seed.submittedInRound),
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error creating seed:", error);
    return c.json(
      {
        success: false,
        error: "Failed to create seed",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
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
      return c.json(
        {
          success: false,
          error: "Wallet address not found",
        },
        400
      );
    }

    // Parse and validate request body
    const body = await c.req.json();
    const { ipfsHash } = body;

    if (!ipfsHash) {
      return c.json(
        {
          success: false,
          error: "ipfsHash is required",
        },
        400
      );
    }

    // Validate input types
    if (typeof ipfsHash !== "string") {
      return c.json(
        {
          success: false,
          error: "ipfsHash must be a string",
        },
        400
      );
    }

    // Check if user has CREATOR_ROLE
    const hasCreatorRole = await contractService.hasCreatorRole(
      user.walletAddress as Address
    );

    // Prepare transaction data
    const transaction = contractService.prepareSeedSubmissionTransaction(
      ipfsHash,
      user.walletAddress as Address
    );

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
  } catch (error) {
    console.error("Error preparing seed creation:", error);
    return c.json(
      {
        success: false,
        error: "Failed to prepare seed creation transaction",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds
 * Get all seeds with their IPFS metadata
 * Supports pagination via query parameters
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "seeds": [...],
 *     "pagination": {
 *       "page": number,
 *       "limit": number,
 *       "total": number,
 *       "totalPages": number
 *     }
 *   }
 * }
 */
seeds.get("/", async (c) => {
  try {
    // Parse pagination parameters
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "10"), 100);

    if (isNaN(page) || page < 1) {
      return c.json(
        {
          success: false,
          error: "Invalid page number",
        },
        400
      );
    }

    if (isNaN(limit) || limit < 1) {
      return c.json(
        {
          success: false,
          error: "Invalid limit",
        },
        400
      );
    }

    // Get total seed count
    const totalCount = await contractService.getSeedCount();
    const total = Number(totalCount);

    // Calculate pagination (reversed to show latest first)
    const totalPages = Math.ceil(total / limit);
    const startIndex = total - (page - 1) * limit - 1;
    const endIndex = Math.max(startIndex - limit + 1, 0);

    // Fetch seeds for current page (from latest to earliest)
    const seeds = [];
    for (let i = startIndex; i >= endIndex; i--) {
      try {
        const seed = await contractService.getSeed(i);

        // Fetch IPFS metadata
        let metadata = null;
        let metadataError = null;

        if (seed.ipfsHash) {
          try {
            // Convert IPFS hash to HTTP gateway URL
            const ipfsGateway = process.env.IPFS_GATEWAY || "https://tomato-causal-partridge-743.mypinata.cloud/ipfs/";
            const ipfsUrl = seed.ipfsHash.startsWith("ipfs://")
              ? seed.ipfsHash.replace("ipfs://", ipfsGateway)
              : seed.ipfsHash.startsWith("http")
              ? seed.ipfsHash
              : `${ipfsGateway}${seed.ipfsHash}`;

            const response = await fetch(ipfsUrl);

            if (response.ok) {
              metadata = await response.json();
            } else {
              metadataError = `HTTP ${response.status}`;
            }
          } catch (error) {
            metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
            console.error(`Error fetching IPFS metadata for seed ${i}:`, error);
          }
        }

        seeds.push({
          id: Number(seed.id),
          creator: seed.creator,
          ipfsHash: seed.ipfsHash,
          blessings: Number(seed.blessings),
          createdAt: Number(seed.createdAt),
          isWinner: seed.isWinner,
          isRetracted: seed.isRetracted,
          winnerInRound: Number(seed.winnerInRound),
          submittedInRound: Number(seed.submittedInRound),
          metadata: metadata,
          metadataError: metadataError,
        });
      } catch (error) {
        console.error(`Error fetching seed ${i}:`, error);
        // Continue with other seeds even if one fails
      }
    }

    return c.json({
      success: true,
      data: {
        seeds,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching seeds:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch seeds",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/minted
 * Get all minted seeds (winning seeds that have been minted as ERC721 NFTs)
 * Supports pagination via query parameters
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "seeds": [{
 *       "id": number,
 *       "tokenId": number,
 *       "creator": string,
 *       "ipfsHash": string,
 *       "blessings": number,
 *       "score": string,
 *       "createdAt": number,
 *       "isWinner": true,
 *       "isRetracted": boolean,
 *       "winnerInRound": number,
 *       "submittedInRound": number,
 *       "metadata": object | null,
 *       "metadataError": string | null
 *     }],
 *     "pagination": {
 *       "page": number,
 *       "limit": number,
 *       "total": number,
 *       "totalPages": number,
 *       "hasNextPage": boolean,
 *       "hasPrevPage": boolean
 *     }
 *   }
 * }
 */
seeds.get("/minted", async (c) => {
  try {
    // Parse pagination parameters
    const page = parseInt(c.req.query("page") || "1");
    const limit = Math.min(parseInt(c.req.query("limit") || "10"), 100);

    if (isNaN(page) || page < 1) {
      return c.json(
        {
          success: false,
          error: "Invalid page number",
        },
        400
      );
    }

    if (isNaN(limit) || limit < 1) {
      return c.json(
        {
          success: false,
          error: "Invalid limit",
        },
        400
      );
    }

    // Get total seed count
    const totalCount = await contractService.getSeedCount();
    const total = Number(totalCount);

    // Fetch all seeds and filter for winners
    const winnerSeeds = [];
    for (let i = 0; i < total; i++) {
      try {
        const seed = await contractService.getSeed(i);

        // Only include seeds that have won (been minted as NFTs)
        if (seed.isWinner) {
          // Get token ID for this winning seed
          const tokenId = await contractService.getTokenIdBySeedId(i);

          winnerSeeds.push({
            seed,
            tokenId: Number(tokenId),
          });
        }
      } catch (error) {
        console.error(`Error fetching seed ${i}:`, error);
        // Continue with other seeds even if one fails
      }
    }

    // Calculate pagination for filtered results
    const totalWinners = winnerSeeds.length;
    const totalPages = Math.ceil(totalWinners / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = Math.min(startIndex + limit, totalWinners);

    // Get seeds for current page
    const paginatedWinners = winnerSeeds.slice(startIndex, endIndex);

    // Fetch IPFS metadata for paginated seeds
    const seedsWithMetadata = await Promise.all(
      paginatedWinners.map(async ({ seed, tokenId }) => {
        const seedId = Number(seed.id);

        // Fetch IPFS metadata
        let metadata = null;
        let metadataError = null;

        if (seed.ipfsHash) {
          try {
            // Convert IPFS hash to HTTP gateway URL
            const ipfsGateway = process.env.IPFS_GATEWAY || "https://tomato-causal-partridge-743.mypinata.cloud/ipfs/";
            const ipfsUrl = seed.ipfsHash.startsWith("ipfs://")
              ? seed.ipfsHash.replace("ipfs://", ipfsGateway)
              : seed.ipfsHash.startsWith("http")
              ? seed.ipfsHash
              : `${ipfsGateway}${seed.ipfsHash}`;

            const response = await fetch(ipfsUrl);

            if (response.ok) {
              metadata = await response.json();
            } else {
              metadataError = `HTTP ${response.status}`;
            }
          } catch (error) {
            metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
            console.error(`Error fetching IPFS metadata for seed ${seedId}:`, error);
          }
        }

        // Fetch blessing score
        let score = "0";
        try {
          const seedScore = await contractService.getSeedBlessingScore(seedId);
          score = seedScore.toString();
        } catch (error) {
          console.error(`Error fetching blessing score for seed ${seedId}:`, error);
        }

        return {
          id: seedId,
          tokenId,
          creator: seed.creator,
          ipfsHash: seed.ipfsHash,
          blessings: Number(seed.blessings),
          score,
          createdAt: Number(seed.createdAt),
          isWinner: seed.isWinner,
          isRetracted: seed.isRetracted,
          winnerInRound: Number(seed.winnerInRound),
          submittedInRound: Number(seed.submittedInRound),
          metadata,
          metadataError,
        };
      })
    );

    return c.json({
      success: true,
      data: {
        seeds: seedsWithMetadata,
        pagination: {
          page,
          limit,
          total: totalWinners,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching minted seeds:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch minted seeds",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/:seedId
 * Get details of a specific seed with its IPFS metadata
 */
seeds.get("/:seedId", async (c) => {
  try {
    const seedId = parseInt(c.req.param("seedId"));

    if (isNaN(seedId) || seedId < 0) {
      return c.json(
        {
          success: false,
          error: "Invalid seedId",
        },
        400
      );
    }

    const seed = await contractService.getSeed(seedId);

    // Fetch IPFS metadata
    let metadata = null;
    let metadataError = null;

    if (seed.ipfsHash) {
      try {
        // Convert IPFS hash to HTTP gateway URL
        const ipfsGateway = process.env.IPFS_GATEWAY || "https://tomato-causal-partridge-743.mypinata.cloud/ipfs/";
        const ipfsUrl = seed.ipfsHash.startsWith("ipfs://")
          ? seed.ipfsHash.replace("ipfs://", ipfsGateway)
          : seed.ipfsHash.startsWith("http")
          ? seed.ipfsHash
          : `${ipfsGateway}${seed.ipfsHash}`;

        const response = await fetch(ipfsUrl);

        if (response.ok) {
          metadata = await response.json();
        } else {
          metadataError = `HTTP ${response.status}`;
        }
      } catch (error) {
        metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
        console.error(`Error fetching IPFS metadata for seed ${seedId}:`, error);
      }
    }

    // Fetch blessing score
    let score = "0";
    try {
      const seedScore = await contractService.getSeedBlessingScore(seedId);
      score = seedScore.toString();
    } catch (error) {
      console.error(`Error fetching blessing score for seed ${seedId}:`, error);
    }

    // Fetch commandments
    let commandments: any[] = [];
    try {
      commandments = await commandmentService.getCommandmentsBySeed(seedId);
    } catch (error) {
      console.error(`Error fetching commandments for seed ${seedId}:`, error);
    }

    return c.json({
      success: true,
      data: {
        id: Number(seed.id),
        creator: seed.creator,
        ipfsHash: seed.ipfsHash,
        blessings: Number(seed.blessings),
        score: score,
        createdAt: Number(seed.createdAt),
        isWinner: seed.isWinner,
        isRetracted: seed.isRetracted,
        winnerInRound: Number(seed.winnerInRound),
        submittedInRound: Number(seed.submittedInRound),
        metadata: metadata,
        metadataError: metadataError,
        commandments: commandments,
        commandmentCount: commandments.length,
      },
    });
  } catch (error) {
    console.error("Error fetching seed:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch seed",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/:seedId/score
 * Get the blessing score for a specific seed
 *
 * The blessing score is calculated using sqrt of per-user blessings with time decay.
 * This prevents gaming the system by having one user spam blessings.
 */
seeds.get("/:seedId/score", async (c) => {
  try {
    const seedId = parseInt(c.req.param("seedId"));

    if (isNaN(seedId) || seedId < 0) {
      return c.json(
        {
          success: false,
          error: "Invalid seedId",
        },
        400
      );
    }

    const score = await contractService.getSeedBlessingScore(seedId);

    // Get seed details for additional context
    let seed = null;
    try {
      seed = await contractService.getSeed(seedId);
    } catch (error) {
      console.warn(`Could not fetch seed details for ${seedId}:`, error);
    }

    return c.json({
      success: true,
      data: {
        seedId,
        score: score.toString(),
        rawBlessings: seed ? Number(seed.blessings) : null,
        isWinner: seed ? seed.isWinner : null,
        note: "Score is calculated using sqrt of per-user blessings with time decay",
      },
    });
  } catch (error) {
    console.error("Error fetching seed blessing score:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch seed blessing score",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
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
  } catch (error) {
    console.error("Error fetching seed count:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch seed count",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/stats
 * Get voting period status, current leader, and time remaining
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "currentRound": number,
 *     "timeUntilPeriodEnd": number,  // seconds
 *     "periodEnded": boolean,
 *     "currentLeader": {
 *       "seedId": number,
 *       "score": string,
 *       "seed": {...}
 *     },
 *     "seedsInRound": number
 *   }
 * }
 */
seeds.get("/stats", async (c) => {
  try {
    // Get current round
    const currentRound = await contractService.getCurrentRound();

    // Get time until period end
    const timeRemaining = await contractService.getTimeUntilPeriodEnd();

    // Get current leader
    const leader = await contractService.getCurrentLeader();

    // Get seeds in current round
    const roundSeeds = await contractService.getCurrentRoundSeeds();

    // Fetch leader seed details if there is a leader
    let leaderSeed = null;
    if (leader.leadingSeedId > 0n) {
      try {
        const seed = await contractService.getSeed(Number(leader.leadingSeedId));
        leaderSeed = {
          id: Number(seed.id),
          creator: seed.creator,
          ipfsHash: seed.ipfsHash,
          blessings: Number(seed.blessings),
          createdAt: Number(seed.createdAt),
          isWinner: seed.isWinner,
          isRetracted: seed.isRetracted,
          winnerInRound: Number(seed.winnerInRound),
          submittedInRound: Number(seed.submittedInRound),
        };
      } catch (error) {
        console.error(`Error fetching leader seed details:`, error);
      }
    }

    return c.json({
      success: true,
      data: {
        currentRound: Number(currentRound),
        timeUntilPeriodEnd: Number(timeRemaining),
        periodEnded: timeRemaining === 0n,
        currentLeader: {
          seedId: Number(leader.leadingSeedId),
          score: leader.score.toString(),
          seed: leaderSeed,
        },
        seedsInRound: roundSeeds.length,
      },
    });
  } catch (error) {
    console.error("Error fetching voting stats:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch voting stats",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/creator/:address/check
 * Check if an address has CREATOR_ROLE
 */
seeds.get("/creator/:address/check", async (c) => {
  try {
    const address = c.req.param("address") as Address;

    if (!address || !address.startsWith("0x")) {
      return c.json(
        {
          success: false,
          error: "Invalid address",
        },
        400
      );
    }

    const hasRole = await contractService.hasCreatorRole(address);

    return c.json({
      success: true,
      data: {
        address,
        hasCreatorRole: hasRole,
      },
    });
  } catch (error) {
    console.error("Error checking creator role:", error);
    return c.json(
      {
        success: false,
        error: "Failed to check creator role",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/round/current
 * Get all seeds from the current round with metadata and scores
 */
seeds.get("/round/current", async (c) => {
  try {
    const currentRound = await contractService.getCurrentRound();
    const roundSeeds = await contractService.getCurrentRoundSeeds();

    // Fetch metadata and scores for each seed
    const seedsWithMetadata = await Promise.all(
      roundSeeds.map(async (seed) => {
        const seedId = Number(seed.id);

        // Fetch IPFS metadata
        let metadata = null;
        let metadataError = null;

        if (seed.ipfsHash) {
          try {
            // Convert IPFS hash to HTTP gateway URL
            const ipfsGateway = process.env.IPFS_GATEWAY || "https://tomato-causal-partridge-743.mypinata.cloud/ipfs/";
            const ipfsUrl = seed.ipfsHash.startsWith("ipfs://")
              ? seed.ipfsHash.replace("ipfs://", ipfsGateway)
              : seed.ipfsHash.startsWith("http")
              ? seed.ipfsHash
              : `${ipfsGateway}${seed.ipfsHash}`;

            const response = await fetch(ipfsUrl);

            if (response.ok) {
              metadata = await response.json();
            } else {
              metadataError = `HTTP ${response.status}`;
            }
          } catch (error) {
            metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
            console.error(`Error fetching IPFS metadata for seed ${seedId}:`, error);
          }
        }

        // Fetch blessing score
        let score = 0;
        try {
          const seedScore = await contractService.getSeedBlessingScore(seedId);
          score = Number(seedScore);
        } catch (error) {
          console.error(`Error fetching blessing score for seed ${seedId}:`, error);
        }

        return {
          id: seedId,
          creator: seed.creator,
          ipfsHash: seed.ipfsHash,
          blessings: Number(seed.blessings),
          score: score,
          createdAt: Number(seed.createdAt),
          isWinner: seed.isWinner,
          isRetracted: seed.isRetracted,
          winnerInRound: Number(seed.winnerInRound),
          submittedInRound: Number(seed.submittedInRound),
          metadata: metadata,
          metadataError: metadataError,
        };
      })
    );

    return c.json({
      success: true,
      data: {
        currentRound: Number(currentRound),
        seeds: seedsWithMetadata,
        count: seedsWithMetadata.length,
      },
    });
  } catch (error) {
    console.error("Error fetching current round seeds:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch current round seeds",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/round/:roundNumber
 * Get all seeds from a specific round with metadata and scores
 */
seeds.get("/round/:roundNumber", async (c) => {
  try {
    const roundNumber = parseInt(c.req.param("roundNumber"));

    if (isNaN(roundNumber) || roundNumber < 1) {
      return c.json(
        {
          success: false,
          error: "Invalid round number",
        },
        400
      );
    }

    const roundSeeds = await contractService.getSeedsByRound(roundNumber);

    // Fetch metadata and scores for each seed
    const seedsWithMetadata = await Promise.all(
      roundSeeds.map(async (seed) => {
        const seedId = Number(seed.id);

        // Fetch IPFS metadata
        let metadata = null;
        let metadataError = null;

        if (seed.ipfsHash) {
          try {
            // Convert IPFS hash to HTTP gateway URL
            const ipfsGateway = process.env.IPFS_GATEWAY || "https://tomato-causal-partridge-743.mypinata.cloud/ipfs/";
            const ipfsUrl = seed.ipfsHash.startsWith("ipfs://")
              ? seed.ipfsHash.replace("ipfs://", ipfsGateway)
              : seed.ipfsHash.startsWith("http")
              ? seed.ipfsHash
              : `${ipfsGateway}${seed.ipfsHash}`;

            const response = await fetch(ipfsUrl);

            if (response.ok) {
              metadata = await response.json();
            } else {
              metadataError = `HTTP ${response.status}`;
            }
          } catch (error) {
            metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
            console.error(`Error fetching IPFS metadata for seed ${seedId}:`, error);
          }
        }

        // Fetch blessing score
        let score = 0;
        try {
          const seedScore = await contractService.getSeedBlessingScore(seedId);
          score = Number(seedScore);
        } catch (error) {
          console.error(`Error fetching blessing score for seed ${seedId}:`, error);
        }

        return {
          id: seedId,
          creator: seed.creator,
          ipfsHash: seed.ipfsHash,
          blessings: Number(seed.blessings),
          score: score,
          createdAt: Number(seed.createdAt),
          isWinner: seed.isWinner,
          isRetracted: seed.isRetracted,
          winnerInRound: Number(seed.winnerInRound),
          submittedInRound: Number(seed.submittedInRound),
          metadata: metadata,
          metadataError: metadataError,
        };
      })
    );

    return c.json({
      success: true,
      data: {
        round: roundNumber,
        seeds: seedsWithMetadata,
        count: seedsWithMetadata.length,
      },
    });
  } catch (error) {
    console.error("Error fetching round seeds:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch round seeds",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/token/:tokenId
 * Get seed information by its NFT token ID
 */
seeds.get("/token/:tokenId", async (c) => {
  try {
    const tokenId = parseInt(c.req.param("tokenId"));

    if (isNaN(tokenId) || tokenId < 0) {
      return c.json(
        {
          success: false,
          error: "Invalid tokenId",
        },
        400
      );
    }

    // Get seed ID from token ID
    const seedId = await contractService.getSeedIdByTokenId(tokenId);

    // Get seed details
    const seed = await contractService.getSeed(Number(seedId));

    // Fetch IPFS metadata
    let metadata = null;
    let metadataError = null;

    if (seed.ipfsHash) {
      try {
        const ipfsGateway = process.env.IPFS_GATEWAY || "https://tomato-causal-partridge-743.mypinata.cloud/ipfs/";
        const ipfsUrl = seed.ipfsHash.startsWith("ipfs://")
          ? seed.ipfsHash.replace("ipfs://", ipfsGateway)
          : seed.ipfsHash.startsWith("http")
          ? seed.ipfsHash
          : `${ipfsGateway}${seed.ipfsHash}`;

        const response = await fetch(ipfsUrl);

        if (response.ok) {
          metadata = await response.json();
        } else {
          metadataError = `HTTP ${response.status}`;
        }
      } catch (error) {
        metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
        console.error(`Error fetching IPFS metadata:`, error);
      }
    }

    return c.json({
      success: true,
      data: {
        tokenId,
        seedId: Number(seedId),
        seed: {
          id: Number(seed.id),
          creator: seed.creator,
          ipfsHash: seed.ipfsHash,
          blessings: Number(seed.blessings),
          createdAt: Number(seed.createdAt),
          isWinner: seed.isWinner,
          isRetracted: seed.isRetracted,
          winnerInRound: Number(seed.winnerInRound),
          submittedInRound: Number(seed.submittedInRound),
        },
        metadata,
        metadataError,
      },
    });
  } catch (error) {
    console.error("Error fetching seed by token:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch seed by token ID",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/:seedId/token
 * Get NFT token ID for a winning seed
 * Returns 0 if seed hasn't won yet
 */
seeds.get("/:seedId/token", async (c) => {
  try {
    const seedId = parseInt(c.req.param("seedId"));

    if (isNaN(seedId) || seedId < 0) {
      return c.json(
        {
          success: false,
          error: "Invalid seedId",
        },
        400
      );
    }

    const tokenId = await contractService.getTokenIdBySeedId(seedId);

    return c.json({
      success: true,
      data: {
        seedId,
        tokenId: Number(tokenId),
        hasWon: tokenId > 0n,
      },
    });
  } catch (error) {
    console.error("Error fetching token for seed:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch token ID for seed",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/:seedId/score/round/:roundNumber
 * Get blessing score for a seed in a specific round
 */
seeds.get("/:seedId/score/round/:roundNumber", async (c) => {
  try {
    const seedId = parseInt(c.req.param("seedId"));
    const roundNumber = parseInt(c.req.param("roundNumber"));

    if (isNaN(seedId) || seedId < 0) {
      return c.json(
        {
          success: false,
          error: "Invalid seedId",
        },
        400
      );
    }

    if (isNaN(roundNumber) || roundNumber < 1) {
      return c.json(
        {
          success: false,
          error: "Invalid round number",
        },
        400
      );
    }

    const score = await contractService.getSeedScoreByRound(roundNumber, seedId);

    return c.json({
      success: true,
      data: {
        seedId,
        round: roundNumber,
        score: score.toString(),
      },
    });
  } catch (error) {
    console.error("Error fetching seed score by round:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch seed score for round",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /seeds/config
 * Get contract configuration (round mode, strategies, etc.)
 */
seeds.get("/config", async (c) => {
  try {
    const roundMode = await contractService.getRoundMode();
    const tieBreakingStrategy = await contractService.getTieBreakingStrategy();
    const deadlockStrategy = await contractService.getDeadlockStrategy();
    const eligibleSeedsCount = await contractService.getEligibleSeedsCount();
    const secondsUntilReset = await contractService.getSecondsUntilDailyReset();

    // Map enums to readable names
    const roundModeNames = ["ROUND_BASED", "NON_ROUND_BASED"];
    const tieBreakingNames = ["LOWEST_SEED_ID", "EARLIEST_SUBMISSION", "PSEUDO_RANDOM"];
    const deadlockNames = ["REVERT", "SKIP_ROUND"];

    return c.json({
      success: true,
      data: {
        roundMode: {
          value: roundMode,
          name: roundModeNames[roundMode] || "UNKNOWN",
        },
        tieBreakingStrategy: {
          value: tieBreakingStrategy,
          name: tieBreakingNames[tieBreakingStrategy] || "UNKNOWN",
        },
        deadlockStrategy: {
          value: deadlockStrategy,
          name: deadlockNames[deadlockStrategy] || "UNKNOWN",
        },
        eligibleSeedsCount: Number(eligibleSeedsCount),
        secondsUntilBlessingReset: Number(secondsUntilReset),
      },
    });
  } catch (error) {
    console.error("Error fetching contract config:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch contract configuration",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export default seeds;
