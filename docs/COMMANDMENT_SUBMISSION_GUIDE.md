# Commandment Submission Guide

## Overview

This guide covers the two ways to submit commandments (comments) on seeds in TheSeeds system:

1. **Delegated (Gasless)** - Backend submits on behalf of users
2. **Non-Delegated (User-Signed)** - Users sign and submit transactions themselves

Both methods support the same eligibility requirements and daily limits based on FirstWorks NFT ownership.

---

## Table of Contents

1. [Submission Methods Comparison](#submission-methods-comparison)
2. [Delegated Submission (Gasless)](#delegated-submission-gasless)
3. [Non-Delegated Submission (User-Signed)](#non-delegated-submission-user-signed)
4. [API Endpoints](#api-endpoints)
5. [Frontend Integration Examples](#frontend-integration-examples)
6. [Smart Contract Functions](#smart-contract-functions)
7. [Security Considerations](#security-considerations)

---

## Submission Methods Comparison

### Delegated (Gasless) vs Non-Delegated (User-Signed)

| Feature | Delegated (Gasless) | Non-Delegated (User-Signed) |
|---------|-------------------|----------------------------|
| **Gas Payment** | Backend pays | User pays |
| **User Action** | Click button | Sign transaction in wallet |
| **Speed** | Instant | Depends on wallet confirmation |
| **Setup Required** | One-time delegate approval | None |
| **Privacy** | Backend knows action | Fully private |
| **Use Case** | Better UX, faster | Maximum decentralization |
| **Backend Dependency** | Required | Optional |

### When to Use Each Method

**Use Delegated (Gasless):**
- Better user experience (no wallet popups)
- Users are less technical
- Want instant feedback
- Have backend infrastructure

**Use Non-Delegated (User-Signed):**
- Maximum decentralization desired
- Users prefer to pay own gas
- Backend is unavailable or untrusted
- Compliance or privacy requirements

---

## Delegated Submission (Gasless)

### How It Works

```
User clicks "Comment" → API uploads to IPFS → Backend signs transaction → Comment recorded on-chain
```

The backend pays gas fees and submits the transaction on behalf of the user.

### Requirements

1. ✅ User must own FirstWorks NFTs
2. ✅ User must not exceed daily limit (NFT count × commandmentsPerNFT)
3. ✅ User must be authenticated (JWT token)
4. ✅ Seed must exist and not be retracted
5. ✅ Backend must have RELAYER_ROLE on contract

### API Endpoint

```http
POST /api/commandments
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "seedId": 42,
  "message": "This seed is incredible! The composition really speaks to me."
}
```

**Request Parameters:**
- `seedId` (number, required) - ID of the seed to comment on
- `message` (string, required) - Comment text (max 5000 characters)

**Success Response:**
```json
{
  "success": true,
  "data": {
    "commandmentId": 123,
    "ipfsHash": "QmX7Y8Z9...",
    "txHash": "0xabc123...",
    "blockExplorer": "https://basescan.org/tx/0xabc123..."
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Daily limit reached: 5/5 commandments used today"
}
```

### Backend Implementation

The backend API:
1. Verifies user authentication
2. Checks NFT ownership from snapshot
3. Validates daily limits
4. Uploads message to IPFS
5. Gets Merkle proof for on-chain verification
6. Calls `commentOnSeedFor()` on the contract

See [commandmentService.ts:68-183](../src/services/commandmentService.ts#L68-L183) for implementation details.

---

## Non-Delegated Submission (User-Signed)

### How It Works

```
User clicks "Comment" → API uploads to IPFS & prepares transaction → User signs in wallet → Comment recorded on-chain
```

The user signs and submits the transaction themselves, paying their own gas.

### Requirements

1. ✅ User must own FirstWorks NFTs
2. ✅ User must not exceed daily limit (NFT count × commandmentsPerNFT)
3. ✅ User must be authenticated (JWT token)
4. ✅ Seed must exist and not be retracted
5. ✅ User must have ETH for gas + commandmentCost

### API Endpoint

```http
POST /api/commandments/prepare
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "seedId": 42,
  "message": "This seed is incredible! The composition really speaks to me."
}
```

**Request Parameters:**
- `seedId` (number, required) - ID of the seed to comment on
- `message` (string, required) - Comment text (max 5000 characters)

**Success Response:**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "to": "0x81901f757fd6b3c37e5391dbe6fa0affe9a181b5",
      "data": "0x3a2b5c7d...",
      "from": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      "chainId": 8453
    },
    "seedInfo": {
      "id": 42,
      "creator": "0xCreatorAddress...",
      "ipfsHash": "QmSeedIPFS...",
      "blessings": 150,
      "isWinner": false,
      "isRetracted": false
    },
    "userInfo": {
      "nftCount": 5,
      "dailyCommandmentCount": 2,
      "remainingCommandments": 3,
      "commandmentsPerNFT": 1
    },
    "ipfsHash": "QmX7Y8Z9...",
    "instructions": {
      "step1": "Send this transaction using your wallet",
      "step2": "Wait for transaction confirmation",
      "step3": "Your commandment will be recorded on-chain",
      "note": "The message has been uploaded to IPFS and the transaction includes the IPFS hash"
    }
  }
}
```

**Error Responses:**

```json
// NFT ownership required
{
  "success": false,
  "error": "You must own at least one FirstWorks NFT to comment"
}

// Daily limit reached
{
  "success": false,
  "error": "Daily limit reached: 5/5 commandments used today",
  "userInfo": {
    "nftCount": 5,
    "dailyCommandmentCount": 5,
    "remainingCommandments": 0,
    "commandmentsPerNFT": 1
  }
}

// Seed not found or retracted
{
  "success": false,
  "error": "Cannot comment on a retracted seed"
}
```

### Frontend Integration

After receiving the transaction data from the API, the frontend must:

1. **Send the transaction using the user's wallet:**

```typescript
// Using ethers.js v6
import { BrowserProvider } from 'ethers';

async function submitCommandment(transactionData) {
  // 1. Get the prepared transaction from API
  const response = await fetch('/api/commandments/prepare', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      seedId: 42,
      message: "Great seed!"
    })
  });

  const { data } = await response.json();
  const { transaction } = data;

  // 2. Get user's wallet provider
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  // 3. Send the transaction
  const tx = await signer.sendTransaction({
    to: transaction.to,
    data: transaction.data,
    // Optional: estimate gas first
    // gasLimit: await provider.estimateGas(transaction)
  });

  // 4. Wait for confirmation
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber
  };
}
```

2. **Using viem (alternative):**

```typescript
import { createWalletClient, custom } from 'viem';
import { base } from 'viem/chains';

async function submitCommandment() {
  // 1. Get prepared transaction from API
  const response = await fetch('/api/commandments/prepare', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      seedId: 42,
      message: "Great seed!"
    })
  });

  const { data } = await response.json();
  const { transaction } = data;

  // 2. Create wallet client
  const walletClient = createWalletClient({
    chain: base,
    transport: custom(window.ethereum)
  });

  const [account] = await walletClient.requestAddresses();

  // 3. Send transaction
  const hash = await walletClient.sendTransaction({
    account,
    to: transaction.to,
    data: transaction.data
  });

  return { txHash: hash };
}
```

### Backend Implementation

The backend API:
1. Verifies user authentication
2. Checks NFT ownership from snapshot
3. Validates daily limits
4. Uploads message to IPFS
5. Gets Merkle proof for on-chain verification
6. Prepares transaction data (doesn't submit)
7. Returns transaction data for client-side signing

See [commandmentService.ts:427-606](../src/services/commandmentService.ts#L427-L606) for implementation details.

---

## API Endpoints

### 1. Delegated Submission (Gasless)

**Endpoint:** `POST /api/commandments`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body:**
```json
{
  "seedId": number,
  "message": string
}
```

**Response:** Transaction submitted by backend

### 2. Non-Delegated Preparation

**Endpoint:** `POST /api/commandments/prepare`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body:**
```json
{
  "seedId": number,
  "message": string
}
```

**Response:** Transaction data for client-side signing

### 3. Check Eligibility

**Endpoint:** `GET /api/commandments/eligibility`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "canComment": true,
    "reason": "You can submit commandments",
    "nftCount": 5,
    "dailyCount": 2,
    "maxAllowed": 5
  }
}
```

