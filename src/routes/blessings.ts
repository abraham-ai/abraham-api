import { Hono } from "hono";
import { withAuth, getAuthUser } from "../middleware/auth.js";
import { blessingService } from "../services/blessingService.js";

const blessings = new Hono();

/**
 * GET /blessings/eligibility
 * Check if the authenticated user is eligible to bless
 */
blessings.get("/eligibility", withAuth, async (c) => {
  try {
    const user = getAuthUser(c);

    if (!user || !user.walletAddress) {
      return c.json({ error: "Wallet address not found" }, 400);
    }

    const eligibility = await blessingService.canBless(user.walletAddress);

    return c.json({
      success: true,
      data: eligibility,
    });
  } catch (error) {
    console.error("Error checking eligibility:", error);
    return c.json(
      { error: "Failed to check eligibility", details: String(error) },
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
      return c.json({ error: "Wallet address not found" }, 400);
    }

    const stats = await blessingService.getBlessingStats(user.walletAddress);

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching blessing stats:", error);
    return c.json(
      { error: "Failed to fetch blessing stats", details: String(error) },
      500
    );
  }
});

/**
 * POST /blessings
 * Perform a blessing
 *
 * Request body:
 * {
 *   "targetId": "string" // ID of the content/item being blessed
 * }
 */
blessings.post("/", withAuth, async (c) => {
  try {
    const user = getAuthUser(c);

    if (!user || !user.walletAddress) {
      return c.json({ error: "Wallet address not found" }, 400);
    }

    // Parse request body
    const body = await c.req.json();
    const { targetId } = body;

    if (!targetId) {
      return c.json({ error: "targetId is required" }, 400);
    }

    // Perform the blessing
    const result = await blessingService.performBlessing(
      user.walletAddress,
      targetId
    );

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error,
          remainingBlessings: result.remainingBlessings,
        },
        403
      );
    }

    return c.json({
      success: true,
      data: {
        targetId,
        remainingBlessings: result.remainingBlessings,
        message: "Blessing performed successfully",
      },
    });
  } catch (error) {
    console.error("Error performing blessing:", error);
    return c.json(
      { error: "Failed to perform blessing", details: String(error) },
      500
    );
  }
});

/**
 * POST /blessings/reload-snapshot
 * Admin endpoint to force reload the NFT snapshot
 * (In production, you might want to add admin authentication)
 */
blessings.post("/reload-snapshot", async (c) => {
  try {
    await blessingService.reloadSnapshot();

    return c.json({
      success: true,
      message: "Snapshot reloaded successfully",
    });
  } catch (error) {
    console.error("Error reloading snapshot:", error);
    return c.json(
      { error: "Failed to reload snapshot", details: String(error) },
      500
    );
  }
});

export default blessings;
