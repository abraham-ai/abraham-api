# Seed Creation System

## Overview

The Seed Creation System allows authorized creators to submit artwork proposals (Seeds) to the blockchain with proper access control and two submission modes: backend-signed (gasless) and client-signed.

## Architecture

### Contract Layer (TheSeeds.sol)

**New Features Added:**
- ✅ `CREATOR_ROLE` - Role-based access control for seed creation
- ✅ `onlyRole(CREATOR_ROLE)` modifier on `submitSeed()` function
- ✅ `addCreator()` / `removeCreator()` admin functions
- ✅ `CreatorAdded` / `CreatorRemoved` events

**Key Functions:**
```solidity
// Only addresses with CREATOR_ROLE can call this
function submitSeed(
    string memory _ipfsHash,
    string memory _title,
    string memory _description
) external whenNotPaused onlyRole(CREATOR_ROLE) returns (uint256)

// Admin functions
function addCreator(address _creator) external onlyRole(ADMIN_ROLE)
function removeCreator(address _creator) external onlyRole(ADMIN_ROLE)
```

### Service Layer (contractService.ts)

**New Methods:**
```typescript
// Check if address has CREATOR_ROLE
async hasCreatorRole(address: Address): Promise<boolean>

// Submit seed (backend-signed)
async submitSeed(ipfsHash: string, title: string, description: string)

// Prepare transaction for client-side signing
prepareSeedSubmissionTransaction(ipfsHash, title, description, creatorAddress)

// Admin: Grant/revoke CREATOR_ROLE
async addCreator(creatorAddress: Address)
async removeCreator(creatorAddress: Address)
```

### API Layer (src/routes/seeds.ts)

**Endpoints:**
- `POST /api/seeds` - Create seed (backend-signed, requires admin key)
- `POST /api/seeds/prepare` - Prepare transaction (client-signed)
- `GET /api/seeds/:seedId` - Get seed details
- `GET /api/seeds/count` - Get total seed count
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
  -d '{"ipfsHash": "QmX...", "title": "My Seed"}'
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
// 1. Get transaction data
const { transaction } = await fetch('/api/seeds/prepare', {...});

// 2. Sign with user's wallet
const hash = await walletClient.sendTransaction(transaction);
```

## Security Features

### Access Control
- ✅ Only `CREATOR_ROLE` holders can create seeds
- ✅ Only `ADMIN_ROLE` holders can grant/revoke `CREATOR_ROLE`
- ✅ Backend endpoint requires admin key authentication
- ✅ Contract uses OpenZeppelin AccessControl pattern

### Authorization Flow
```
1. Admin deploys contract (gets ADMIN_ROLE)
2. Admin grants CREATOR_ROLE to authorized wallets
   - Via addCreator() function
   - Backend wallet + creator wallets
3. Creators can now submit seeds
   - Either via backend (with admin key)
   - Or directly from their wallet
```

## Granting CREATOR_ROLE

### Option 1: Hardhat Console
```bash
npx hardhat console --network baseSepolia
```

```javascript
const TheSeeds = await ethers.getContractAt("TheSeeds", CONTRACT_ADDRESS);
await TheSeeds.addCreator("0xCREATOR_ADDRESS");

// Verify
const CREATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("CREATOR_ROLE"));
await TheSeeds.hasRole(CREATOR_ROLE, "0xCREATOR_ADDRESS"); // true
```

### Option 2: Cast (Foundry)
```bash
cast send CONTRACT_ADDRESS \
  "addCreator(address)" \
  0xCREATOR_ADDRESS \
  --rpc-url https://sepolia.base.org \
  --private-key ADMIN_PRIVATE_KEY
```

### Option 3: API (if backend has ADMIN_ROLE)
```typescript
await contractService.addCreator("0xCREATOR_ADDRESS");
```

## Environment Variables

Add to `.env.local`:

```bash
# Contract Configuration
CONTRACT_ADDRESS=0x878baad70577cf114a3c60fd01b5a036fd0c4bc8
NETWORK=baseSepolia  # or "base" for mainnet