### 4. Get User Stats

**Endpoint:** `GET /api/commandments/stats`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nftCount": 5,
    "dailyCommandmentCount": 2,
    "remainingCommandments": 3,
    "commandmentsPerNFT": 1
  }
}
```

---

## Frontend Integration Examples

### React Example with Both Methods

```typescript
import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';

interface CommandmentFormProps {
  seedId: number;
}

export function CommandmentForm({ seedId }: CommandmentFormProps) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { isConnected, provider } = useWallet();

  // Method 1: Gasless (Delegated)
  const submitGasless = async () => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/commandments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ seedId, message })
      });

      const result = await response.json();

      if (result.success) {
        alert(`Commandment submitted! Tx: ${result.data.txHash}`);
        setMessage('');
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Error submitting commandment:', error);
      alert('Failed to submit commandment');
    } finally {
      setSubmitting(false);
    }
  };

  // Method 2: User-Signed (Non-Delegated)
  const submitUserSigned = async () => {
    if (!isConnected || !provider) {
      alert('Please connect your wallet');
      return;
    }

    setSubmitting(true);
    try {
      // Step 1: Prepare transaction
      const response = await fetch('/api/commandments/prepare', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ seedId, message })
      });

      const result = await response.json();

      if (!result.success) {
        alert(`Error: ${result.error}`);
        return;
      }

      // Step 2: Send transaction via wallet
      const { transaction } = result.data;
      const signer = await provider.getSigner();
      const tx = await signer.sendTransaction({
        to: transaction.to,
        data: transaction.data
      });

      // Step 3: Wait for confirmation
      alert('Transaction sent! Waiting for confirmation...');
      const receipt = await tx.wait();

      alert(`Commandment submitted! Tx: ${tx.hash}`);
      setMessage('');
    } catch (error) {
      console.error('Error submitting commandment:', error);
      alert('Failed to submit commandment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="commandment-form">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Share your thoughts on this seed..."
        maxLength={5000}
        disabled={submitting}
      />

      <div className="button-group">
        {/* Gasless option */}
        <button
          onClick={submitGasless}
          disabled={submitting || !message.trim()}
        >
          {submitting ? 'Submitting...' : 'Comment (Gasless)'}
        </button>

        {/* User-signed option */}
        <button
          onClick={submitUserSigned}
          disabled={submitting || !message.trim() || !isConnected}
        >
          {submitting ? 'Submitting...' : 'Comment (Pay Gas)'}
        </button>
      </div>
    </div>
  );
}
```

### Vue Example

```vue
<template>
  <div class="commandment-form">
    <textarea
      v-model="message"
      placeholder="Share your thoughts on this seed..."
      :maxlength="5000"
      :disabled="submitting"
    />

    <div class="button-group">
      <button @click="submitGasless" :disabled="!canSubmit">
        {{ submitting ? 'Submitting...' : 'Comment (Gasless)' }}
      </button>

      <button @click="submitUserSigned" :disabled="!canSubmit || !isConnected">
        {{ submitting ? 'Submitting...' : 'Comment (Pay Gas)' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useWallet } from '@/composables/useWallet';

const props = defineProps<{
  seedId: number;
}>();

const message = ref('');
const submitting = ref(false);
const { isConnected, provider } = useWallet();

const canSubmit = computed(() => !submitting.value && message.value.trim().length > 0);

async function submitGasless() {
  submitting.value = true;
  try {
    const response = await fetch('/api/commandments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('jwt')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        seedId: props.seedId,
        message: message.value
      })
    });

    const result = await response.json();

    if (result.success) {
      alert(`Commandment submitted! Tx: ${result.data.txHash}`);
      message.value = '';
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to submit commandment');
  } finally {
    submitting.value = false;
  }
}

