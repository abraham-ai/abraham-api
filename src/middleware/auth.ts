import { Context, Next } from "hono";
import { PrivyClient } from "@privy-io/server-auth";

// Initialize Privy client
const getPrivyClient = () => {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId) {
    throw new Error("PRIVY_APP_ID is not set");
  }
  if (!appSecret) {
    throw new Error("PRIVY_APP_SECRET is not set");
  }

  return new PrivyClient(appId, appSecret);
};

export interface AuthUser {
  userId: string;
  walletAddress?: string;
}

/**
 * Middleware to verify Privy JWT tokens and authenticate requests
 * Adds user info to context variables
 */
export const withAuth = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid authorization header" }, 401);
    }

    // Extract the token
    const token = authHeader.substring(7);

    // Verify the token with Privy
    const privyClient = getPrivyClient();
    const verifiedClaims = await privyClient.verifyAuthToken(token);

    // Get the user's wallet address from Privy
    const user = await privyClient.getUser(verifiedClaims.userId);
    const wallet = user.linkedAccounts.find(
      (account: { type: string; address?: string }) => account.type === "wallet"
    );

    // Set user info in context
    const authUser: AuthUser = {
      userId: verifiedClaims.userId,
      walletAddress:
        wallet && wallet.type === "wallet" ? wallet.address : undefined,
    };

    c.set("user", authUser);

    await next();
  } catch (error) {
    console.error("Authentication error:", error);
    return c.json({ error: "Invalid or expired authentication token" }, 401);
  }
};

/**
 * Get the authenticated user from the context
 */
export const getAuthUser = (c: Context): AuthUser | undefined => {
  return c.get("user");
};

/**
 * Verify that the authenticated user owns a specific wallet address
 */
export const verifyWalletOwnership = (
  c: Context,
  walletAddress: string
): boolean => {
  const user = getAuthUser(c);

  if (!user || !user.walletAddress) {
    return false;
  }

  return user.walletAddress.toLowerCase() === walletAddress.toLowerCase();
};
