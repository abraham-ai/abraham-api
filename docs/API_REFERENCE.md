# Abraham API - Blessing Endpoints Reference

## Overview

The Abraham API provides two ways to submit blessings:

1. **Gasless (Backend-Signed)**: POST `/blessings` - Backend submits blessing on behalf of user
2. **User-Signed**: POST `/blessings/prepare` - User signs and submits their own transaction

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
- User must own FirstWorks NFTs
- User must not have already blessed this seed
- Backend must have RELAYER_ROLE **OR** user must approve backend as delegate

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
- User must not have already blessed this seed

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
      "to": "0x878baad70577cf114a3c60fd01b5a036fd0c4bc8",
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
      "to": "0x878baad70577cf114a3c60fd01b5a036fd0c4bc8",
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

Get all blessings for a specific seed (from blockchain).

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
      "votes": 100
    },
    "blessings": [
      {
        "blesser": "0xUser1...",
        "actor": "0xBackend...",
        "timestamp": 1699564800,
        "isDelegated": true
      },
      {
        "blesser": "0xUser2...",
        "actor": "0xUser2...",
        "timestamp": 1699564900,
        "isDelegated": false
      }
    ],
    "count": 42
  }
}
```

### GET `/blessings/user/:address`

Get all blessings by a specific user (from blockchain).

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
        "actor": "0xBackend...",
        "timestamp": 1699564800,
        "isDelegated": true
      },
      {
        "seedId": 1,
        "actor": "0x1234...",
        "timestamp": 1699564900,
        "isDelegated": false
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
      "address": "0x878baad70577cf114a3c60fd01b5a036fd0c4bc8",
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

### POST `/admin/config/voting-period`

Update the voting period duration (admin only).

**Requirements:**
- Admin role on the contract
- Authenticated with admin wallet

**Request:**
```json
POST /admin/config/voting-period
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "votingPeriod": 43200  // 12 hours in seconds
}
```

**Valid Range:** 3600 (1 hour) to 604800 (7 days)

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "previousPeriod": 86400,
    "newPeriod": 43200,
    "txHash": "0x123...",
    "message": "Voting period updated successfully"
  }
}
```

**Error Responses:**

**400 - Invalid Period**
```json
{
  "success": false,
  "error": "Voting period must be between 1 hour and 7 days"
}
```

**403 - Not Admin**
```json
{
  "success": false,
  "error": "Unauthorized: Admin role required"
}
```

### POST `/admin/config/blessings-per-nft`

Update the number of blessings each NFT grants per day (admin only).

**Requirements:**
- Admin role on the contract
- Authenticated with admin wallet

**Request:**
```json
POST /admin/config/blessings-per-nft
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "blessingsPerNFT": 3
}
```

**Valid Range:** 1 to 100

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "previousAmount": 1,
    "newAmount": 3,
    "txHash": "0x123...",
    "message": "Blessings per NFT updated successfully"
  }
}
```

**Error Responses:**

**400 - Invalid Amount**
```json
{
  "success": false,
  "error": "Blessings per NFT must be between 1 and 100"
}
```

**403 - Not Admin**
```json
{
  "success": false,
  "error": "Unauthorized: Admin role required"
}
```

### Configuration Events

The contract emits events when configuration changes. Monitor these via WebSocket or polling:

**VotingPeriodUpdated Event:**
```typescript
contract.on('VotingPeriodUpdated', (previousPeriod, newPeriod) => {
  console.log('Voting period changed:', {
    from: Number(previousPeriod),
    to: Number(newPeriod)
  });
  // Notify users, update UI, etc.
});
```

**BlessingsPerNFTUpdated Event:**
```typescript
contract.on('BlessingsPerNFTUpdated', (previousAmount, newAmount) => {
  console.log('Blessings per NFT changed:', {
    from: Number(previousAmount),
    to: Number(newAmount)
  });
  // Update user's available blessings display
});
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

**Already Blessed:**
```json
{
  "success": false,
  "error": "You have already blessed this seed"
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
L2_RPC_URL=https://sepolia.base.org
L2_SEEDS_CONTRACT=0x878baad70577cf114a3c60fd01b5a036fd0c4bc8

# FirstWorks NFT (L1)
MAINNET_RPC_URL=https://eth.llamarpc.com
FIRSTWORKS_CONTRACT_ADDRESS=0x...
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
     │          3. Verify not already blessed              │
     │                ├────────────────────────────────────>│
     │                │                 │         hasBlessed?
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
     │          3. Verify not blessed    │
     │                ├─────────────────>│
     │                │        hasBlessed?
     │                │<────────────────┤
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

## Support

For issues or questions:
- GitHub: https://github.com/your-org/abraham-api
- Discord: https://discord.gg/abraham
- Email: support@abraham.xyz