async function submitUserSigned() {
  if (!isConnected.value || !provider.value) {
    alert('Please connect your wallet');
    return;
  }

  submitting.value = true;
  try {
    // Prepare transaction
    const response = await fetch('/api/commandments/prepare', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('jwt')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        seedId: props.seedId,
        message: message.value
      })
    });

    const result = await response.json();

    if (!result.success) {
      alert(`Error: ${result.error}`);
      return;
    }

    // Send transaction
    const { transaction } = result.data;
    const signer = await provider.value.getSigner();
    const tx = await signer.sendTransaction({
      to: transaction.to,
      data: transaction.data
    });

    alert('Transaction sent! Waiting for confirmation...');
    await tx.wait();

    alert(`Commandment submitted! Tx: ${tx.hash}`);
    message.value = '';
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to submit commandment');
  } finally {
    submitting.value = false;
  }
}
</script>
```

---

## Smart Contract Functions

### User Function: `commentOnSeed()`

Direct submission by users (non-delegated).

```solidity
function commentOnSeed(
    uint256 _seedId,
    string memory _ipfsHash,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external payable whenNotPaused nonReentrant
```

**Parameters:**
- `_seedId` - ID of the seed to comment on
- `_ipfsHash` - IPFS hash of the comment content
- `_tokenIds` - Array of FirstWorks NFT IDs owned by caller
- `_merkleProof` - Merkle proof of NFT ownership

**Requirements:**
- Must pay `commandmentCost` (ETH) if > 0
- Must own NFTs and provide valid Merkle proof
- Must not exceed daily limit

### Relayer Function: `commentOnSeedFor()`

Delegated submission by backend (gasless for user).

```solidity
function commentOnSeedFor(
    uint256 _seedId,
    address _author,
    string memory _ipfsHash,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external payable whenNotPaused nonReentrant
```

**Authorization:** Caller must have `RELAYER_ROLE`

**Parameters:**
- `_seedId` - ID of the seed to comment on
- `_author` - Address of the comment author
- `_ipfsHash` - IPFS hash of the comment content
- `_tokenIds` - Array of FirstWorks NFT IDs owned by author
- `_merkleProof` - Merkle proof of NFT ownership

---

## Security Considerations

### For Delegated (Gasless) Submissions

**Backend Security:**
- ✅ Secure JWT authentication required
- ✅ Rate limiting on API endpoints
- ✅ NFT ownership verified from snapshot
- ✅ Daily limits enforced on-chain
- ✅ Backend wallet private key secured (AWS KMS, etc.)

**User Security:**
- ✅ User trusts backend with commenting rights
- ✅ Backend cannot exceed daily limits (enforced on-chain)
- ✅ Backend cannot comment for users without NFTs (Merkle proof verified on-chain)

### For Non-Delegated (User-Signed) Submissions

**User Security:**
- ✅ User maintains full control
- ✅ No backend trust required
- ✅ Transaction signed in user's wallet
- ✅ User can review transaction before signing

**Frontend Security:**
- ✅ IPFS upload happens before wallet interaction
- ✅ Transaction data prepared by backend (read-only)
- ✅ User signs and submits transaction themselves
- ✅ No private keys handled by frontend

### Common Security Features

Both methods benefit from:
- ✅ On-chain NFT verification (Merkle proofs)
- ✅ On-chain daily limit enforcement
- ✅ Reentrancy protection
- ✅ Overflow protection (Solidity 0.8+)
- ✅ Role-based access control
- ✅ Message content stored on IPFS (immutable)

---

## Testing

### Test Non-Delegated Submission

```bash
# 1. Check eligibility
curl -H "Authorization: Bearer $JWT" \
  http://localhost:3000/api/commandments/eligibility

# 2. Prepare transaction
curl -X POST http://localhost:3000/api/commandments/prepare \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "seedId": 0,
    "message": "Test comment"
  }'

# 3. Use returned transaction data to submit via wallet
# (This step requires a wallet/frontend)
```

### Test Delegated Submission

```bash
# Submit commandment (backend signs)
curl -X POST http://localhost:3000/api/commandments \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "seedId": 0,
    "message": "Test comment"
  }'
