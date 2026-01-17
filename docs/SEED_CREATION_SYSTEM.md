# Seed Creation System

## Overview

The Seed Creation System allows authorized creators to submit artwork proposals (Seeds) to the blockchain with proper access control and two submission modes: backend-signed (gasless) and client-signed.

## Architecture

### Contract Layer (AbrahamSeeds.sol)

**Features:**
- `CREATOR_ROLE` - Role-based access control for seed creation
- `onlyRole(CREATOR_ROLE)` modifier on `submitSeed()` function
- `addCreator()` / `removeCreator()` admin functions

**Key Functions:**
```solidity
// Only addresses with CREATOR_ROLE can call this
function submitSeed(string calldata ipfsHash)
    external
    whenNotPaused
    onlyRole(CREATOR_ROLE)
    returns (uint256)

// Admin functions
function addCreator(address creator) external onlyRole(DEFAULT_ADMIN_ROLE)
function removeCreator(address creator) external onlyRole(DEFAULT_ADMIN_ROLE)
```

### Service Layer (contractService.ts)

**Methods:**
```typescript
// Check if address has CREATOR_ROLE
async hasCreatorRole(address: Address): Promise<boolean>

// Submit seed (backend-signed)
async submitSeed(ipfsHash: string): Promise<{ seedId, txHash }>

// Prepare transaction for client-side signing
prepareSeedSubmissionTransaction(ipfsHash: string, creatorAddress: Address)

// Admin: Grant/revoke CREATOR_ROLE
async addCreator(creatorAddress: Address)
async removeCreator(creatorAddress: Address)
```

### API Layer (src/routes/seeds.ts)

**Endpoints:**
- `POST /api/seeds` - Create seed (backend-signed, requires admin key)
- `POST /api/seeds/prepare` - Prepare transaction (client-signed)
- `GET /api/seeds/:seedId` - Get seed details with IPFS metadata
- `GET /api/seeds/count` - Get total seed count
- `GET /api/seeds/stats` - Get seed statistics
- `GET /api/seeds/config` - Get contract configuration
- `GET /api/seeds/creator/:address/check` - Check if address has CREATOR_ROLE

## Two Creation Modes

### 1. Backend-Signed (Gasless)

**Use Case**: Backend creates seeds on behalf of creators, paying gas fees

**Requirements:**
- Backend wallet must have `CREATOR_ROLE`
- Request must include `X-Admin-Key` header with valid admin key
- `ADMIN_KEY` and `RELAYER_PRIVATE_KEY` environment variables must be set

**Flow:**
```
Client → API (with admin key) → Backend signs → Blockchain
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/seeds \
  -H "Authorization: Bearer PRIVY_TOKEN" \
  -H "X-Admin-Key: secret-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"ipfsHash": "ipfs://QmX..."}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "seedId": 42,
    "txHash": "0x...",
    "blockExplorer": "https://sepolia.basescan.org/tx/0x..."
  }
}
```

### 2. Client-Signed

**Use Case**: Creators sign transactions with their own wallets

**Requirements:**
- Creator wallet must have `CREATOR_ROLE`
- User must sign transaction (e.g., via wagmi/viem)

**Flow:**
```
Client → API (get tx data) → Client signs → Blockchain
```

**Example:**
```typescript
// 1. Get transaction data from API
const response = await fetch('/api/seeds/prepare', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${privyToken}`
  },
  body: JSON.stringify({ ipfsHash: 'ipfs://QmX...' })
});

const { data } = await response.json();

// 2. Check if user has CREATOR_ROLE
if (!data.hasCreatorRole) {
  alert('You need CREATOR_ROLE to create seeds. Contact an admin.');
  return;
}

// 3. Sign and send transaction with user's wallet
const hash = await walletClient.sendTransaction({
  to: data.transaction.to,
  data: data.transaction.data
});

// 4. Wait for confirmation
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log('Seed created in block:', receipt.blockNumber);
```

## Granting CREATOR_ROLE

### Using NPM Script

```bash
npm run grant-creator:base-sepolia -- --address 0xNewCreatorAddress
```

### Using Hardhat Console

```bash
npx hardhat console --network baseSepolia
```

```javascript
const contract = await ethers.getContractAt(
  "AbrahamSeeds",
  "0x0b95d25463b7a937b3df28368456f2c40e95c730"
);

// Grant CREATOR_ROLE
await contract.addCreator("0xNewCreatorAddress");

// Verify the role was granted
const CREATOR_ROLE = await contract.CREATOR_ROLE();
const hasRole = await contract.hasRole(CREATOR_ROLE, "0xNewCreatorAddress");
console.log("Has CREATOR_ROLE:", hasRole);
```

### Using Viem

```typescript
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(`0x${ADMIN_PRIVATE_KEY}`);
const client = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL)
});

// Grant CREATOR_ROLE
const hash = await client.writeContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'addCreator',
  args: ['0xNewCreatorAddress']
});

await publicClient.waitForTransactionReceipt({ hash });
console.log('CREATOR_ROLE granted!');
```

## IPFS Metadata Format

Seeds store an IPFS hash pointing to JSON metadata:

```json
{
  "name": "Seed Title",
  "description": "Description of the artwork proposal",
  "image": "ipfs://QmImageHash...",
  "attributes": [
    {
      "trait_type": "Style",
      "value": "Abstract"
    }
  ]
}
```

## API Response Examples

### GET /api/seeds/:seedId

```json
{
  "success": true,
  "data": {
    "id": 42,
    "creator": "0x...",
    "ipfsHash": "ipfs://Qm...",
    "blessings": 10,
    "score": 316227,
    "commandmentCount": 3,
    "createdAt": 1699564800,
    "submittedInRound": 5,
    "creationRound": 0,
    "isRetracted": false
  }
}
```

### GET /api/seeds/count

```json
{
  "success": true,
  "data": {
    "count": 100
  }
}
```

### GET /api/seeds/stats

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

### GET /api/seeds/config

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

## Error Handling

### Common Errors

**401 - Invalid Admin Key**
```json
{
  "success": false,
  "error": "Unauthorized - Invalid admin key"
}
```

**403 - No CREATOR_ROLE**
```json
{
  "success": false,
  "error": "Relayer does not have CREATOR_ROLE"
}
```

**503 - Backend Not Configured**
```json
{
  "success": false,
  "error": "Backend seed creation service not configured",
  "message": "RELAYER_PRIVATE_KEY not set - use /seeds/prepare endpoint"
}
```

## Security Considerations

1. **Role-Based Access**: Only wallets with `CREATOR_ROLE` can submit seeds
2. **Admin Key Protection**: Backend-signed mode requires secret admin key
3. **Input Validation**: IPFS hash format validated before submission
4. **Rate Limiting**: Consider implementing rate limiting for seed creation
5. **Wallet Separation**: Use separate wallets for admin and relayer roles

## See Also

- [Blessing System](./BLESSING_SYSTEM.md) - Voting on seeds
- [API Reference](./API_REFERENCE.md) - Full API documentation
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Contract deployment
