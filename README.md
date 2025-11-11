# Abraham API

A Hono-based API for managing onchain Seeds (artwork proposals) and NFT-based blessings for the Abraham ecosystem.

## Overview

This API provides:
1. **Seed Creation** - Onchain artwork proposals with authorized creator control
2. **Blessings System** - NFT-based support/likes for Seeds

The system uses:
- **TheSeeds Contract** (Base L2) for onchain seed and blessing storage
- **Privy** for authentication
- **Viem** for Ethereum blockchain interactions
- **Hono** as the lightweight web framework

### Key Features

#### Seed Creation
- ✅ **Onchain Storage**: All seeds stored on TheSeeds contract (Base L2)
- ✅ **Authorized Creators**: Only wallets with CREATOR_ROLE can create seeds
- ✅ **Two Creation Modes**:
  - **Backend-Signed (Gasless)**: API creates seed on behalf of creator (requires admin key)
  - **Client-Signed**: Creator signs transaction directly with their wallet
- ✅ **Access Control**: Role-based permissions using OpenZeppelin AccessControl

#### Blessing System
- ✅ **Onchain Blessings**: All blessings stored on blockchain
- ✅ **NFT-based eligibility**: If you own N FirstWorks NFTs, you get N blessings per day
- ✅ **24-hour blessing period**: Resets at midnight UTC
- ✅ **Delegation Support**: Users can approve backend to bless on their behalf (gasless)
- ✅ **Daily NFT snapshots**: Fast lookup for eligibility

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

   **Generate your admin key:**
   ```bash
   # Generate a secure random admin key
   openssl rand -hex 32

   # Add it to .env.local:
   # ADMIN_KEY=<generated_key_here>
   ```

3. **Generate initial NFT snapshot**
   ```bash
   npm run snapshot:generate
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

The API will be running at `http://localhost:3000`

## Snapshot & Merkle Tree Updates

The Abraham API uses a snapshot of FirstWorks NFT ownership to determine blessing eligibility. This snapshot needs to be updated periodically to reflect current NFT ownership.

### Unified Update Process

We provide a **single command** and **single API endpoint** that performs all three steps automatically:

1. **Generate NFT Snapshot** - Fetches current FirstWorks ownership from Ethereum mainnet
2. **Generate Merkle Tree** - Creates merkle tree with proofs for each holder
3. **Update Contract** - Updates the merkle root on TheSeeds contract (L2)

### Method 1: Via CLI Script

Update everything in one command:

```bash
npm run update-snapshot
```

**Options:**

```bash
# Skip contract update (only generate snapshot + merkle)
SKIP_CONTRACT_UPDATE=true npm run update-snapshot

# Specify network (default: baseSepolia)
NETWORK=base npm run update-snapshot

# Both options together
NETWORK=base SKIP_CONTRACT_UPDATE=true npm run update-snapshot
```

**Environment Variables Required:**

```bash
# For snapshot generation (Ethereum mainnet)
FIRSTWORKS_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
CONTRACT_ADDRESS=0x8F814c7C75C5E9e0EDe0336F535604B1915C1985

# For contract update (Base L2)
RELAYER_PRIVATE_KEY=0x...  # Wallet with admin permissions
CONTRACT_ADDRESS=0x...      # TheSeeds contract on Base
NETWORK=baseSepolia         # or "base" for mainnet
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_MAINNET_RPC=https://mainnet.base.org
```

**Output:**

```
============================================================
STEP 1: Generating FirstWorks NFT Snapshot
============================================================

✓ Getting FirstWorks contract metadata...
✓ Fetching token ownership...
✓ Snapshot generated successfully

============================================================
STEP 2: Generating Merkle Tree
============================================================

✓ Generated 150 leaves
✓ Merkle Root: 0xabc123...
✓ Merkle tree generated successfully

============================================================
STEP 3: Updating Contract Merkle Root
============================================================

✓ Transaction hash: 0xdef456...
✓ Root updated in block 12345678
✓ Contract updated successfully

============================================================
SUMMARY
============================================================
✓ Snapshot Generated: ./lib/snapshots/snapshot-1234567890.json
✓ Merkle Tree Generated: ./lib/snapshots/firstWorks_merkle.json
✓ Merkle Root: 0xabc123...
✓ Contract Updated: 0xdef456...
✓ Block Number: 12345678

✓ ALL STEPS COMPLETED SUCCESSFULLY!
```

---

### Method 2: Via API Endpoint

> ⚡ **FAST**: Snapshot generation completes in ~10-30 seconds using Alchemy's NFT API!
>
> **Requirements:**
> - Alchemy RPC URL (includes NFT API access - free tier available)
> - Set `FIRSTWORKS_RPC_URL` to your Alchemy endpoint
>
> **Fallback**: If not using Alchemy, falls back to slower RPC calls (may timeout on Vercel)

**Endpoint:** `POST /api/admin/update-snapshot`

**Authentication:**
- Admin key only (via `X-Admin-Key` header)
- **No Privy authentication required** for admin endpoints

**Generating Your Admin Key:**

The admin key is a secret you create yourself. Generate a strong random key:

```bash
# Using OpenSSL (recommended)
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Example output:
# a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

Add it to your `.env.local`:

```bash
ADMIN_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

**Request:**

```bash
curl -X POST http://localhost:3000/api/admin/update-snapshot \
  -H "X-Admin-Key: your-secret-admin-key"
```

**Query Parameters:**

- `skipContract` (optional) - Set to `true` to skip contract update

```bash
# Skip contract update
curl -X POST "http://localhost:3000/api/admin/update-snapshot?skipContract=true" \
  -H "X-Admin-Key: your-secret-admin-key"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "snapshotPath": "./lib/snapshots/snapshot-1234567890.json",
    "merklePath": "./lib/snapshots/firstWorks_merkle.json",
    "merkleRoot": "0xabc123...",
    "txHash": "0xdef456...",
    "blockNumber": "12345678",
    "steps": {
      "snapshot": true,
      "merkle": true,
      "contract": true
    },
    "timestamp": "2025-10-24T15:30:00.000Z"
  }
}
```

**TypeScript/JavaScript Example:**