```

---

## Troubleshooting

### Common Errors

**"Wallet address not found"**
- Solution: Ensure JWT token is valid and includes wallet address

**"You must own at least one FirstWorks NFT to comment"**
- Solution: User needs to own FirstWorks NFTs
- Check: GET `/api/commandments/eligibility`

**"Daily limit reached"**
- Solution: Wait until next day (UTC midnight)
- Check: GET `/api/commandments/stats` to see when limit resets

**"Cannot comment on a retracted seed"**
- Solution: Choose a different seed that hasn't been retracted

**"Message too long (max 5000 characters)"**
- Solution: Shorten the message

**"Failed to upload to IPFS"**
- Solution: Check IPFS service configuration
- Verify: IPFS_GATEWAY environment variable is set

**"Invalid NFT ownership proof"**
- Solution: Backend needs to regenerate snapshot and Merkle tree
- Run: `npm run snapshot:generate && npm run merkle:generate`

**"Transaction failed" (user-signed)**
- Possible causes:
  - Insufficient gas
  - User doesn't own NFTs
  - Daily limit reached
  - Network congestion
- Solution: Check wallet, try again, or use gasless option

---

## Migration Guide

### From Gasless-Only to Hybrid Approach

If you currently only support delegated submissions and want to add non-delegated:

1. **Update Frontend:**
   ```typescript
   // Add new button for user-signed submission
   <button onClick={submitUserSigned}>
     Comment (Pay Gas)
   </button>
   ```

2. **No Backend Changes Required:**
   - The `/commandments/prepare` endpoint is ready to use
   - All necessary validation is already implemented

3. **User Communication:**
   - Explain benefits of each option
   - Make gasless the default for better UX
   - Offer user-signed as advanced option

### From User-Signed to Gasless

If you currently only support user-signed and want to add gasless:

1. **Backend Setup:**
   - Ensure backend wallet has RELAYER_ROLE
   - Set RELAYER_PRIVATE_KEY in environment

2. **Update Frontend:**
   ```typescript
   // Add gasless button
   <button onClick={submitGasless}>
     Comment (Gasless)
   </button>
   ```

3. **User Education:**
   - Gasless requires JWT authentication
   - One-time setup for smooth experience

---

## Related Documentation

- [Commandments & Configuration](../COMMANDMENTS_AND_CONFIGURATION.md) - Full commandments system overview
- [Blessing System](./BLESSING_SYSTEM.md) - Similar patterns for blessings
- [Smart Contract Guide](../SMART_CONTRACT_GUIDE.md) - Contract architecture
- [API Documentation](../src/index.ts) - All API endpoints

---

## Support

For questions or issues:
- GitHub Issues: [abraham-api/issues](https://github.com/your-org/abraham-api/issues)
- Smart Contract: [contracts/TheSeeds.sol](../contracts/TheSeeds.sol)
- Backend Service: [commandmentService.ts](../src/services/commandmentService.ts)
