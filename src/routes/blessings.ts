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
        blessing: result.blessing,
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
 * GET /blessings/all
 * Get all blessing records with optional filters and pagination
 *
 * Query parameters:
 * - walletAddress: Filter by wallet address
 * - targetId: Filter by target ID
 * - limit: Number of results per page (default: 50)
 * - offset: Pagination offset (default: 0)
 * - sortOrder: "asc" or "desc" (default: "desc" - most recent first)
 */
blessings.get("/all", async (c) => {
  try {
    const walletAddress = c.req.query("walletAddress");
    const targetId = c.req.query("targetId");
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");
    const sortOrder = c.req.query("sortOrder") as "asc" | "desc" | undefined;

    const result = blessingService.getAllBlessings({
      walletAddress,
      targetId,
      limit,
      offset,
      sortOrder,
    });

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching blessings:", error);
    return c.json(
      { error: "Failed to fetch blessings", details: String(error) },
      500
    );
  }
});

/**
 * GET /blessings/target/:targetId
 * Get all blessings for a specific target/creation
 */
blessings.get("/target/:targetId", async (c) => {
  try {
    const targetId = c.req.param("targetId");

    if (!targetId) {
      return c.json({ error: "targetId is required" }, 400);
    }

    const blessingsForTarget =
      blessingService.getBlessingsForTarget(targetId);
    const blessingCount = blessingService.getBlessingCountForTarget(targetId);

    return c.json({
      success: true,
      data: {
        targetId,
        blessings: blessingsForTarget,
        count: blessingCount,
      },
    });
  } catch (error) {
    console.error("Error fetching target blessings:", error);
    return c.json(
      { error: "Failed to fetch target blessings", details: String(error) },
      500
    );
  }
});

/**
 * GET /blessings/wallet/:walletAddress
 * Get all blessings performed by a specific wallet
 */
blessings.get("/wallet/:walletAddress", async (c) => {
  try {
    const walletAddress = c.req.param("walletAddress");

    if (!walletAddress) {
      return c.json({ error: "walletAddress is required" }, 400);
    }

    const blessingsByWallet =
      blessingService.getBlessingsByWallet(walletAddress);

    return c.json({
      success: true,
      data: {
        walletAddress,
        blessings: blessingsByWallet,
        count: blessingsByWallet.length,
      },
    });
  } catch (error) {
    console.error("Error fetching wallet blessings:", error);
    return c.json(
      { error: "Failed to fetch wallet blessings", details: String(error) },
      500
    );
  }
});

/**
 * GET /blessings/snapshot
 * Get the current NFT snapshot data
 */
blessings.get("/snapshot", async (c) => {
  try {
    const snapshot = await blessingService.getSnapshot();

    if (!snapshot) {
      return c.json(
        {
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
      { error: "Failed to fetch snapshot", details: String(error) },
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