```typescript
async function updateSnapshot() {
  const response = await fetch('http://localhost:3000/api/admin/update-snapshot', {
    method: 'POST',
    headers: {
      'X-Admin-Key': process.env.ADMIN_KEY  // Only admin key needed
    }
  });

  const result = await response.json();

  if (result.success) {
    console.log('Snapshot updated!');
    console.log('Merkle Root:', result.data.merkleRoot);
    console.log('TX Hash:', result.data.txHash);
  } else {
    console.error('Update failed:', result.error);
  }
}

// Skip contract update (only generate snapshot + merkle)
async function updateSnapshotOnly() {
  const response = await fetch('http://localhost:3000/api/admin/update-snapshot?skipContract=true', {
    method: 'POST',
    headers: {
      'X-Admin-Key': process.env.ADMIN_KEY
    }
  });

  const result = await response.json();
  // ...
}
```

---

### Production Workflow (Optional - For Non-Alchemy RPC)

If you're NOT using Alchemy (which provides fast NFT API), you may need this workflow:

#### Step 1: Generate Snapshot Locally

```bash
# Run the unified update script
npm run update-snapshot
```

This will:
- Fetch FirstWorks NFT ownership from Ethereum mainnet
- Generate merkle tree with proofs
- Update merkle root on TheSeeds contract (L2)
- Save to `lib/snapshots/latest.json` and `lib/snapshots/firstWorks_merkle.json`

#### Step 2: Commit and Push

```bash
# Add the updated snapshot files
git add lib/snapshots/latest.json lib/snapshots/firstWorks_merkle.json

# Commit
git commit -m "chore: update FirstWorks NFT snapshot"

# Push to GitHub
git push
```

#### Step 3: Vercel Auto-Deploys

Vercel will automatically:
1. Detect the git push
2. Trigger a new deployment
3. Include the updated snapshot files
4. Deploy the new version

#### Alternative: GitHub Actions (Optional)

You can automate this with a GitHub Action that runs on a schedule:

```yaml
# .github/workflows/update-snapshot.yml
name: Update NFT Snapshot

on:
  schedule:
    # Run daily at midnight UTC
    - cron: '0 0 * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  update-snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Update snapshot
        env:
          FIRSTWORKS_RPC_URL: ${{ secrets.FIRSTWORKS_RPC_URL }}
          L2_SEEDS_CONTRACT: ${{ secrets.L2_SEEDS_CONTRACT }}
          DEPLOYER_PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}
          BASE_SEPOLIA_RPC_URL: ${{ secrets.BASE_SEPOLIA_RPC_URL }}
        run: npm run update-snapshot

      - name: Commit and push
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add lib/snapshots/latest.json lib/snapshots/firstWorks_merkle.json
          git commit -m "chore: automated NFT snapshot update" || exit 0
          git push
```

---

### Additional Admin Endpoints

#### Check Snapshot Status

**Endpoint:** `GET /api/admin/snapshot-status`

**Authentication:** None required (public info)

```bash
curl http://localhost:3000/api/admin/snapshot-status
```

**Response:**

```json
{
  "success": true,
  "data": {
    "snapshotExists": true,
    "merkleExists": true,
    "snapshot": {
      "totalHolders": 150,
      "totalSupply": 500,
      "timestamp": "2025-10-24T12:00:00.000Z",
      "blockNumber": 18500000,
      "contractAddress": "0x8F814c7C75C5E9e0EDe0336F535604B1915C1985"
    },
    "merkle": {
      "root": "0xabc123...",
      "totalLeaves": 150,
      "totalProofs": 150
    }
  }
}
```

#### Reload Snapshot (Cache Refresh)

**Endpoint:** `POST /api/admin/reload-snapshot`

**Authentication:** Admin key only (no Privy token required)

Reloads the in-memory snapshot cache without regenerating or updating contract.

```bash
curl -X POST http://localhost:3000/api/admin/reload-snapshot \
  -H "X-Admin-Key: your-secret-admin-key"
```

---

### When to Update Snapshots

**Recommended Schedule:**

- **Daily** - Automated cron job during low-traffic hours
- **After major events** - Large NFT transfers, minting events
- **Before voting rounds** - Ensure accurate eligibility data

**Automation Example (Cron):**

```bash
# Add to crontab (runs daily at 3 AM)
0 3 * * * cd /path/to/abraham-api && npm run update-snapshot >> logs/snapshot-update.log 2>&1
```

**Serverless Function (Vercel Cron):**

```typescript
// api/cron/update-snapshot.ts
import { updateSnapshotAndMerkle } from '../../scripts/updateSnapshot';

export default async function handler(req: Request) {
  // Verify Vercel cron secret (automatically added by Vercel)
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await updateSnapshotAndMerkle();
    return Response.json({ success: true, data: result });
  } catch (error) {
    return Response.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// vercel.json
{
  "crons": [{
    "path": "/api/cron/update-snapshot",
    "schedule": "0 3 * * *"  // Daily at 3 AM
  }]
}
```

**Note**: Vercel automatically adds a `CRON_SECRET` to your environment and includes it in the `Authorization` header for cron requests. This is different from your `ADMIN_KEY` and is managed by Vercel.

---

## Seed Creation Setup

### Prerequisites
1. Deploy TheSeeds contract to Base Sepolia or Base Mainnet
2. Configure environment variables (see below)
3. Grant CREATOR_ROLE to authorized wallets

### Environment Variables

Add these to your `.env.local` file:

```bash
# Required for backend-signed seed creation
RELAYER_PRIVATE_KEY=0x...        # Private key for backend wallet (must have CREATOR_ROLE)
CONTRACT_ADDRESS=0x...           # TheSeeds contract address
NETWORK=baseSepolia              # or "base" for mainnet
ADMIN_KEY=your-secret-admin-key  # Secret key for admin endpoints

# RPC URLs
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_MAINNET_RPC=https://mainnet.base.org

# Privy (for authentication)
PRIVY_APP_ID=your-privy-app-id
PRIVY_APP_SECRET=your-privy-app-secret
```

### Granting CREATOR_ROLE

There are two ways to authorize seed creators:

#### Option 1: Using Hardhat Console

```bash
npx hardhat console --network baseSepolia
```

```javascript
const TheSeeds = await ethers.getContractAt("TheSeeds", "YOUR_CONTRACT_ADDRESS");

// Grant CREATOR_ROLE to a wallet
await TheSeeds.addCreator("0x_CREATOR_WALLET_ADDRESS");

// Verify the role was granted
const CREATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CREATOR_ROLE"));
const hasRole = await TheSeeds.hasRole(CREATOR_ROLE, "0x_CREATOR_WALLET_ADDRESS");
console.log("Has CREATOR_ROLE:", hasRole);
```