# Backend Wallet (must have CREATOR_ROLE)
RELAYER_PRIVATE_KEY=0x...

# Admin Authentication
ADMIN_KEY=your-secret-admin-key

# RPC URLs
BASE_SEPOLIA_RPC=https://sepolia.base.org
BASE_MAINNET_RPC=https://mainnet.base.org
```

## Integration Example

### React Component with wagmi

```typescript
import { useWalletClient } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';

function CreateSeedForm() {
  const { getAccessToken } = usePrivy();
  const { data: walletClient } = useWalletClient();
  const [mode, setMode] = useState<'backend' | 'client'>('client');

  async function createSeed(ipfsHash: string, title: string, description: string) {
    const token = await getAccessToken();

    if (mode === 'backend') {
      // Backend-signed (gasless)
      const response = await fetch('/api/seeds', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Admin-Key': adminKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ipfsHash, title, description })
      });

      const { data } = await response.json();
      console.log('Seed created:', data.seedId);
    } else {
      // Client-signed
      const response = await fetch('/api/seeds/prepare', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ipfsHash, title, description })
      });

      const { data } = await response.json();

      if (!data.hasCreatorRole) {
        alert('You need CREATOR_ROLE to create seeds');
        return;
      }

      const hash = await walletClient.sendTransaction({
        to: data.transaction.to,
        data: data.transaction.data,
      });

      console.log('Seed created:', hash);
    }
  }

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      createSeed(
        formData.get('ipfsHash'),
        formData.get('title'),
        formData.get('description')
      );
    }}>
      <input name="ipfsHash" placeholder="IPFS Hash" required />
      <input name="title" placeholder="Title" required />
      <textarea name="description" placeholder="Description" />

      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="client">Sign with my wallet</option>
        <option value="backend">Gasless (admin key required)</option>
      </select>

      <button type="submit">Create Seed</button>
    </form>
  );
}
```

## Testing

### 1. Check if address has CREATOR_ROLE
```bash
curl http://localhost:3000/api/seeds/creator/0xYOUR_ADDRESS/check
```

### 2. Create seed (backend-signed)
```bash
curl -X POST http://localhost:3000/api/seeds \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "ipfsHash": "QmTest123",
    "title": "Test Seed",
    "description": "Testing seed creation"
  }'
```

### 3. Get seed details
```bash
curl http://localhost:3000/api/seeds/0
```

### 4. Get total seed count
```bash
curl http://localhost:3000/api/seeds/count
```

## Troubleshooting

### "Relayer does not have CREATOR_ROLE"
**Solution**: Grant CREATOR_ROLE to your backend wallet
```bash
npx hardhat console --network baseSepolia
const TheSeeds = await ethers.getContractAt("TheSeeds", CONTRACT_ADDRESS);
await TheSeeds.addCreator(BACKEND_WALLET_ADDRESS);
```

### "Unauthorized - Invalid admin key"
**Solution**: Check that `X-Admin-Key` header matches `ADMIN_KEY` in `.env.local`

### "You don't have CREATOR_ROLE"
**Solution**: Get CREATOR_ROLE granted to your wallet by an admin

### Transaction fails with "AccessControl: account is missing role"
**Solution**: Ensure the signer has CREATOR_ROLE on the contract

## Next Steps

1. **Deploy to Production**: Update `CONTRACT_ADDRESS` and `NETWORK` for Base Mainnet
2. **Add Batch Creation**: Create multiple seeds in one transaction
3. **Add IPFS Integration**: Auto-upload artwork to IPFS
4. **Add Curation**: Implement seed approval workflow before going onchain
5. **Add Analytics**: Track seed creation metrics

## Related Documentation

- [Contract Source](../contracts/TheSeeds.sol)
- [API Reference](../README.md#seed-endpoints)
- [Blessing System](./BLESSING_SYSTEM.md)
