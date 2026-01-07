import { Hono } from "hono";
import { withAuth, getAuthUser } from "../middleware/auth.js";
import { commandmentService } from "../services/commandmentService.js";
import { contractService } from "../services/contractService.js";
import type { Address } from "viem";

const commandments = new Hono();

/**
 * POST /commandments
 * Submit a commandment (comment) on a seed
 * Requires authentication
 */
commandments.post("/", withAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user || !user.walletAddress) {
      return c.json(
        { success: false, error: "Wallet address not found" },
        400
      );
    }

    const body = await c.req.json();
    const { seedId, message } = body;

    // Validate input
    if (typeof seedId !== 'number' || seedId < 0) {
      return c.json(
        { success: false, error: "Valid seedId is required" },
        400
      );
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return c.json(
        { success: false, error: "Message is required and must be a non-empty string" },
        400
      );
    }

    if (message.length > 5000) {
      return c.json(
        { success: false, error: "Message too long (max 5000 characters)" },
        400
      );
    }

    // Submit commandment
    const result = await commandmentService.submitCommandment(
      user.walletAddress,
      Number(seedId),
      message
    );

    if (!result.success) {
      return c.json({ success: false, error: result.error }, 400);
    }

    const network = process.env.NETWORK || "base-sepolia";
    const blockExplorer =
      network === "base"
        ? `https://basescan.org/tx/${result.txHash}`
        : `https://sepolia.basescan.org/tx/${result.txHash}`;

    return c.json({
      success: true,
      data: {
        commandmentId: result.commandmentId,
        ipfsHash: result.ipfsHash,
        txHash: result.txHash,
        blockExplorer,
      },
    });
  } catch (error) {
    console.error("Error submitting commandment:", error);
    return c.json(
      {
        success: false,
        error: "Failed to submit commandment",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * POST /commandments/prepare
 * Prepare a commandment transaction for CLIENT-SIDE signing
 *
 * This returns transaction data that the user can sign with their wallet.
 * Use this when you want users to pay gas themselves (non-delegated).
 *
 * Request body:
 * {
 *   "seedId": number,  // ID of the seed to comment on
 *   "message": string  // Comment message text
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
 *     "userInfo": {...},     // User's commandment stats
 *     "ipfsHash": string,    // IPFS hash of uploaded message
 *     "instructions": {...}  // Step-by-step instructions
 *   }
 * }
 */
commandments.post("/prepare", withAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user || !user.walletAddress) {
      return c.json(
        { success: false, error: "Wallet address not found" },
        400
      );
    }

    const body = await c.req.json();
    const { seedId, message } = body;

    // Validate input
    if (typeof seedId !== 'number' || seedId < 0) {
      return c.json(
        { success: false, error: "Valid seedId is required" },
        400
      );
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return c.json(
        { success: false, error: "Message is required and must be a non-empty string" },
        400
      );
    }

    if (message.length > 5000) {
      return c.json(
        { success: false, error: "Message too long (max 5000 characters)" },
        400
      );
    }

    // Prepare commandment transaction
    const result = await commandmentService.prepareCommandmentTransaction(
      user.walletAddress,
      Number(seedId),
      message
    );

    if (!result.success) {
      // Determine appropriate status code based on error
      let statusCode: 400 | 403 | 404 | 500 = 500;
      if (result.error?.includes("not eligible")) statusCode = 403;
      else if (result.error?.includes("must own")) statusCode = 403;
      else if (result.error?.includes("not found")) statusCode = 404;
      else if (result.error?.includes("Cannot comment")) statusCode = 400;
      else if (result.error?.includes("limit reached")) statusCode = 400;
      else if (result.error?.includes("retracted")) statusCode = 400;

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
        ipfsHash: result.ipfsHash,
        instructions: {
          step1: "Send this transaction using your wallet",
          step2: "Wait for transaction confirmation",
          step3: "Your commandment will be recorded on-chain",
          note: "The message has been uploaded to IPFS and the transaction includes the IPFS hash"
        },
      },
    });
  } catch (error) {
    console.error("Error preparing commandment:", error);
    return c.json(
      {
        success: false,
        error: "Failed to prepare commandment transaction",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /commandments/seed/:seedId
 * Get all commandments for a specific seed
 */
commandments.get("/seed/:seedId", async (c) => {
  try {
    const seedId = parseInt(c.req.param("seedId"));

    if (isNaN(seedId) || seedId < 0) {
      return c.json({ success: false, error: "Invalid seedId" }, 400);
    }

    const commandments = await commandmentService.getCommandmentsBySeed(seedId);

    return c.json({
      success: true,
      data: {
        seedId,
        commandments,
        total: commandments.length,
      },
    });
  } catch (error) {
    console.error("Error fetching commandments:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch commandments",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /commandments/user/:address
 * Get all commandments by a specific user
 */
commandments.get("/user/:address", async (c) => {
  try {
    const address = c.req.param("address") as Address;

    if (!address || !address.startsWith("0x")) {
      return c.json({ success: false, error: "Invalid address" }, 400);
    }

    const userCommandments =
      await commandmentService.getCommandmentsByUser(address);

    return c.json({
      success: true,
      data: {
        address,
        commandments: userCommandments,
        total: userCommandments.length,
      },
    });
  } catch (error) {
    console.error("Error fetching user commandments:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch user commandments",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /commandments/stats
 * Get commandment statistics for authenticated user
 * Requires authentication
 */
commandments.get("/stats", withAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user || !user.walletAddress) {
      return c.json(
        { success: false, error: "Wallet address not found" },
        400
      );
    }

    const stats = await commandmentService.getCommandmentStats(
      user.walletAddress
    );

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching commandment stats:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch commandment stats",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * GET /commandments/eligibility
 * Check if the authenticated user can submit commandments
 * Requires authentication
 */
commandments.get("/eligibility", withAuth, async (c) => {
  try {
    const user = getAuthUser(c);
    if (!user || !user.walletAddress) {
      return c.json(
        { success: false, error: "Wallet address not found" },
        400
      );
    }

    const eligibility = await commandmentService.canComment(
      user.walletAddress
    );

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
 * GET /commandments/all
 * Get all commandments from all seeds
 * Returns paginated results
 */
commandments.get("/all", async (c) => {
  try {
    const events = await commandmentService.getAllCommandmentEvents();

    return c.json({
      success: true,
      data: {
        commandments: events,
        total: events.length,
      },
    });
  } catch (error) {
    console.error("Error fetching all commandments:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch commandments",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export default commandments;