#### Option 2: Using Cast (Foundry)

```bash
# Grant CREATOR_ROLE to a wallet
cast send YOUR_CONTRACT_ADDRESS \
  "addCreator(address)" \
  0x_CREATOR_WALLET_ADDRESS \
  --rpc-url https://sepolia.base.org \
  --private-key YOUR_ADMIN_PRIVATE_KEY

# Verify the role
cast call YOUR_CONTRACT_ADDRESS \
  "hasRole(bytes32,address)(bool)" \
  0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7 \
  0x_CREATOR_WALLET_ADDRESS \
  --rpc-url https://sepolia.base.org
```

**Note**: `0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7` is `keccak256("CREATOR_ROLE")`

### Seed Creation Modes

#### 1. Backend-Signed (Gasless) Mode

**When to use**: When you want the backend to pay gas fees and control seed creation via admin authentication.

**Requirements**:
- Backend wallet must have CREATOR_ROLE on the contract
- Request must include `X-Admin-Key` header
- `ADMIN_KEY` environment variable must be set

**Example**:
```bash
curl -X POST http://localhost:3000/api/seeds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "X-Admin-Key: your-secret-admin-key" \
  -d '{
    "ipfsHash": "QmX...",
    "title": "My Seed Title",
    "description": "Seed description"
  }'
```

#### 2. Client-Signed Mode

**When to use**: When you want creators to sign transactions with their own wallets and pay their own gas.

**Requirements**:
- Creator wallet must have CREATOR_ROLE on the contract
- User must sign the transaction with their wallet (e.g., via wagmi/viem)

**Example**:
```typescript
// 1. Request transaction data from API
const response = await fetch('/api/seeds/prepare', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${privyToken}`
  },
  body: JSON.stringify({
    ipfsHash: 'QmX...',
    title: 'My Seed',
    description: 'Description'
  })
});

const { transaction } = await response.json();

// 2. Sign and send transaction with user's wallet
import { useWalletClient } from 'wagmi';

const { data: walletClient } = useWalletClient();
const hash = await walletClient.sendTransaction({
  to: transaction.to,
  data: transaction.data,
});
```

---

## How to Create Seeds Onchain

This guide covers all the ways you can create seeds onchain, from backend-signed transactions to direct contract interactions.

### Understanding Seed Creation

Seeds are artwork proposals stored onchain in TheSeeds contract. Only wallets with **CREATOR_ROLE** can create seeds. There are multiple ways to create seeds depending on your use case:

| Method | Who Pays Gas | Best For | Requires Admin Key |
|--------|--------------|----------|-------------------|
| Backend-Signed (API) | Backend | Curated submissions, gasless UX | Yes |
| Client-Signed (API + Wallet) | User | Self-service creators | No |
| Hardhat Console | You | Development, testing, admin tasks | No |
| Cast (Foundry) | You | CLI workflows, scripts | No |
| Basescan UI | You | One-off manual creation | No |

### Method 1: Backend-Signed (Gasless via API)

**Use Case**: Backend creates seeds on behalf of creators, paying gas fees. Good for curated submissions or when you want to provide a gasless experience.

**Prerequisites**:
- Backend wallet has CREATOR_ROLE
- `RELAYER_PRIVATE_KEY` set in `.env.local`
- `ADMIN_KEY` set in `.env.local`
- Privy authentication setup

**Step-by-Step**:

1. **Get authenticated with Privy**:
```typescript
import { usePrivy } from '@privy-io/react-auth';

const { getAccessToken } = usePrivy();
const token = await getAccessToken();
```

2. **Call the API endpoint with admin key**:
```typescript
const response = await fetch('http://localhost:3000/api/seeds', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Admin-Key': 'your-secret-admin-key'  // From .env.local
  },
  body: JSON.stringify({
    ipfsHash: 'QmX123...',
    title: 'My Artwork Title',
    description: 'Description of the artwork'
  })
});

const result = await response.json();
console.log('Seed created:', result.data.seedId);
console.log('Transaction:', result.data.txHash);
```

3. **Handle the response**:
```typescript
if (result.success) {
  // Seed created successfully
  const seedId = result.data.seedId;
  const txHash = result.data.txHash;
  const blockExplorer = result.data.blockExplorer;

  // Show success message to user
  alert(`Seed #${seedId} created! View on Basescan: ${blockExplorer}`);
} else {
  // Handle errors
  console.error('Error:', result.error);
}
```

**Common Errors**:
- `401 Unauthorized - Invalid admin key` → Check `X-Admin-Key` matches `ADMIN_KEY` in `.env.local`
- `403 Relayer does not have CREATOR_ROLE` → Grant CREATOR_ROLE to backend wallet
- `503 Backend blessing service not configured` → Add `RELAYER_PRIVATE_KEY` to `.env.local`

---

### Method 2: Client-Signed (User's Wallet via API)

**Use Case**: Creators sign transactions with their own wallets and pay their own gas. Good for self-service creator platforms.

**Prerequisites**:
- Creator wallet has CREATOR_ROLE (granted by admin)
- User has a connected wallet (via wagmi, viem, or Privy embedded wallet)
- Privy authentication setup

**Step-by-Step**:

1. **Prepare the transaction via API**:
```typescript
import { usePrivy } from '@privy-io/react-auth';
import { useWalletClient } from 'wagmi';

async function createSeed(ipfsHash: string, title: string, description: string) {
  // 1. Get Privy token
  const { getAccessToken } = usePrivy();
  const token = await getAccessToken();

  // 2. Request transaction data from API
  const response = await fetch('http://localhost:3000/api/seeds/prepare', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ ipfsHash, title, description })
  });

  const { data } = await response.json();

  // 3. Check if user has CREATOR_ROLE
  if (!data.hasCreatorRole) {
    alert('You need CREATOR_ROLE to create seeds. Contact an admin.');
    return;
  }

  // 4. Sign and send transaction with user's wallet
  const { data: walletClient } = useWalletClient();
  const hash = await walletClient.sendTransaction({
    to: data.transaction.to,
    data: data.transaction.data,
  });

  console.log('Seed creation transaction sent:', hash);

  // 5. Wait for confirmation (optional)
  import { waitForTransactionReceipt } from 'viem';
  const receipt = await waitForTransactionReceipt(walletClient, { hash });
  console.log('Seed created in block:', receipt.blockNumber);
}
```

2. **Complete React Component Example**:
```typescript
import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWalletClient } from 'wagmi';

