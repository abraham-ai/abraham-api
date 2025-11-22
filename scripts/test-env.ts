#!/usr/bin/env tsx

/**
 * Simple script to test if environment variables are loading correctly
 * Run with: npm run test:env
 */

// Load environment variables in development
if (process.env.NODE_ENV !== "production") {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

console.log("🔍 Testing Environment Variables\n");

const envVars = [
  { name: "PRIVY_APP_ID", required: true },
  { name: "PRIVY_APP_SECRET", required: true },
  { name: "FIRSTWORKS_CONTRACT_ADDRESS", required: true },
  { name: "FIRSTWORKS_RPC_URL", required: true },
  { name: "L2_SEEDS_CONTRACT", required: true },
  { name: "PORT", required: false },
];

let allValid = true;

for (const { name, required } of envVars) {
  const value = process.env[name];
  const status = value ? "✅" : required ? "❌" : "⚠️";
  const requiredText = required ? "(required)" : "(optional)";

  console.log(`${status} ${name} ${requiredText}`);

  if (value) {
    // Mask sensitive values
    if (name.includes("SECRET") || name.includes("RPC")) {
      const masked =
        value.substring(0, 10) + "..." + value.substring(value.length - 4);
      console.log(`   Value: ${masked}`);
    } else {
      console.log(`   Value: ${value}`);
    }

    // Check for placeholder values
    if (value.includes("your_") || value.includes("_here")) {
      console.log(`   ⚠️  WARNING: Still using placeholder value!`);
      if (required) allValid = false;
    }
  } else if (required) {
    console.log(`   ❌ Missing required environment variable`);
    allValid = false;
  }

  console.log("");
}

if (allValid) {
  console.log("✅ All required environment variables are set!");
  console.log("\nYou can now run:");
  console.log("  - npm run snapshot:generate  (to generate NFT snapshot)");
  console.log("  - npm run dev               (to start the API server)");
} else {
  console.log("❌ Some required environment variables are missing or invalid");
  console.log("\nPlease update your .env.local file with valid values.");
  console.log("See .env.example for reference.");
  process.exit(1);
}
