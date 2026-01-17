# Abraham API - Blessing Endpoints Reference

## Overview

The Abraham API provides two ways to submit blessings:

1. **Gasless (Backend-Signed)**: POST `/blessings` - Backend submits blessing on behalf of user
2. **User-Signed**: POST `/blessings/prepare` - User signs and submits their own transaction

> **📘 Looking for smart contract documentation?** See [Seeds Contract Reference](./SEEDS_CONTRACT_REFERENCE.md) for a complete guide to all AbrahamSeeds contract functions with code examples.

## Table of Contents

- [Authentication](#authentication)
- [Gasless Blessings](#gasless-blessings)
- [User-Signed Blessings](#user-signed-blessings)
- [Delegation](#delegation)
- [Query Endpoints](#query-endpoints)
- [Configuration Endpoints](#configuration-endpoints)
- [Error Handling](#error-handling)
- [Environment Variables](#environment-variables)

---

## Authentication

All blessing endpoints require authentication via Privy. Include the Privy auth token in the Authorization header:

```
Authorization: Bearer <privy_token>
```

---

## Gasless Blessings

### POST `/blessings`

Submit a blessing with backend signing (gasless for user).

**Requirements:**
- User must be authenticated
- User must own FirstWorks NFTs (verified via Merkle proof)
- User must not have used all daily blessings
- Backend must have OPERATOR_ROLE **OR** user must approve backend as delegate

**Request:**
```json
POST /blessings
Authorization: Bearer <privy_token>
Content-Type: application/json

{
  "seedId": 0
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "seedId": 0,
    "txHash": "0x123...",
    "blessingCount": 42,
    "message": "Blessing submitted successfully",
    "blockExplorer": "https://sepolia.basescan.org/tx/0x123..."
  }
}
```

**Error Responses:**

**400 - Bad Request**
```json
{
  "success": false,
  "error": "seedId is required"
}
```

```json
{
  "success": false,
  "error": "You have already blessed this seed"
}
```

```json
{
  "success": false,
  "error": "Cannot bless a minted seed"
}
```

**403 - Not Eligible**
```json
{
  "success": false,
  "error": "All blessings used for this period",
  "data": {
    "nftCount": 5,
    "maxBlessings": 5,
    "usedBlessings": 5,
    "remainingBlessings": 0,
    "periodEnd": "2025-11-09T00:00:00.000Z"
  }
}
```

**403 - Not Authorized (Needs Delegation)**
```json
{
  "success": false,
  "error": "Backend not authorized to bless on your behalf",
  "message": "Please approve the backend as your delegate first using /blessings/prepare-delegate endpoint",
  "data": {
    "backendAddress": "0xBackend...",
    "needsApproval": true
  }
}
```

**404 - Seed Not Found**
```json
{
  "success": false,
  "error": "Seed not found"
}
```

**503 - Service Unavailable**
```json
{
  "success": false,
  "error": "Backend blessing service not configured",
  "message": "RELAYER_PRIVATE_KEY not set - use /blessings/prepare endpoint for client-side signing"
}
```

---

## User-Signed Blessings

### POST `/blessings/prepare`

Prepare a blessing transaction for client-side signing (user pays gas).

**Requirements:**
- User must be authenticated
- User must own FirstWorks NFTs
- User must have remaining blessings today

**Request:**
```json
POST /blessings/prepare
Authorization: Bearer <privy_token>
Content-Type: application/json

{
  "seedId": 0
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "to": "0x0b95d25463b7a937b3df28368456f2c40e95c730",
      "data": "0x...",
      "from": "0xUser...",
      "chainId": 84532
    },
    "seedInfo": {
      "id": 0,
      "title": "My Seed",
      "creator": "0xCreator...",
      "currentBlessings": 41
    },
    "userInfo": {
      "address": "0xUser...",
      "nftCount": 5,
      "remainingBlessings": 3
    },
    "instructions": {
      "step1": "Send this transaction using your wallet",
      "step2": "Wait for transaction confirmation",
      "step3": "Your blessing will be recorded on-chain"
    }
  }
}
```

**Frontend Implementation Example:**
```typescript
// Using ethers.js
const response = await fetch('/blessings/prepare', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${privyToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ seedId: 0 })
});

const { data } = await response.json();

// Send transaction
const tx = await signer.sendTransaction({
  to: data.transaction.to,
  data: data.transaction.data
});

// Wait for confirmation
const receipt = await tx.wait();
console.log('Blessing confirmed:', receipt.transactionHash);
```

```typescript
// Using viem + wagmi
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

const { data: hash, writeContract } = useWriteContract();

// Prepare transaction
const response = await fetch('/blessings/prepare', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${privyToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ seedId: 0 })
});

const { data } = await response.json();

// Submit transaction
writeContract({
  to: data.transaction.to,
  data: data.transaction.data
});

// Wait for confirmation (using the hook)
const { isSuccess } = useWaitForTransactionReceipt({ hash });
```

**Error Responses:** Same as POST `/blessings` (400, 403, 404)

---

## Delegation

### GET `/blessings/delegation-status`

Check the delegation status of the authenticated user. This endpoint returns whether the user has approved the backend as their delegate, which is required for gasless blessings.

**Request:**
```json
GET /blessings/delegation-status
Authorization: Bearer <privy_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "userAddress": "0xUser...",
    "backendAddress": "0xBackend...",
    "isDelegateApproved": true,
    "canUseGaslessBlessings": true,
    "message": "You have approved gasless blessings. The backend can submit blessings on your behalf."
  }
}
```

**Response when not approved:**
```json
{
  "success": true,
  "data": {
    "userAddress": "0xUser...",
    "backendAddress": "0xBackend...",
    "isDelegateApproved": false,
    "canUseGaslessBlessings": false,
    "message": "You have not yet approved gasless blessings. Call POST /blessings/prepare-delegate to get started."
  }
}
```

**Response when backend not configured:**
```json
{
  "success": true,
  "data": {
    "userAddress": "0xUser...",
    "backendAddress": null,
    "isDelegateApproved": false,
    "canUseGaslessBlessings": false,
    "message": "Backend relayer not configured. Gasless blessings are not available."
  }
}
```

**Frontend Implementation Example:**
```typescript
// Check delegation status before attempting gasless blessing
const checkDelegationStatus = async () => {
  const response = await fetch('/blessings/delegation-status', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${privyToken}`
    }
  });

  const { data } = await response.json();

  if (data.canUseGaslessBlessings) {
    console.log('Gasless blessings enabled!');
    return true;
  } else {
    console.log('Need to approve delegation first');
    return false;
  }
};
```

---

### POST `/blessings/prepare-delegate`

Prepare a delegate approval transaction. Users must approve the backend as their delegate to enable gasless blessings.

**Request:**
```json
POST /blessings/prepare-delegate
Authorization: Bearer <privy_token>
Content-Type: application/json

{
  "approved": true  // Optional, defaults to true
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "to": "0x0b95d25463b7a937b3df28368456f2c40e95c730",
      "data": "0x...",
      "from": "0xUser...",
      "chainId": 84532
    },
    "delegateAddress": "0xBackend...",
    "approved": true,
    "currentStatus": "Not yet approved",
    "message": "Sign this transaction to approve gasless blessings"
  }
}
```

**Frontend Implementation Example:**
```typescript
// 1. Check if user needs to approve delegate
const checkDelegation = async () => {
  const response = await fetch('/blessings/delegation-status', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${privyToken}`
    }
  });

  const { data } = await response.json();
  return data.canUseGaslessBlessings;
};

// 2. If not approved, prompt user to approve
const approveDelegate = async () => {
  const response = await fetch('/blessings/prepare-delegate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${privyToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ approved: true })
  });

  const { data } = await response.json();

  // Send transaction
  const tx = await signer.sendTransaction({
    to: data.transaction.to,
    data: data.transaction.data
  });

  await tx.wait();
  console.log('Delegation approved!');
};

// 3. Complete blessing flow
const blessWithGaslessOption = async (seedId: number) => {
  const isApproved = await checkDelegation();

  if (!isApproved) {
    // Prompt user to approve
    await approveDelegate();
  }

  // Now submit gasless blessing
  await fetch('/blessings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${privyToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ seedId })
  });
};
```

---

## Query Endpoints

### GET `/blessings/eligibility`

Check if the authenticated user is eligible to bless.

**Request:**
```
GET /blessings/eligibility
Authorization: Bearer <privy_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "eligible": true,
    "nftCount": 5,
    "maxBlessings": 5,
    "usedBlessings": 2,
    "remainingBlessings": 3,
    "periodEnd": "2025-11-09T00:00:00.000Z"
  }
}
```

### GET `/blessings/stats`

Get blessing statistics for the authenticated user.

**Request:**
```
GET /blessings/stats
Authorization: Bearer <privy_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nftCount": 5,
    "maxBlessings": 5,
    "usedBlessings": 2,
    "remainingBlessings": 3,
    "periodStart": "2025-11-08T00:00:00.000Z",
    "periodEnd": "2025-11-09T00:00:00.000Z"
  }
}
```

### GET `/blessings/seed/:seedId`

Get all blessings for a specific seed (from blockchain events).

**Request:**
```
GET /blessings/seed/0
```

**Response:**
```json
{
  "success": true,
  "data": {
    "seedId": 0,
    "seed": {
      "title": "My Seed",
      "creator": "0xCreator...",
      "blessings": 42,
      "score": 100
    },
    "blessings": [
      {
        "blesser": "0xUser1...",
        "timestamp": 1699564800
      },
      {
        "blesser": "0xUser2...",
        "timestamp": 1699564900
      }
    ],
    "count": 42
  }
}
```

### GET `/blessings/user/:address`

Get all blessings by a specific user (from blockchain events).

**Request:**
```
GET /blessings/user/0x1234...
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "0x1234...",
    "blessings": [
      {
        "seedId": 0,
        "timestamp": 1699564800
      },
      {
        "seedId": 1,
        "timestamp": 1699564900
      }
    ],
    "count": 2
  }
}
```

### GET `/blessings/total`

Get total number of blessings across all seeds.

**Request:**
```
GET /blessings/total
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalBlessings": 1234
  }
}
```

### GET `/blessings/firstworks/snapshot`

Get the current FirstWorks NFT snapshot data.

**Request:**
```
GET /blessings/firstworks/snapshot
```

**Response:**
```json
{
  "success": true,
  "data": {
    "contractAddress": "0x...",
    "contractName": "FirstWorks",
    "totalSupply": 100,
    "timestamp": "2025-11-08T12:00:00.000Z",
    "blockNumber": 12345678,
    "holders": [...],
    "totalHolders": 50,
    "holderIndex": {...}
  }
}
```

---

## Seed Endpoints

### GET `/seeds`

Get all seeds (paginated).

**Request:**
```
GET /seeds?page=1&limit=20
```

**Response:**
```json
{
  "success": true,
  "data": {
    "seeds": [...],
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

### GET `/seeds/count`

Get total seed count.

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 100
  }
}
```

### GET `/seeds/stats`

Get seed statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalSeeds": 100,
    "eligibleSeeds": 85,
    "currentRound": 15,
    "timeUntilRoundEnd": 43200
  }
}
```

### GET `/seeds/config`

Get current contract configuration.

**Response:**
```json
{
  "success": true,
  "data": {
    "roundMode": { "value": 0, "name": "ROUND_BASED" },
    "tieBreakingStrategy": { "value": 0, "name": "LOWEST_SEED_ID" },
    "eligibleSeedsCount": 85,
    "blessingsPerNFT": 1,
    "votingPeriod": 86400
  }
}
```

### GET `/seeds/:seedId`

Get a specific seed by ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 0,
    "creator": "0x...",
    "ipfsHash": "Qm...",
    "blessings": 42,
    "score": 100,
    "commandmentCount": 5,
    "createdAt": 1699564800,
    "submittedInRound": 1,
    "creationRound": 0,
    "isRetracted": false
  }
}
```

---

## Configuration Endpoints

### GET `/config`

Get current contract configuration parameters.

**Request:**
```
GET /config
```

**Response:**
```json
{
  "success": true,
  "data": {
    "votingPeriod": 86400,
    "votingPeriodHours": 24,
    "votingPeriodDays": 1,
    "blessingsPerNFT": 1,
    "currentRound": 5,
    "timeUntilPeriodEnd": 43200,
    "contract": {
      "address": "0x0b95d25463b7a937b3df28368456f2c40e95c730",
      "network": "Base Sepolia"
    }
  }
}
```

**Frontend Implementation Example:**
```typescript
// Display current configuration to users
const { data } = await fetch('/config').then(r => r.json());

console.log(`Voting period: ${data.votingPeriodDays} day(s)`);
console.log(`Blessings per NFT: ${data.blessingsPerNFT}`);
console.log(`Time until round ends: ${data.timeUntilPeriodEnd}s`);
```

---

## Error Handling

All endpoints follow a consistent error response format:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "details": "Technical error details (development only)"
}
```

### Common HTTP Status Codes

- **200 OK**: Request successful
- **400 Bad Request**: Invalid input (missing/invalid seedId, etc.)
- **401 Unauthorized**: Missing or invalid authentication token
- **403 Forbidden**: User not eligible (no NFTs, quota exceeded, not authorized)
- **404 Not Found**: Seed does not exist
- **500 Internal Server Error**: Server error
- **503 Service Unavailable**: Backend service not configured

### Common Error Scenarios

**No NFTs Owned:**
```json
{
  "success": false,
  "error": "No NFTs owned",
  "data": {
    "nftCount": 0,
    "maxBlessings": 0,
    ...
  }
}
```

**Blessing Quota Exceeded:**
```json
{
  "success": false,
  "error": "All blessings used for this period",
  "data": {
    "usedBlessings": 5,
    "maxBlessings": 5,
    "remainingBlessings": 0,
    "periodEnd": "2025-11-09T00:00:00.000Z"
  }
}
```

**Backend Not Authorized (Needs Delegation):**
```json
{
  "success": false,
  "error": "Backend not authorized to bless on your behalf",
  "message": "Please approve the backend as your delegate first",
  "data": {
    "backendAddress": "0x...",
    "needsApproval": true
  }
}
```

---

## Environment Variables

### Required

```env
# Authentication
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_secret

# Blockchain Network
NETWORK=baseSepolia  # or "base" for mainnet
L2_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
L2_SEEDS_CONTRACT=0x0b95d25463b7a937b3df28368456f2c40e95c730
L2_GATING_CONTRACT=0x46657b69308d90a4756369094c5d78781f3f5979

# FirstWorks NFT (L1)
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
FIRSTWORKS_CONTRACT_ADDRESS=0x9734c959A5FEC7BaD8b0b560AD94F9740B90Efd8
```

### Optional (for Gasless Blessings)

```env
# Backend Relayer (for gasless blessings)
RELAYER_PRIVATE_KEY=0x...  # Backend wallet private key
```

**Note:** If `RELAYER_PRIVATE_KEY` is not set, only client-side signing (`/blessings/prepare`) will work. The gasless endpoint (`/blessings`) will return a 503 error.

---

## Flow Diagrams

### Gasless Blessing Flow (Backend-Signed)

```
┌─────────┐      ┌─────────┐      ┌─────────┐      ┌────────────┐
│ Client  │      │   API   │      │ Backend │      │ Blockchain │
└────┬────┘      └────┬────┘      └────┬────┘      └─────┬──────┘
     │                │                 │                  │
     │ 1. POST /blessings               │                  │
     ├───────────────>│                 │                  │
     │   {seedId: 0}  │                 │                  │
     │                │                 │                  │
     │          2. Check eligibility    │                  │
     │                ├─────────────────┤                  │
     │                │    (NFTs, quota)│                  │
     │                │<────────────────┤                  │
     │                │                 │                  │
     │          3. Verify Merkle proof  │                  │
     │                ├────────────────────────────────────>│
     │                │                 │         verify() │
     │                │<───────────────────────────────────┤
     │                │                 │                  │
     │          4. Check authorization  │                  │
     │                ├────────────────────────────────────>│
     │                │                 │        isDelegate?
     │                │<───────────────────────────────────┤
     │                │                 │                  │
     │          5. Submit blessing      │                  │
     │                │─────────────────>│                  │
     │                │                 │ 6. Sign & send tx │
     │                │                 ├─────────────────>│
     │                │                 │                  │
     │                │                 │ 7. Tx confirmed  │
     │                │                 │<─────────────────┤
     │                │                 │                  │
     │      8. Return success           │                  │
     │<───────────────┤                 │                  │
     │  {txHash: ...} │                 │                  │
```

### User-Signed Blessing Flow

```
┌─────────┐      ┌─────────┐      ┌────────────┐
│ Client  │      │   API   │      │ Blockchain │
└────┬────┘      └────┬────┘      └─────┬──────┘
     │                │                  │
     │ 1. POST /blessings/prepare       │
     ├───────────────>│                  │
     │   {seedId: 0}  │                  │
     │                │                  │
     │          2. Check eligibility     │
     │                │                  │
     │          3. Build transaction     │
     │                │                  │
     │      4. Return transaction data   │
     │<───────────────┤                  │
     │  {transaction} │                  │
     │                │                  │
     │ 5. User signs & sends tx          │
     ├──────────────────────────────────>│
     │                │                  │
     │          6. Transaction confirmed │
     │<──────────────────────────────────┤
```

### Delegation Flow

```
┌─────────┐      ┌─────────┐      ┌────────────┐
│ Client  │      │   API   │      │ Blockchain │
└────┬────┘      └────┬────┘      └─────┬──────┘
     │                │                  │
     │ 1. POST /blessings/prepare-delegate
     ├───────────────>│                  │
     │   {approved: true}                │
     │                │                  │
     │          2. Check current status  │
     │                ├─────────────────>│
     │                │       isDelegate?│
     │                │<────────────────┤
     │                │                  │
     │      3. Return approval tx data   │
     │<───────────────┤                  │
     │  {transaction} │                  │
     │                │                  │
     │ 4. User signs & approves delegate │
     ├──────────────────────────────────>│
     │                │                  │
     │          5. Approval confirmed    │
     │<──────────────────────────────────┤
     │                │                  │
     │ 6. Now gasless blessings enabled! │
```

---

## Best Practices

### For Frontend Developers

1. **Always check eligibility first** before attempting to bless
   ```typescript
   const { data } = await fetch('/blessings/eligibility');
   if (!data.eligible) {
     alert(data.reason);
     return;
   }
   ```

2. **Handle delegation gracefully** - Prompt users to approve backend only when needed
   ```typescript
   try {
     await blessGasless(seedId);
   } catch (error) {
     if (error.data?.needsApproval) {
       // Prompt user to approve delegation
       await approveDelegate();
       // Retry blessing
       await blessGasless(seedId);
     }
   }
   ```

3. **Provide clear feedback** about gas costs
   - Gasless option: "Free blessing (no gas required)"
   - User-signed: "You'll pay a small gas fee (~$0.01)"

4. **Handle errors gracefully**
   ```typescript
   try {
     const response = await bless(seedId);
     showSuccess(`Blessed! Tx: ${response.data.txHash}`);
   } catch (error) {
     if (error.status === 403) {
       showError(`Not eligible: ${error.error}`);
     } else if (error.status === 400) {
       showError(`Invalid: ${error.error}`);
     } else {
       showError('Something went wrong. Please try again.');
     }
   }
   ```

### For Backend Developers

1. **Secure the relayer private key**
   - Use environment variables
   - Never commit to version control
   - Consider using AWS KMS, Azure Key Vault, or similar

2. **Monitor relayer gas balance**
   ```typescript
   const balance = await publicClient.getBalance({ address: relayerAddress });
   if (balance < parseEther('0.01')) {
     alert('Relayer balance low!');
   }
   ```

3. **Rate limit blessing submissions** beyond NFT quotas
   ```typescript
   // Additional rate limiting
   if (await redis.get(`rate:${userAddress}`)) {
     return { error: 'Too many requests' };
   }
   await redis.setex(`rate:${userAddress}`, 60, '1');
   ```

4. **Log all blessing submissions** for debugging and monitoring
   ```typescript
   logger.info('Blessing submitted', {
     user: userAddress,
     seedId,
     txHash: result.txHash,
     timestamp: new Date().toISOString()
   });
   ```

---

## Contract Architecture

### AbrahamSeeds Contract

The AbrahamSeeds contract is an ERC1155-based NFT contract that:
- Manages seed submissions and blessings
- Uses quadratic (sqrt) scoring for anti-whale protection
- Mints ERC1155 editions when seeds win
- Integrates with MerkleGating for cross-chain NFT verification

### MerkleGating Module

The MerkleGating module verifies FirstWorks NFT ownership using Merkle proofs:
- Snapshot of L1 NFT ownership is taken periodically
- Merkle tree is generated from snapshot
- Users prove ownership with Merkle proofs on L2

### Role System

| Role | Description |
|------|-------------|
| `DEFAULT_ADMIN_ROLE` | Full admin access, can grant/revoke roles |
| `CREATOR_ROLE` | Can submit seeds |
| `OPERATOR_ROLE` | Can perform operations (relayer functions, winner selection) |

---

## Support

For issues or questions:
- GitHub: https://github.com/your-org/abraham-api
- Discord: https://discord.gg/abraham
- Email: support@abraham.xyz