function CreateSeedForm() {
  const { getAccessToken, authenticated } = usePrivy();
  const { data: walletClient } = useWalletClient();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const ipfsHash = formData.get('ipfsHash') as string;
      const title = formData.get('title') as string;
      const description = formData.get('description') as string;

      // Get transaction data
      const token = await getAccessToken();
      const response = await fetch('/api/seeds/prepare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ ipfsHash, title, description })
      });

      const { data } = await response.json();

      if (!data.hasCreatorRole) {
        alert('You need CREATOR_ROLE to create seeds');
        return;
      }

      // Sign with user's wallet
      const hash = await walletClient.sendTransaction({
        to: data.transaction.to,
        data: data.transaction.data,
      });

      alert(`Seed created! Transaction: ${hash}`);
    } catch (error) {
      console.error('Error creating seed:', error);
      alert('Failed to create seed');
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) {
    return <div>Please log in to create seeds</div>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        name="ipfsHash"
        placeholder="IPFS Hash (QmX...)"
        required
      />
      <input
        name="title"
        placeholder="Seed Title"
        required
      />
      <textarea
        name="description"
        placeholder="Description (optional)"
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Seed'}
      </button>
    </form>
  );
}
```

**Common Errors**:
- `hasCreatorRole: false` → User needs CREATOR_ROLE granted by admin
- Wallet rejects transaction → User needs gas (ETH) on Base network
- `AccessControl: account is missing role` → Wallet address doesn't have CREATOR_ROLE

---

### Method 3: Direct Contract Interaction (Hardhat Console)

**Use Case**: Development, testing, or admin tasks. Good for granting roles and creating test seeds.

**Prerequisites**:
- Hardhat installed (`npm install --save-dev hardhat`)
- Wallet with CREATOR_ROLE
- `PRIVATE_KEY` in `.env.local`

**Step-by-Step**:

1. **Open Hardhat console**:
```bash
npx hardhat console --network baseSepolia
```

2. **Get contract instance**:
```javascript
const TheSeeds = await ethers.getContractAt(
  "TheSeeds",
  "0x878baad70577cf114a3c60fd01b5a036fd0c4bc8"  // Your contract address
);
```

3. **Check if you have CREATOR_ROLE**:
```javascript
const [signer] = await ethers.getSigners();
const myAddress = await signer.getAddress();
console.log("My address:", myAddress);

const CREATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CREATOR_ROLE"));
const hasRole = await TheSeeds.hasRole(CREATOR_ROLE, myAddress);
console.log("Has CREATOR_ROLE:", hasRole);
```

4. **Create a seed**:
```javascript
const tx = await TheSeeds.submitSeed(
  "QmX123...",           // IPFS hash
  "My Artwork",         // Title
  "Description here"    // Description
);

console.log("Transaction hash:", tx.hash);
await tx.wait();
console.log("Seed created!");

// Get the seed ID from events
const receipt = await tx.wait();
const event = receipt.events.find(e => e.event === 'SeedSubmitted');
const seedId = event.args.seedId.toNumber();
console.log("Seed ID:", seedId);
```

5. **Verify the seed**:
```javascript
const seed = await TheSeeds.getSeed(seedId);
console.log("Title:", seed.title);
console.log("Creator:", seed.creator);
console.log("IPFS Hash:", seed.ipfsHash);
```

---

### Method 4: Direct Contract Interaction (Cast/Foundry)

**Use Case**: CLI workflows, automation scripts, CI/CD pipelines.

**Prerequisites**:
- Foundry installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- Wallet with CREATOR_ROLE
- Private key or keystore

**Step-by-Step**:

1. **Set environment variables**:
```bash
export CONTRACT=0x878baad70577cf114a3c60fd01b5a036fd0c4bc8
export RPC_URL=https://sepolia.base.org
export PRIVATE_KEY=0x...  # Your private key
```

2. **Check if you have CREATOR_ROLE**:
```bash
# CREATOR_ROLE hash
CREATOR_ROLE=0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7

# Your wallet address
YOUR_ADDRESS=0x...

# Check role
cast call $CONTRACT \
  "hasRole(bytes32,address)(bool)" \
  $CREATOR_ROLE \
  $YOUR_ADDRESS \
  --rpc-url $RPC_URL

# Should return: true
```

3. **Create a seed**:
```bash
cast send $CONTRACT \
  "submitSeed(string,string,string)" \
  "QmX123..." \
  "My Artwork Title" \
  "Description of the artwork" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

4. **Get transaction receipt**:
```bash
# The command will output a transaction hash
# View on Basescan:
# https://sepolia.basescan.org/tx/0x...
```

5. **Query the seed** (get latest seed ID first):
```bash
# Get total seed count
cast call $CONTRACT "getSeedCount()(uint256)" --rpc-url $RPC_URL

# Get seed details (e.g., seed ID 0)
cast call $CONTRACT \
  "getSeed(uint256)" \
  0 \
  --rpc-url $RPC_URL
```

**Automation Script Example**:
```bash
#!/bin/bash
# create-seed.sh - Batch create seeds from a JSON file

CONTRACT=0x878baad70577cf114a3c60fd01b5a036fd0c4bc8
RPC_URL=https://sepolia.base.org

# Read seeds from JSON file
cat seeds.json | jq -c '.[]' | while read seed; do
  IPFS=$(echo $seed | jq -r '.ipfsHash')
  TITLE=$(echo $seed | jq -r '.title')
  DESC=$(echo $seed | jq -r '.description')

  echo "Creating seed: $TITLE"

  cast send $CONTRACT \
    "submitSeed(string,string,string)" \
    "$IPFS" "$TITLE" "$DESC" \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY

  sleep 2  # Rate limiting
done
```

---

### Method 5: Direct Contract Interaction (Basescan UI)

**Use Case**: One-off manual seed creation, no code required.

**Prerequisites**:
- Wallet with CREATOR_ROLE (MetaMask, WalletConnect, etc.)
- Contract verified on Basescan

**Step-by-Step**:

1. **Navigate to contract on Basescan**:
   - Testnet: `https://sepolia.basescan.org/address/0x878baad...`
   - Mainnet: `https://basescan.org/address/0x878baad...`

