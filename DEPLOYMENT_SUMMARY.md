# Environment Variables & Deployment Summary

## How Environment Variables Work

### Local Development (Your Machine)

- Uses **dotenv** to load variables from `.env.local` and `.env` files
- Variables are loaded conditionally only when `NODE_ENV !== 'production'`
- Files `.env.local` and `.env` are git-ignored for security

### Production (Vercel)

- Uses **native environment variables** set in Vercel dashboard
- No need for `.env` files - Vercel injects variables directly
- `NODE_ENV` is automatically set to `"production"` by Vercel
- dotenv is skipped entirely in production

## Standard Practices We Follow

### 1. Conditional dotenv Loading

```typescript
// Only load .env files in development
if (process.env.NODE_ENV !== "production") {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}
```

**Why:** This is the industry standard. Production platforms (Vercel, AWS, Heroku) provide environment variables natively.

### 2. Dynamic Import

```typescript
const { default: dotenv } = await import("dotenv");
```

**Why:** Avoids importing dotenv in production where it's not needed. Reduces bundle size and prevents errors if dotenv isn't installed.

### 3. Environment Variable Priority

1. `.env.local` (highest priority - local overrides)
2. `.env` (fallback - team defaults)
3. Native process.env (production)

**Why:** Follows Next.js and standard Node.js conventions.

## Files Updated

### ✅ [src/server.ts](src/server.ts)

- Loads dotenv conditionally
- Only in development (not production)

### ✅ [lib/snapshots/firstWorksSnapshot.ts](lib/snapshots/firstWorksSnapshot.ts)

- Loads dotenv conditionally
- Validates env vars only when run as CLI script
- Won't crash server if imported

### ✅ [vercel.json](vercel.json)

- Sets `NODE_ENV=production` explicitly
- Configures Vercel serverless functions

### ✅ [.gitignore](.gitignore)

- Ignores `.env.local` and `.env` (contains secrets)
- Keeps `latest.json` (needed for Vercel deployment)

## Required Environment Variables

All these must be set in Vercel dashboard:

| Variable             | Example                                         | Where to Get                                       |
| -------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `PRIVY_APP_ID`       | `cm3uattds...`                                  | https://dashboard.privy.io                         |
| `PRIVY_APP_SECRET`   | `2We3ZeBBJ...`                                  | https://dashboard.privy.io                         |
| `CONTRACT_ADDRESS`   | `0x8F814c7C75C5E9e0EDe0336F535604B1915C1985`    | Contract address (hardcoded)                       |
| `FIRSTWORKS_RPC_URL` | `https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY` | https://www.alchemy.com/ or https://www.infura.io/ |

## How to Deploy to Vercel

### Step 1: Set Environment Variables

Go to **Vercel Dashboard** → **Your Project** → **Settings** → **Environment Variables**

Add each variable above. Select **"All"** environments (Production, Preview, Development).

### Step 2: Generate and Commit Snapshot

```bash
# Generate snapshot locally
npm run snapshot:generate

# Verify it was created
ls -lh lib/snapshots/latest.json

# Commit it
git add lib/snapshots/latest.json
git commit -m "Add NFT snapshot for Vercel"
git push
```

### Step 3: Deploy

**Via GitHub (Recommended):**

1. Push to GitHub
2. Vercel auto-deploys on push

**Via CLI:**

```bash
vercel --prod
```

### Step 4: Verify

```bash
# Health check
curl https://your-project.vercel.app/

# Get snapshot
curl https://your-project.vercel.app/api/blessings/snapshot

# Test with auth (replace with real token)
curl https://your-project.vercel.app/api/blessings/eligibility \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

## Why This Won't Crash on Vercel

### Problem Before

```typescript
// This would crash on Vercel because dotenv tried to read files that don't exist
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" }); // ❌ File doesn't exist on Vercel
```

### Solution Now

```typescript
// This is safe - dotenv is skipped entirely in production
if (process.env.NODE_ENV !== "production") {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: ".env.local" }); // ✅ Only runs locally
}
```

## Testing Locally

```bash
# Test environment variables
npm run test:env

# Start development server
npm run dev

# Generate snapshot
npm run snapshot:generate
```

## Troubleshooting

### "No snapshot available" on Vercel

**Solution:** Commit `latest.json` to git:

```bash
git add -f lib/snapshots/latest.json
git commit -m "Add snapshot"
git push
```

### "FIRSTWORKS_RPC_URL is not set" on Vercel

**Solution:** Add it in Vercel Dashboard → Settings → Environment Variables

### Server works locally but crashes on Vercel

**Check:**

1. All env vars are set in Vercel dashboard
2. `latest.json` is committed to git
3. Check Vercel deployment logs for specific error

## Best Practices Summary

✅ **DO:**

- Set env vars in Vercel dashboard
- Commit `latest.json` for Vercel deployment
- Use conditional dotenv loading
- Test with `npm run test:env` before deploying

❌ **DON'T:**

- Commit `.env` or `.env.local` files
- Use dotenv in production code paths
- Generate snapshot on Vercel (timeout issues)
- Hardcode secrets in code

## Support

- Vercel Docs: https://vercel.com/docs/environment-variables
- Full deployment guide: [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)
