# Vercel Deployment Guide

This guide will help you deploy the Abraham API to Vercel.

## Prerequisites

1. A Vercel account (sign up at https://vercel.com)
2. Vercel CLI installed (optional): `npm i -g vercel`
3. Your Privy credentials
4. An Ethereum RPC URL (from Alchemy or Infura)

## Important: Snapshot Considerations

**The NFT snapshot CANNOT be generated on Vercel's serverless functions** due to timeout limitations (10 seconds for Hobby plan, 60 seconds for Pro). You have two options:

### Option 1: Pre-generate Snapshot (Recommended)

Generate the snapshot locally and commit it to your repository:

```bash
# Make sure your .env.local has valid RPC URL
npm run snapshot:generate

# Commit the generated snapshot
git add lib/snapshots/latest.json
git commit -m "Add NFT snapshot"
git push
```

### Option 2: External Snapshot Generation

Set up a separate service (GitHub Actions, cron job, etc.) to generate and upload snapshots periodically.

## Step 1: Set Environment Variables in Vercel

### Via Vercel Dashboard

1. Go to your project on Vercel
2. Navigate to **Settings** → **Environment Variables**
3. Add the following variables:

| Variable Name        | Value                                                                | Environment                      |
| -------------------- | -------------------------------------------------------------------- | -------------------------------- |
| `PRIVY_APP_ID`       | Your Privy App ID                                                    | Production, Preview, Development |
| `PRIVY_APP_SECRET`   | Your Privy App Secret                                                | Production, Preview, Development |
| `CONTRACT_ADDRESS`   | `0x8F814c7C75C5E9e0EDe0336F535604B1915C1985`                         | Production, Preview, Development |
| `FIRSTWORKS_RPC_URL` | Your RPC URL (e.g., `https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY`) | Production, Preview, Development |

**Important:**

- Click "All" for environment selection to apply to all environments
- Never commit `.env.local` or `.env` files with secrets to git

### Via Vercel CLI

```bash
# Set production environment variables
vercel env add PRIVY_APP_ID
vercel env add PRIVY_APP_SECRET
vercel env add CONTRACT_ADDRESS
vercel env add FIRSTWORKS_RPC_URL
```

## Step 2: Create Vercel Configuration

Create a `vercel.json` file in your project root:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "src/server.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "src/server.ts"
    }
  ]
}
```

## Step 3: Deploy to Vercel

### Deploy via GitHub (Recommended)

1. Push your code to GitHub
2. Go to https://vercel.com/new
3. Import your repository
4. Vercel will auto-detect the framework
5. Click **Deploy**

### Deploy via Vercel CLI

```bash
# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

## Step 4: Verify Deployment

After deployment, test your API:

```bash
# Replace YOUR_VERCEL_URL with your actual Vercel URL
curl https://YOUR_VERCEL_URL.vercel.app/

# Test snapshot endpoint
curl https://YOUR_VERCEL_URL.vercel.app/api/blessings/snapshot

# Test with authentication
curl https://YOUR_VERCEL_URL.vercel.app/api/blessings/eligibility \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

## Troubleshooting

### Error: "FIRSTWORKS_RPC_URL is not set"

**Cause:** Environment variables are not set in Vercel dashboard.

**Solution:**

1. Go to Vercel Dashboard → Settings → Environment Variables
2. Add `FIRSTWORKS_RPC_URL` with your Alchemy/Infura URL
3. Redeploy: `vercel --prod` or trigger redeploy in dashboard

### Error: "No snapshot available"

**Cause:** The snapshot file doesn't exist in your deployment.

**Solution:**

1. Generate snapshot locally: `npm run snapshot:generate`
2. Commit the file: `git add lib/snapshots/latest.json && git commit -m "Add snapshot"`
3. Push and redeploy

### Error: Function timeout

**Cause:** Trying to generate snapshot on Vercel (not supported).

**Solution:** Pre-generate snapshot locally or use external service (see Option 1 above).

### CORS Errors from Your Frontend

Update the CORS configuration in [src/index.ts](src/index.ts):

```typescript
app.use(
  "*",
  cors({
    origin: ["https://yourdomain.com", "https://your-frontend.vercel.app"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);
```

## Updating the Snapshot

Since Vercel doesn't support long-running processes, you'll need to update the snapshot externally:

### Option A: GitHub Actions

Create `.github/workflows/update-snapshot.yml`:

```yaml
name: Update NFT Snapshot

on:
  schedule:
    - cron: "0 0 * * *" # Daily at midnight UTC
  workflow_dispatch: # Allow manual trigger

jobs:
  update-snapshot:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: "18"

      - run: npm install

      - name: Generate snapshot
        env:
          CONTRACT_ADDRESS: ${{ secrets.CONTRACT_ADDRESS }}
          FIRSTWORKS_RPC_URL: ${{ secrets.FIRSTWORKS_RPC_URL }}
        run: npm run snapshot:generate

      - name: Commit and push
        run: |
          git config --local user.email "github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"
          git add lib/snapshots/latest.json
          git commit -m "Update NFT snapshot [skip ci]" || exit 0
          git push
```

### Option B: Local Cron Job

If you have a server, set up a cron job:

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 1 AM)
0 1 * * * cd /path/to/abraham-api && npm run snapshot:generate && git add lib/snapshots/latest.json && git commit -m "Update snapshot" && git push
```

## Production Checklist

- [ ] Environment variables set in Vercel
- [ ] Snapshot generated and committed
- [ ] CORS configured for your frontend domain
- [ ] Test all API endpoints after deployment
- [ ] Set up snapshot update mechanism (GitHub Actions or cron)
- [ ] Monitor Vercel logs for errors
- [ ] Consider upgrading to Vercel Pro for longer function timeouts if needed

## Getting Help

- Vercel Documentation: https://vercel.com/docs
- GitHub Issues: [Your repo issues URL]
- Vercel Support: https://vercel.com/support

## Environment Variables Reference

| Variable             | Required | Description                      | Example                                         |
| -------------------- | -------- | -------------------------------- | ----------------------------------------------- |
| `PRIVY_APP_ID`       | Yes      | Privy App ID from dashboard      | `cm3uattds...`                                  |
| `PRIVY_APP_SECRET`   | Yes      | Privy App Secret                 | `2We3ZeBBJ...`                                  |
| `CONTRACT_ADDRESS`   | Yes      | FirstWorks contract address      | `0x8F814c7C75C5E9e0EDe0336F535604B1915C1985`    |
| `FIRSTWORKS_RPC_URL` | Yes      | Ethereum RPC endpoint            | `https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY` |
| `PORT`               | No       | Server port (auto-set by Vercel) | `3000`                                          |