2. **Go to "Contract" tab → "Write Contract"**

3. **Click "Connect to Web3"** and connect your wallet

4. **Find the `submitSeed` function**

5. **Fill in the parameters**:
   - `_ipfsHash`: `QmX123...`
   - `_title`: `My Artwork Title`
   - `_description`: `Description of the artwork`

6. **Click "Write"** and confirm transaction in your wallet

7. **View transaction** and get seed ID from logs

---

### Choosing the Right Method

**Decision Tree**:

```
Do you want gasless UX for users?
├─ YES → Use Method 1 (Backend-Signed API)
│         Requires: Admin key, backend with CREATOR_ROLE
│
└─ NO → Do users have their own wallets?
    ├─ YES → Use Method 2 (Client-Signed API)
    │         Requires: User has CREATOR_ROLE, wallet connected
    │
    └─ NO → Are you doing development/testing?
        ├─ YES → Use Method 3 (Hardhat Console)
        │         Good for: Interactive testing, debugging
        │
        └─ NO → Do you need automation/scripting?
            ├─ YES → Use Method 4 (Cast/Foundry)
            │         Good for: CI/CD, batch operations
            │
            └─ NO → Use Method 5 (Basescan UI)
                      Good for: One-off manual creation
```

---

### Troubleshooting Common Issues

#### "Relayer does not have CREATOR_ROLE"

**Cause**: Backend wallet doesn't have CREATOR_ROLE on the contract

**Solution**: Grant CREATOR_ROLE to backend wallet
```bash
npx hardhat console --network baseSepolia
```
```javascript
const TheSeeds = await ethers.getContractAt("TheSeeds", CONTRACT_ADDRESS);
await TheSeeds.addCreator(BACKEND_WALLET_ADDRESS);
```

#### "You don't have CREATOR_ROLE" (Client-Signed)

**Cause**: User's wallet doesn't have CREATOR_ROLE

**Solution**: Admin must grant CREATOR_ROLE to user's wallet
```bash
cast send CONTRACT_ADDRESS \
  "addCreator(address)" \
  USER_WALLET_ADDRESS \
  --rpc-url RPC_URL \
  --private-key ADMIN_PRIVATE_KEY
```

#### "Unauthorized - Invalid admin key"

**Cause**: `X-Admin-Key` header doesn't match `ADMIN_KEY` in `.env.local`

**Solution**: Check your environment variable:
```bash
# .env.local
ADMIN_KEY=your-secret-admin-key  # Must match header
```

#### "Backend blessing service not configured"

**Cause**: `RELAYER_PRIVATE_KEY` not set in `.env.local`

**Solution**: Add backend wallet private key:
```bash
# .env.local
RELAYER_PRIVATE_KEY=0x...  # Backend wallet private key
```

#### Transaction fails with no specific error

**Cause**: Insufficient gas, network issues, or contract paused

**Solution**:
1. Check wallet has enough ETH for gas
2. Verify network is correct (Base Sepolia vs Base Mainnet)
3. Check if contract is paused:
```bash
cast call CONTRACT_ADDRESS "paused()(bool)" --rpc-url RPC_URL
```

---

### Complete Example: Seed Creation Flow

Here's a complete example showing how to create a seed with proper error handling:

```typescript
import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWalletClient } from 'wagmi';

interface SeedFormData {
  ipfsHash: string;
  title: string;
  description?: string;
}

export function CreateSeedFlow() {
  const { getAccessToken, authenticated } = usePrivy();
  const { data: walletClient } = useWalletClient();
  const [mode, setMode] = useState<'backend' | 'client'>('client');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function createSeed(data: SeedFormData) {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getAccessToken();

      if (mode === 'backend') {
        // Backend-signed (gasless)
        const response = await fetch('/api/seeds', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Admin-Key': process.env.NEXT_PUBLIC_ADMIN_KEY || ''
          },
          body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
          setSuccess(`Seed #${result.data.seedId} created! TX: ${result.data.txHash}`);
        } else {
          setError(result.error);
        }
      } else {
        // Client-signed
        const response = await fetch('/api/seeds/prepare', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!result.data.hasCreatorRole) {
          setError('You need CREATOR_ROLE to create seeds. Contact an admin.');
          return;
        }

        // Sign with user's wallet
        const hash = await walletClient.sendTransaction({
          to: result.data.transaction.to,
          data: result.data.transaction.data,
        });

        setSuccess(`Seed created! Transaction: ${hash}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create seed');
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) {
    return <div>Please log in to create seeds</div>;
  }

  return (
    <div>
      <h2>Create Seed</h2>

      {/* Mode selector */}
      <div>
        <label>
          <input
            type="radio"
            checked={mode === 'client'}
            onChange={() => setMode('client')}
          />
          Sign with my wallet (I pay gas)
        </label>
        <label>
          <input
            type="radio"
            checked={mode === 'backend'}
            onChange={() => setMode('backend')}
          />
          Gasless (requires admin key)
        </label>
      </div>

      {/* Form */}
      <form onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        createSeed({
          ipfsHash: formData.get('ipfsHash') as string,
          title: formData.get('title') as string,
          description: formData.get('description') as string || undefined,
        });
      }}>
        <input
          name="ipfsHash"
          placeholder="IPFS Hash (QmX...)"
          required
        />
        <input
          name="title"
          placeholder="Seed Title"
          required
        />
        <textarea
          name="description"
          placeholder="Description (optional)"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Seed'}
        </button>
      </form>

      {/* Status messages */}
      {error && <div style={{ color: 'red' }}>Error: {error}</div>}
      {success && <div style={{ color: 'green' }}>{success}</div>}
    </div>
  );
}
```

---

## Documentation

For detailed setup instructions, API documentation, and deployment guides, see:
- [Quick Start Deployment](./docs/QUICK_START_DEPLOYMENT.md) - 5-step quick start
- [Full Deployment Guide](./docs/DEPLOYMENT_GUIDE.md) - Complete deployment and role setup
- [Seed Creation System](./docs/SEED_CREATION_SYSTEM.md) - Architecture and integration
- [Blessing System](./docs/BLESSING_SYSTEM.md) - Blessing mechanics

## API Endpoints

All blessing endpoints require Privy authentication via Bearer token in the `Authorization` header.

### 1. Health Check

**Endpoint:** `GET /`

**Description:** Check API status and view available endpoints

**Authentication:** None required

**cURL Example:**
```bash
curl http://localhost:3000
```

**Response:**
```json
{
  "name": "Abraham API",
  "version": "1.0.0",
  "status": "healthy",
  "endpoints": {
    "blessings": "/api/blessings",
    "eligibility": "/api/blessings/eligibility",
    "stats": "/api/blessings/stats"
  }
}
```

---

## Seed Endpoints

### 2. Create Seed (Backend-Signed)

**Endpoint:** `POST /api/seeds`

**Description:** Create a new seed onchain with backend-signed transaction (gasless for user)

**Authentication:**
- Privy JWT token (via `Authorization` header)
- Admin key (via `X-Admin-Key` header)

**Request Body:**
```json
{
  "ipfsHash": "QmX...",           // Required: IPFS hash of artwork
  "title": "Seed Title",          // Required: Title of the seed
  "description": "Description"    // Optional: Seed description
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/seeds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -H "X-Admin-Key: your-secret-admin-key" \
  -d '{
    "ipfsHash": "QmX123...",
    "title": "My First Seed",
    "description": "A beautiful artwork"
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "seedId": 0,
    "txHash": "0xabc123...",
    "blockExplorer": "https://sepolia.basescan.org/tx/0xabc123...",
    "seed": {
      "id": 0,
      "creator": "0x...",
      "ipfsHash": "QmX123...",
      "title": "My First Seed",
      "description": "A beautiful artwork",
      "votes": 0,
      "blessings": 0,
      "createdAt": 1729785600,
      "minted": false
    }
  }
}
```

**Error Responses:**
```json
// 401 - Invalid admin key
{ "success": false, "error": "Unauthorized - Invalid admin key" }

// 403 - Backend doesn't have CREATOR_ROLE
{ "success": false, "error": "Relayer does not have CREATOR_ROLE" }

// 503 - Backend not configured
{ "success": false, "error": "Backend blessing service not configured" }
```

---

### 3. Prepare Seed Creation (Client-Signed)

**Endpoint:** `POST /api/seeds/prepare`

**Description:** Prepare seed creation transaction for client-side signing

**Authentication:** Privy JWT token (via `Authorization` header)

**Request Body:**
```json
{
  "ipfsHash": "QmX...",           // Required
  "title": "Seed Title",          // Required
  "description": "Description"    // Optional
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/seeds/prepare \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -d '{
    "ipfsHash": "QmX123...",
    "title": "My Seed",
    "description": "Description"
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "to": "0x878baad70577cf114a3c60fd01b5a036fd0c4bc8",
      "data": "0x...",
      "from": "0x...",
      "chainId": 84532
    },
    "hasCreatorRole": true,
    "userAddress": "0x...",
    "instructions": {
      "step1": "Send this transaction using your wallet",
      "step2": "Wait for transaction confirmation",
      "step3": "Your seed will be created on-chain",
      "note": "You have CREATOR_ROLE and can create seeds"
    }
  }
}
```

**Usage Example (with wagmi):**
```typescript
import { useWalletClient } from 'wagmi';

async function createSeed(ipfsHash: string, title: string, description: string) {
  // 1. Get transaction data from API
  const response = await fetch('/api/seeds/prepare', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${await getAccessToken()}`
    },
    body: JSON.stringify({ ipfsHash, title, description })
  });

  const { data } = await response.json();

  if (!data.hasCreatorRole) {
    alert('You need CREATOR_ROLE to create seeds');
    return;
  }

  // 2. Sign and send with user's wallet
  const { data: walletClient } = useWalletClient();
  const hash = await walletClient.sendTransaction({
    to: data.transaction.to,
    data: data.transaction.data,
  });

  console.log('Seed created:', hash);
}
```

---

### 4. Get Seed Details

**Endpoint:** `GET /api/seeds/:seedId`

**Description:** Get details of a specific seed from the blockchain

**Authentication:** None required

**cURL Example:**
```bash
curl http://localhost:3000/api/seeds/0
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 0,
    "creator": "0x...",
    "ipfsHash": "QmX123...",
    "title": "My First Seed",
    "description": "A beautiful artwork",
    "votes": 5,
    "blessings": 10,
    "createdAt": 1729785600,
    "minted": false,
    "mintedInRound": 0
  }
}
```

---

### 5. Get Seed Count

**Endpoint:** `GET /api/seeds/count`

**Description:** Get total number of seeds created

**Authentication:** None required

**cURL Example:**
```bash
curl http://localhost:3000/api/seeds/count
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "count": 42
  }
}
```

---

### 6. Check Creator Role

**Endpoint:** `GET /api/seeds/creator/:address/check`

**Description:** Check if a wallet address has CREATOR_ROLE

**Authentication:** None required

**cURL Example:**
```bash
curl http://localhost:3000/api/seeds/creator/0x1234.../check
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "address": "0x1234...",
    "hasCreatorRole": true
  }
}
```

---

## Blessing Endpoints

### 7. Check Blessing Eligibility

**Endpoint:** `GET /api/blessings/eligibility`

**Description:** Check if the authenticated user is eligible to perform blessings

**Authentication:** Required (Privy JWT token)

**cURL Example:**
```bash
curl http://localhost:3000/api/blessings/eligibility \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**JavaScript/TypeScript Example:**
```typescript
import { usePrivy } from '@privy-io/react-auth';

const { getAccessToken } = usePrivy();

async function checkEligibility() {
  const token = await getAccessToken();

  const response = await fetch('http://localhost:3000/api/blessings/eligibility', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  console.log(data);
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "eligible": true,
    "nftCount": 5,
    "maxBlessings": 5,
    "usedBlessings": 2,
    "remainingBlessings": 3,
    "periodEnd": "2025-10-25T00:00:00.000Z",
    "reason": null
  }
}
```

**Not Eligible Response (200):**
```json
{
  "success": true,
  "data": {
    "eligible": false,
    "nftCount": 0,
    "maxBlessings": 0,
    "usedBlessings": 0,
    "remainingBlessings": 0,
    "periodEnd": "2025-10-25T00:00:00.000Z",
    "reason": "No NFTs owned"
  }
}
```

---

### 3. Get Blessing Statistics

**Endpoint:** `GET /api/blessings/stats`

**Description:** Get detailed blessing statistics for the authenticated user

**Authentication:** Required (Privy JWT token)

**cURL Example:**
```bash
curl http://localhost:3000/api/blessings/stats \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"
```

