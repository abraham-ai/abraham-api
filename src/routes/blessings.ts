import { Hono } from "hono";
import { withAuth, getAuthUser } from "../middleware/auth.js";
import { blessingService } from "../services/blessingService.js";
import { contractService } from "../services/contractService.js";
import type { Address } from "viem";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { AbrahamFirstWorks } from "../../lib/abi/firstWorks.js";

const blessings = new Hono();

/**
 * GET /blessings/eligibility
 * Check if the authenticated user is eligible to bless
 */
blessings.get("/eligibility", withAuth, async (c) => {
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

    const eligibility = await blessingService.canBless(user.walletAddress);

    return c.json({
      success: true,
      data: eligibility,
    });
  } catch (error) {
    console.error("Error checking eligibility:", error);
    return c.json(
      {
        success: false,
        error: "Failed to check eligibility",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /blessings/stats
 * Get blessing statistics for the authenticated user
 */
blessings.get("/stats", withAuth, async (c) => {
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

    const stats = await blessingService.getBlessingStats(user.walletAddress);

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching blessing stats:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch blessing stats",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * POST /blessings
 * Perform a blessing (backend signs and submits to blockchain)
 *
 * This is the GASLESS option - backend submits the transaction on behalf of the user.
 * Requires:
 * - User must be authenticated
 * - User must be eligible (owns FirstWorks NFTs)
 * - User must not have already blessed this seed
 * - Backend must have RELAYER_ROLE or user must have approved backend as delegate
 *
 * Request body:
 * {
 *   "seedId": number // ID of the seed to bless
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "seedId": number,
 *     "txHash": "0x...",
 *     "blessingCount": number, // Total blessings for this seed
 *     "remainingBlessings": number,
 *     "blockExplorer": string,
 *     "message": string
 *   }
 * }
 */
blessings.post("/", withAuth, async (c) => {
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
    const { seedId } = body;

    if (seedId === undefined || seedId === null) {
      return c.json(
        {
          success: false,
          error: "seedId is required",
        },
        400
      );
    }

    const seedIdNum = Number(seedId);
    if (isNaN(seedIdNum) || seedIdNum < 0) {
      return c.json(
        {
          success: false,
          error: "Invalid seedId - must be a non-negative number",
        },
        400
      );
    }

    // Let blessingService handle all the blessing logic
    const result = await blessingService.performBlessingOnchain(
      user.walletAddress,
      seedIdNum
    );

    if (!result.success) {
      // Determine appropriate status code based on error
      let statusCode: 400 | 403 | 404 | 500 | 503 = 500;
      if (result.error?.includes("not eligible")) statusCode = 403;
      else if (result.error?.includes("not found")) statusCode = 404;
      else if (result.error?.includes("not configured")) statusCode = 503;
      else if (result.error?.includes("not authorized")) statusCode = 403;
      else if (result.error?.includes("limit reached")) statusCode = 400;

      return c.json(
        {
          success: false,
          error: result.error,
          remainingBlessings: result.remainingBlessings,
        },
        statusCode
      );
    }

    return c.json({
      success: true,
      data: {
        seedId: seedIdNum,
        txHash: result.txHash,
        blessingCount: result.blessingCount,
        remainingBlessings: result.remainingBlessings,
        blockExplorer: result.blockExplorer,
        message: "Blessing submitted successfully",
      },
    });
  } catch (error) {
    console.error("Error performing blessing:", error);
    return c.json(
      {
        success: false,
        error: "Failed to perform blessing",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * POST /blessings/prepare
 * Prepare a blessing transaction for CLIENT-SIDE signing
 *
 * This returns transaction data that the user can sign with their wallet.
 * Use this when you want users to pay gas themselves.
 *
 * Request body:
 * {
 *   "seedId": number // ID of the seed to bless
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
 *     "seedInfo": {...},     // Information about the seed
 *     "userInfo": {...},     // User's blessing stats
 *     "instructions": {...}  // Step-by-step instructions
 *   }
 * }
 */
blessings.post("/prepare", withAuth, async (c) => {
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
    const { seedId } = body;

    if (seedId === undefined || seedId === null) {
      return c.json(
        {
          success: false,
          error: "seedId is required",
        },
        400
      );
    }

    const seedIdNum = Number(seedId);
    if (isNaN(seedIdNum) || seedIdNum < 0) {
      return c.json(
        {
          success: false,
          error: "Invalid seedId - must be a non-negative number",
        },
        400
      );
    }

    // Let blessingService handle all the preparation logic
    const result = await blessingService.prepareBlessingTransaction(
      user.walletAddress,
      seedIdNum
    );

    if (!result.success) {
      // Determine appropriate status code based on error
      let statusCode: 400 | 403 | 404 | 500 = 500;
      if (result.error?.includes("not eligible")) statusCode = 403;
      else if (result.error?.includes("not found")) statusCode = 404;
      else if (result.error?.includes("Cannot bless")) statusCode = 400;
      else if (result.error?.includes("limit reached")) statusCode = 400;

      return c.json(
        {
          success: false,
          error: result.error,
        },
        statusCode
      );
    }

    return c.json({
      success: true,
      data: {
        transaction: result.transaction,
        seedInfo: result.seedInfo,
        userInfo: result.userInfo,
        instructions: {
          step1: "Send this transaction using your wallet",
          step2: "Wait for transaction confirmation",
          step3: "Your blessing will be recorded on-chain",
        },
      },
    });
  } catch (error) {
    console.error("Error preparing blessing:", error);
    return c.json(
      {
        success: false,
        error: "Failed to prepare blessing transaction",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /blessings/delegation-status
 * Get delegation information for the authenticated user
 *
 * This endpoint checks if the user has approved the backend as their delegate,
 * which enables gasless blessings. It also provides the backend's address
 * and other relevant delegation information.
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "userAddress": "0x...",
 *     "backendAddress": "0x...",
 *     "isDelegateApproved": boolean,
 *     "canUseGaslessBlessings": boolean,
 *     "message": string
 *   }
 * }
 */
blessings.get("/delegation-status", withAuth, async (c) => {
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

    // Get backend's relayer address
    const backendAddress = contractService.getRelayerAddress();

    if (!backendAddress) {
      return c.json({
        success: true,
        data: {
          userAddress: user.walletAddress,
          backendAddress: null,
          isDelegateApproved: false,
          canUseGaslessBlessings: false,
          message:
            "Backend relayer not configured. Gasless blessings are not available.",
        },
      });
    }

    // Check if user has approved backend as delegate
    const isDelegateApproved = await contractService.isDelegate(
      user.walletAddress as Address,
      backendAddress
    );

    return c.json({
      success: true,
      data: {
        userAddress: user.walletAddress,
        backendAddress,
        isDelegateApproved,
        canUseGaslessBlessings: isDelegateApproved,
        message: isDelegateApproved
          ? "You have approved gasless blessings. The backend can submit blessings on your behalf."
          : "You have not yet approved gasless blessings. Call POST /blessings/prepare-delegate to get started.",
      },
    });
  } catch (error) {
    console.error("Error checking delegation status:", error);
    return c.json(
      {
        success: false,
        error: "Failed to check delegation status",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * POST /blessings/prepare-delegate
 * Prepare a delegate approval transaction for CLIENT-SIDE signing
 *
 * Users must call this to approve the backend as their delegate,
 * enabling gasless blessings via POST /blessings
 *
 * Request body (optional):
 * {
 *   "approved": boolean // true to approve, false to revoke (default: true)
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "transaction": {
 *       "to": "0x...",
 *       "data": "0x...",
 *       "from": "0x...",
 *       "chainId": number
 *     },
 *     "delegateAddress": "0x...",
 *     "currentStatus": string,
 *     "message": string
 *   }
 * }
 */
blessings.post("/prepare-delegate", withAuth, async (c) => {
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

    // Parse request body
    const body = await c.req.json().catch(() => ({}));
    const approved = body.approved !== false; // Default to true

    // Let blessingService handle the delegate approval preparation
    const result = await blessingService.prepareDelegateApprovalTransaction(
      user.walletAddress,
      approved
    );

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error,
        },
        500
      );
    }

    return c.json({
      success: true,
      data: {
        transaction: result.transaction,
        delegateAddress: result.delegateAddress,
        currentStatus: result.currentStatus,
        message: approved
          ? "Sign this transaction to approve gasless blessings"
          : "Sign this transaction to revoke gasless blessings",
      },
    });
  } catch (error) {
    console.error("Error preparing delegate approval:", error);
    return c.json(
      {
        success: false,
        error: "Failed to prepare delegate approval transaction",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /blessings/seed/:seedId
 * Get all blessings for a specific seed (from blockchain)
 */
blessings.get("/seed/:seedId", async (c) => {
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

    // Get seed info
    const seed = await contractService.getSeed(seedId);

    // Get all blessings
    const blessings = await contractService.getSeedBlessings(seedId);

    return c.json({
      success: true,
      data: {
        seedId,
        seed: {
          title: seed.title,
          creator: seed.creator,
          blessings: Number(seed.blessings),
          votes: Number(seed.votes),
        },
        blessings: blessings.map((b) => ({
          blesser: b.blesser,
          actor: b.actor,
          timestamp: Number(b.timestamp),
          isDelegated: b.isDelegated,
        })),
        count: blessings.length,
      },
    });
  } catch (error) {
    console.error("Error fetching seed blessings:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch seed blessings",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /blessings/user/:address
 * Get all blessings by a specific user (from blockchain)
 */
blessings.get("/user/:address", async (c) => {
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

    const blessings = await contractService.getUserBlessings(address);

    return c.json({
      success: true,
      data: {
        address,
        blessings: blessings.map((b) => ({
          seedId: Number(b.seedId),
          actor: b.actor,
          timestamp: Number(b.timestamp),
          isDelegated: b.isDelegated,
        })),
        count: blessings.length,
      },
    });
  } catch (error) {
    console.error("Error fetching user blessings:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch user blessings",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /blessings/total
 * Get total number of blessings across all seeds
 */
blessings.get("/total", async (c) => {
  try {
    const total = await contractService.getTotalBlessings();

    return c.json({
      success: true,
      data: {
        totalBlessings: Number(total),
      },
    });
  } catch (error) {
    console.error("Error fetching total blessings:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch total blessings",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Legacy endpoints for backward compatibility
blessings.get("/all", async (c) => {
  return c.json({
    success: false,
    error: "This endpoint is deprecated",
    message: "Use /blessings/seed/:seedId or /blessings/user/:address instead",
  });
});

blessings.get("/target/:targetId", async (c) => {
  const targetId = c.req.param("targetId");
  return c.redirect(`/blessings/seed/${targetId}`);
});

blessings.get("/wallet/:walletAddress", async (c) => {
  const address = c.req.param("walletAddress");
  return c.redirect(`/blessings/user/${address}`);
});

blessings.get("/firstworks/snapshot", async (c) => {
  try {
    const snapshot = await blessingService.getSnapshot();

    if (!snapshot) {
      return c.json(
        {
          success: false,
          error: "No snapshot available",
          message: "Run 'npm run snapshot:generate' to create a snapshot",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    console.error("Error fetching snapshot:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch snapshot",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

blessings.post("/firstworks/reload-snapshot", async (c) => {
  try {
    await blessingService.reloadSnapshot();

    return c.json({
      success: true,
      message: "FirstWorks snapshot reloaded successfully",
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
 * GET /blessings/firstworks/nfts/:address
 * Get all FirstWorks NFTs owned by an address with metadata
 *
 * This endpoint:
 * 1. Fetches token IDs from the snapshot
 * 2. Fetches metadata for each token from the contract's tokenURI
 * 3. Fetches and parses the metadata JSON from IPFS/HTTP
 * 4. Returns NFTs with complete metadata for frontend display
 *
 * @param address - Ethereum wallet address
 * @returns Array of NFTs with metadata (image, name, description, attributes, etc.)
 */
blessings.get("/firstworks/nfts/:address", async (c) => {
  try {
    const address = c.req.param("address").toLowerCase() as Address;

    // Validate address format
    if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return c.json(
        {
          success: false,
          error: "Invalid Ethereum address format",
        },
        400
      );
    }

    // Get snapshot to find token IDs
    const snapshot = await blessingService.getSnapshot();
    if (!snapshot) {
      return c.json(
        {
          success: false,
          error: "No snapshot available",
          message: "Snapshot data is not yet available. Please try again later.",
        },
        404
      );
    }

    // Get token IDs for this address
    const tokenIds = snapshot.holderIndex[address] || [];

    if (tokenIds.length === 0) {
      return c.json({
        success: true,
        data: {
          address,
          nfts: [],
          totalOwned: 0,
        },
      });
    }

    // Create client to fetch metadata from contract
    const FIRSTWORKS_RPC_URL = process.env.FIRSTWORKS_RPC_URL;
    // Use FIRSTWORKS_CONTRACT_ADDRESS or fallback to known address
    const FIRSTWORKS_ADDRESS = (
      process.env.FIRSTWORKS_CONTRACT_ADDRESS ||
      "0x8F814c7C75C5E9e0EDe0336F535604B1915C1985"
    ) as Address;

    if (!FIRSTWORKS_RPC_URL) {
      return c.json(
        {
          success: false,
          error: "FirstWorks RPC URL not configured. Set FIRSTWORKS_RPC_URL in environment variables.",
        },
        500
      );
    }

    const client = createPublicClient({
      chain: mainnet,
      transport: http(FIRSTWORKS_RPC_URL),
    });

    // Fetch metadata for each token
    const nfts = await Promise.all(
      tokenIds.map(async (tokenId) => {
        try {
          // Get tokenURI from contract
          const tokenURI = await client.readContract({
            address: FIRSTWORKS_ADDRESS,
            abi: AbrahamFirstWorks,
            functionName: "tokenURI",
            args: [BigInt(tokenId)],
          }) as string;

          // Fetch metadata from URI (IPFS or HTTP)
          let metadata = null;
          let metadataError = null;

          try {
            // Convert IPFS URI to HTTP gateway if needed
            const metadataURL = tokenURI.startsWith("ipfs://")
              ? tokenURI.replace("ipfs://", "https://ipfs.io/ipfs/")
              : tokenURI;

            const response = await fetch(metadataURL);
            if (response.ok) {
              metadata = await response.json();
            } else {
              metadataError = `HTTP ${response.status}`;
            }
          } catch (error) {
            metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
          }

          return {
            tokenId,
            tokenURI,
            metadata,
            metadataError,
          };
        } catch (error) {
          console.error(`Error fetching metadata for token ${tokenId}:`, error);
          return {
            tokenId,
            tokenURI: null,
            metadata: null,
            metadataError: error instanceof Error ? error.message : "Unknown error",
          };
        }
      })
    );

    return c.json({
      success: true,
      data: {
        address,
        nfts,
        totalOwned: nfts.length,
        contractAddress: FIRSTWORKS_ADDRESS,
        contractName: snapshot.contractName,
      },
    });
  } catch (error) {
    console.error("Error fetching FirstWorks NFTs:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch NFTs",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export default blessings;
