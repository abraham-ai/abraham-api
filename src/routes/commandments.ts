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
    if (!seedId || seedId < 0) {
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