**JavaScript/TypeScript Example:**
```typescript
import { usePrivy } from '@privy-io/react-auth';

const { getAccessToken } = usePrivy();

async function getBlessingStats() {
  const token = await getAccessToken();

  const response = await fetch('http://localhost:3000/api/blessings/stats', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  console.log(data);
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "nftCount": 5,
    "maxBlessings": 5,
    "usedBlessings": 2,
    "remainingBlessings": 3,
    "periodStart": "2025-10-24T00:00:00.000Z",
    "periodEnd": "2025-10-25T00:00:00.000Z"
  }
}
```

---

### 4. Perform a Blessing

**Endpoint:** `POST /api/blessings`

**Description:** Perform a blessing on a target item (e.g., post, content, etc.)

**Authentication:** Required (Privy JWT token)

**Request Body:**
```json
{
  "targetId": "string"  // Required: ID of the item being blessed
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/blessings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -d '{"targetId": "post_123"}'
```

**JavaScript/TypeScript Example:**
```typescript
import { usePrivy } from '@privy-io/react-auth';

const { getAccessToken } = usePrivy();

async function performBlessing(targetId: string) {
  const token = await getAccessToken();

  const response = await fetch('http://localhost:3000/api/blessings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ targetId })
  });

  const data = await response.json();

  if (data.success) {
    console.log(`Blessed! ${data.data.remainingBlessings} blessings left`);
  } else {
    console.error(`Error: ${data.error}`);
  }
}

// Usage
performBlessing('post_123');
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "targetId": "post_123",
    "remainingBlessings": 2,
    "message": "Blessing performed successfully",
    "blessing": {
      "id": "blessing_1729785600000_abc123",
      "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
      "targetId": "post_123",
      "timestamp": "2025-10-24T15:30:00.000Z",
      "nftCount": 5
    }
  }
}
```

**Error Response - No Blessings Remaining (403):**
```json
{
  "success": false,
  "error": "All blessings used for this period",
  "remainingBlessings": 0
}
```

**Error Response - Missing targetId (400):**
```json
{
  "error": "targetId is required"
}
```

---

### 5. Get All Blessings

**Endpoint:** `GET /api/blessings/all`

**Description:** Get all blessing records with optional filters and pagination

**Authentication:** None required (public endpoint)

**Query Parameters:**
- `walletAddress` (optional) - Filter by wallet address
- `targetId` (optional) - Filter by target ID
- `limit` (optional) - Number of results per page (default: 50)
- `offset` (optional) - Pagination offset (default: 0)
- `sortOrder` (optional) - "asc" or "desc" (default: "desc" - most recent first)

**cURL Examples:**

Get all blessings (default 50 most recent):
```bash
curl http://localhost:3000/api/blessings/all
```

Get blessings for a specific wallet:
```bash
curl "http://localhost:3000/api/blessings/all?walletAddress=0x1234..."
```

Get blessings for a specific target:
```bash
curl "http://localhost:3000/api/blessings/all?targetId=post_123"
```

Get with pagination:
```bash
curl "http://localhost:3000/api/blessings/all?limit=10&offset=0"
```

**JavaScript/TypeScript Example:**
```typescript
async function getAllBlessings(options?: {
  walletAddress?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
  sortOrder?: "asc" | "desc";
}) {
  const params = new URLSearchParams();

  if (options?.walletAddress) params.append('walletAddress', options.walletAddress);
  if (options?.targetId) params.append('targetId', options.targetId);
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.offset) params.append('offset', options.offset.toString());
  if (options?.sortOrder) params.append('sortOrder', options.sortOrder);

  const response = await fetch(
    `http://localhost:3000/api/blessings/all?${params.toString()}`
  );

  return await response.json();
}

// Usage examples
const allBlessings = await getAllBlessings();
const userBlessings = await getAllBlessings({ walletAddress: '0x1234...' });
const postBlessings = await getAllBlessings({ targetId: 'post_123' });
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "blessings": [
      {
        "id": "blessing_1729785600000_abc123",
        "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "targetId": "post_123",
        "timestamp": "2025-10-24T15:30:00.000Z",
        "nftCount": 5
      },
      {
        "id": "blessing_1729785500000_def456",
        "walletAddress": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        "targetId": "post_456",
        "timestamp": "2025-10-24T15:28:20.000Z",
        "nftCount": 3
      }
    ],
    "total": 2,
    "limit": 50,
    "offset": 0
  }
}
```

---

### 6. Get Blessings for a Target

**Endpoint:** `GET /api/blessings/target/:targetId`

**Description:** Get all blessings for a specific target/creation (e.g., post, artwork, etc.)

**Authentication:** None required (public endpoint)

**cURL Example:**
```bash
curl http://localhost:3000/api/blessings/target/post_123
```

**JavaScript/TypeScript Example:**
```typescript
async function getBlessingsForTarget(targetId: string) {
  const response = await fetch(
    `http://localhost:3000/api/blessings/target/${targetId}`
  );

  return await response.json();
}

// Usage
const result = await getBlessingsForTarget('post_123');
console.log(`${result.data.count} total blessings`);
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "targetId": "post_123",
    "blessings": [
      {
        "id": "blessing_1729785600000_abc123",
        "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "targetId": "post_123",
        "timestamp": "2025-10-24T15:30:00.000Z",
        "nftCount": 5
      },
      {
        "id": "blessing_1729785500000_xyz789",
        "walletAddress": "0x9876543210fedcba9876543210fedcba98765432",
        "targetId": "post_123",
        "timestamp": "2025-10-24T15:25:00.000Z",
        "nftCount": 2
      }
    ],
    "count": 2
  }
}
```

---

### 7. Get Blessings by Wallet

**Endpoint:** `GET /api/blessings/wallet/:walletAddress`

**Description:** Get all blessings performed by a specific wallet address

**Authentication:** None required (public endpoint)

**cURL Example:**
```bash
curl http://localhost:3000/api/blessings/wallet/0x1234567890abcdef1234567890abcdef12345678
```

**JavaScript/TypeScript Example:**
```typescript
async function getBlessingsByWallet(walletAddress: string) {
  const response = await fetch(
    `http://localhost:3000/api/blessings/wallet/${walletAddress}`
  );

  return await response.json();
}

