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
    "message": "Blessing performed successfully"
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

### 5. Reload NFT Snapshot (Admin)

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
