# Abraham API

A Hono-based API for managing NFT-based blessings (likes) for the FirstWorks collection.

## Overview

This API allows users who own FirstWorks NFTs to perform "blessings" on content. The blessing system uses:
- **Privy** for authentication
- **Viem** for Ethereum blockchain interactions
- **Hono** as the lightweight web framework

### Key Features
- NFT-based blessing eligibility (if you own N NFTs, you get N blessings per day)
- 24-hour blessing period (resets at midnight UTC)
- Daily NFT ownership snapshots for fast lookups
- Secure Privy authentication

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Privy credentials and RPC URL
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

## Documentation

For detailed setup instructions, API documentation, and deployment guides, see [SETUP.md](./SETUP.md).

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

### 2. Check Blessing Eligibility

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

### 8. Get NFT Snapshot

**Endpoint:** `GET /api/blessings/snapshot`

**Description:** Get the current NFT ownership snapshot data showing all holders and their NFTs

**Authentication:** None required (public endpoint)

**cURL Example:**
```bash
curl http://localhost:3000/api/blessings/snapshot
```

**JavaScript/TypeScript Example:**
```typescript
async function getSnapshot() {
  const response = await fetch('http://localhost:3000/api/blessings/snapshot');
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

### 9. Reload NFT Snapshot (Admin)

**Endpoint:** `POST /api/blessings/reload-snapshot`

**Description:** Force reload the NFT ownership snapshot without restarting the server

**Authentication:** None (should add admin auth in production)

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/blessings/reload-snapshot
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Snapshot reloaded successfully"
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

## Deployment

### Vercel

```bash
npm install -g vercel
vercel
```

Add your environment variables in the Vercel dashboard.

## License

MIT