// Usage
const result = await getBlessingsByWallet('0x1234...');
console.log(`User has blessed ${result.data.count} items`);
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "blessings": [
      {
        "id": "blessing_1729785600000_abc123",
        "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "targetId": "post_123",
        "timestamp": "2025-10-24T15:30:00.000Z",
        "nftCount": 5
      },
      {
        "id": "blessing_1729785400000_ghi012",
        "walletAddress": "0x1234567890abcdef1234567890abcdef12345678",
        "targetId": "post_789",
        "timestamp": "2025-10-24T15:26:40.000Z",
        "nftCount": 5
      }
    ],
    "count": 2
  }
}
```

---

### 8. Get FirstWorks NFT Snapshot

**Endpoint:** `GET /api/blessings/firstworks/snapshot`

**Description:** Get the current FirstWorks NFT ownership snapshot data showing all holders and their NFTs

**Authentication:** None required (public endpoint)

**cURL Example:**
```bash
curl http://localhost:3000/api/blessings/firstworks/snapshot
```

**JavaScript/TypeScript Example:**
```typescript
async function getFirstWorksSnapshot() {
  const response = await fetch('http://localhost:3000/api/blessings/firstworks/snapshot');
  const data = await response.json();

  console.log(`Total Holders: ${data.data.totalHolders}`);
  console.log(`Total Supply: ${data.data.totalSupply}`);
  console.log(`Snapshot taken at: ${data.data.timestamp}`);

  return data;
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "contractAddress": "0x8F814c7C75C5E9e0EDe0336F535604B1915C1985",
    "contractName": "FirstWorks",
    "totalSupply": 100,
    "timestamp": "2025-10-24T12:00:00.000Z",
    "blockNumber": 18500000,
    "holders": [
      {
        "address": "0x1234567890abcdef1234567890abcdef12345678",
        "balance": 5,
        "tokenIds": [1, 2, 3, 4, 5]
      },
      {
        "address": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        "balance": 3,
        "tokenIds": [6, 7, 8]
      }
    ],
    "totalHolders": 2,
    "holderIndex": {
      "0x1234567890abcdef1234567890abcdef12345678": [1, 2, 3, 4, 5],
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd": [6, 7, 8]
    }
  }
}
```

**Error Response - No Snapshot (404):**
```json
{
  "error": "No snapshot available",
  "message": "Run 'npm run snapshot:generate' to create a snapshot"
}
```

**Use Cases:**
- Check if a user owns any NFTs: `snapshot.data.holderIndex[walletAddress]`
- Display NFT holder leaderboard
- Show total collection statistics
- Verify snapshot timestamp and freshness

---

### 9. Reload FirstWorks NFT Snapshot (Admin)

**Endpoint:** `POST /api/blessings/firstworks/reload-snapshot`

**Description:** Force reload the FirstWorks NFT ownership snapshot without restarting the server

**Authentication:** None (should add admin auth in production)

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/blessings/firstworks/reload-snapshot
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "FirstWorks snapshot reloaded successfully"
}
```

---

## Common Error Responses

### 401 Unauthorized
```json
{
  "error": "Missing or invalid authorization header"
}
```

### 400 Bad Request (No Wallet)
```json
{
  "error": "Wallet address not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to perform blessing",
  "details": "Error message here"
}
```

---

## React Hook Example

Here's a complete React hook for managing blessings:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';

const API_BASE_URL = 'http://localhost:3000';

interface BlessingStats {
  nftCount: number;
  maxBlessings: number;
  usedBlessings: number;
  remainingBlessings: number;
  periodStart: string;
  periodEnd: string;
}

export function useBlessings() {
  const { getAccessToken, authenticated } = usePrivy();
  const [stats, setStats] = useState<BlessingStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch blessing stats
  const fetchStats = useCallback(async () => {
    if (!authenticated) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_BASE_URL}/api/blessings/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();

      if (data.success) {
        setStats(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken]);

  // Perform a blessing
  const bless = useCallback(async (targetId: string) => {
    if (!authenticated) {
      setError('Not authenticated');
      return { success: false, error: 'Not authenticated' };
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_BASE_URL}/api/blessings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetId })
      });

      const data = await response.json();

      if (data.success) {
        // Refresh stats after successful blessing
        await fetchStats();
        return { success: true, data: data.data };
      } else {
        setError(data.error);
        return { success: false, error: data.error };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to bless';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken, fetchStats]);

  // Load stats on mount
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    loading,
    error,
    bless,
    refresh: fetchStats
  };
}

// Usage in a component:
function BlessingButton({ targetId }: { targetId: string }) {
  const { stats, bless, loading } = useBlessings();

  const handleBless = async () => {
    const result = await bless(targetId);
    if (result.success) {
      alert(`Blessed! ${result.data.remainingBlessings} remaining`);
    } else {
      alert(`Error: ${result.error}`);
    }
  };

  const canBless = stats && stats.remainingBlessings > 0;

  return (
    <button
      onClick={handleBless}
      disabled={!canBless || loading}
    >
      {loading ? 'Blessing...' : `Bless (${stats?.remainingBlessings || 0} left)`}
    </button>
  );
}
```

## Project Structure

```
abraham-api/
├── lib/
│   ├── abi/                    # Contract ABIs
│   └── snapshots/              # NFT snapshot utilities
├── src/
│   ├── middleware/             # Auth middleware
│   ├── routes/                 # API routes
│   ├── services/               # Business logic
│   ├── index.ts               # Hono app
│   └── server.ts              # Server entry point
└── package.json
```

## Development

### API Development

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm start

# Generate NFT snapshot
npm run snapshot:generate

# Type checking
npm run typecheck
```

### Contract Development

When you make changes to the smart contracts, you need to recompile and extract the ABI:

```bash
# Compile contracts (automatically extracts ABI)
npm run compile

# Or manually extract ABI after compilation
npm run extract-abi
```

**Important**: The ABI is stored in `lib/abi/TheSeeds.json` and is **tracked by git**. This ensures the ABI is available in deployments (Vercel, etc.) since the `artifacts/` folder is gitignored.

**When to update the ABI:**
- After modifying `contracts/TheSeeds.sol`
- After pulling contract changes from git
- Before deploying to production

The `postcompile` script automatically runs `extract-abi` after each compilation, so normally you just need to run `npm run compile`.

## Deployment

### Vercel

```bash
npm install -g vercel
vercel
```

Add your environment variables in the Vercel dashboard.

## License

MIT
