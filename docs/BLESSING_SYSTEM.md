# AbrahamSeeds Blessing System

## Overview

The AbrahamSeeds contract includes a secure blessing system with **on-chain eligibility enforcement**. Users can show support for Seeds (artwork proposals) based on their FirstWorks NFT ownership, with all eligibility rules verified directly by the smart contract using Merkle proofs.

## Key Features

### 1. **Cross-Chain NFT Verification**
- FirstWorks NFT ownership (L1 Ethereum) verified via Merkle proofs on L2 (Base)
- Daily snapshots capture current NFT ownership
- Proofs generated from Merkle tree of ownership data

### 2. **FirstWorks NFT-Based Blessings**
- Own N NFTs = N blessings per day (configurable)
- Default: `blessingsPerNFT = 1` (one blessing per NFT owned)
- Automatic period resets based on voting period configuration

### 3. **Quadratic (Square Root) Scoring**
- Prevents whale dominance: Score = √(user_blessings)
- 100 blessings = score 10, not 100
- Encourages broader participation over large holdings

### 4. **Delegation System**
Users can approve delegates (e.g., backend server) to bless on their behalf, enabling:
- Gasless transactions through backend relaying
- Better UX without wallet interaction
- Optional: users can still bless directly

### 5. **Operator Role**
Backend servers with `OPERATOR_ROLE` can submit verified blessings on behalf of users.

## Architecture

### Contract Hierarchy

```
AbrahamSeeds (ERC1155)
    └── EdenAgent (Base)
           ├── AccessControl (Roles)
           ├── Pausable
           └── ReentrancyGuard
    └── MerkleGating (Module)
           └── Merkle Proof Verification
```

### Roles

| Role | Description |
|------|-------------|
| `DEFAULT_ADMIN_ROLE` | Full admin control, grant/revoke roles |
| `OPERATOR_ROLE` | Submit blessings on behalf of users, select winners |
| `CREATOR_ROLE` | Submit seeds |

### Security Features

1. **Merkle Proof Verification**: NFT ownership verified on-chain via MerkleGating module
2. **Daily Blessing Limits**: Contract enforces N blessings per day (N = NFTs owned)
3. **Access Control**: OpenZeppelin's `AccessControl` for role-based permissions
4. **Reentrancy Protection**: `ReentrancyGuard` on all state-changing functions
5. **Authorization Checks**: Validates that only authorized parties can submit delegated blessings

## Contract Functions

### User Functions

#### `blessSeed(uint256 seedId, uint256[] tokenIds, bytes proof)`

Directly bless a seed with NFT ownership proof.

```solidity
function blessSeed(
    uint256 seedId,
    uint256[] calldata tokenIds,
    bytes calldata proof
) external payable
```

**Requirements:**
- Must own FirstWorks NFTs (verified via Merkle proof)
- Must not have reached daily blessing limit
- Seed must exist and not be winner/retracted

**Example:**
```typescript
import { encodeAbiParameters } from 'viem';

// User owns token IDs [42, 123, 456]
const tokenIds = [42n, 123n, 456n];
const merkleProof = ['0xabc...', '0xdef...']; // From API

// Encode proof for contract
const encodedProof = encodeAbiParameters(
  [{ type: 'bytes32[]' }],
  [merkleProof]
);

await walletClient.writeContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'blessSeed',
  args: [seedId, tokenIds, encodedProof]
});
```

#### `approveDelegate(address delegate, bool approved)`

Approve or revoke a delegate's permission to bless on your behalf.

```solidity
function approveDelegate(address delegate, bool approved) external
```

**Example:**
```typescript
// Approve backend server as delegate
await walletClient.writeContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'approveDelegate',
  args: [backendServerAddress, true]
});

// Revoke delegate
await walletClient.writeContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'approveDelegate',
  args: [backendServerAddress, false]
});
```

### Operator Functions

#### `blessSeedFor(uint256 seedId, address blesser, uint256[] tokenIds, bytes proof)`

Submit a blessing on behalf of a user with NFT proof verification.

```solidity
function blessSeedFor(
    uint256 seedId,
    address blesser,
    uint256[] calldata tokenIds,
    bytes calldata proof
) external payable
```

**Requirements:**
- Caller must have `OPERATOR_ROLE` OR be approved delegate for `blesser`
- User must own FirstWorks NFTs (verified via Merkle proof)
- User must not have reached daily blessing limit

**Example (Backend):**
```typescript
// Backend relayer blessing on behalf of user
await operatorWallet.writeContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'blessSeedFor',
  args: [seedId, userAddress, tokenIds, encodedProof]
});
```

### Query Functions

#### `getBlessingCount(address user, uint256 seedId)`

Get how many times a user has blessed a specific seed.

```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'getBlessingCount',
  args: [userAddress, seedId]
});
```

#### `getRemainingBlessings(address user, uint256 tokenCount)`

Get remaining blessings for a user today.

```typescript
const remaining = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'getRemainingBlessings',
  args: [userAddress, nftCount]
});
```

#### `canBlessToday(address user, uint256 tokenCount)`

Check if user can bless today.

```typescript
const canBless = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'canBlessToday',
  args: [userAddress, nftCount]
});
```

## Scoring System

### Quadratic (Square Root) Scoring

The blessing system uses square root scoring to prevent whale dominance:

```
User Score = √(user_blessing_count) × SCALE

SCALE = 1e6 (for precision)
```

### Score Calculation

For each blessing:
1. Get user's current blessing count for this seed
2. Calculate score delta: `√(n+1) - √(n)` (scaled)
3. Add delta to seed's total score

**Example:**
```
User has blessed seed 3 times, blesses again:
- Previous score contribution: √3 = 1.732
- New score contribution: √4 = 2.0
- Delta added: 2.0 - 1.732 = 0.268

Total Seed Score = Σ (√blessings_from_each_user)
```

### Why Square Root?

| Blessings | Linear Score | Sqrt Score |
|-----------|--------------|------------|
| 1 | 1 | 1.0 |
| 4 | 4 | 2.0 |
| 9 | 9 | 3.0 |
| 100 | 100 | 10.0 |
| 10000 | 10000 | 100.0 |

A whale with 10,000 NFTs blessing 10,000 times only gets score 100, not 10,000.

## API Endpoints

### Check Eligibility

```http
GET /api/blessings/eligibility
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

### Submit Blessing (Gasless)

```http
POST /api/blessings
Authorization: Bearer <privy_token>
Content-Type: application/json

{
  "seedId": 0
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "seedId": 0,
    "txHash": "0x...",
    "blessingCount": 42,
    "message": "Blessing submitted successfully"
  }
}
```

### Prepare Blessing Transaction (User-Signed)

```http
POST /api/blessings/prepare
Authorization: Bearer <privy_token>
Content-Type: application/json

{
  "seedId": 0
}
```

Returns transaction data for client-side signing.

### Check Delegation Status

```http
GET /api/blessings/delegation-status
Authorization: Bearer <privy_token>
```

### Prepare Delegation Transaction

```http
POST /api/blessings/prepare-delegate
Authorization: Bearer <privy_token>
Content-Type: application/json

{
  "approved": true
}
```

## Flow Diagrams

### Gasless Blessing Flow

```
User                    API                     Backend              Blockchain
 │                       │                        │                       │
 │ 1. POST /blessings    │                        │                       │
 ├──────────────────────>│                        │                       │
 │                       │ 2. Verify auth         │                       │
 │                       │ 3. Get Merkle proof    │                       │
 │                       │ 4. Check eligibility   │                       │
 │                       ├───────────────────────>│                       │
 │                       │                        │ 5. Sign tx            │
 │                       │                        ├──────────────────────>│
 │                       │                        │                       │
 │                       │                        │ 6. Tx confirmed       │
 │                       │                        │<──────────────────────┤
 │ 7. Return txHash      │                        │                       │
 │<──────────────────────┤                        │                       │
```

### User-Signed Blessing Flow

```
User                    API                     Blockchain
 │                       │                         │
 │ 1. POST /prepare      │                         │
 ├──────────────────────>│                         │
 │                       │ 2. Build tx data        │
 │ 3. Return tx          │                         │
 │<──────────────────────┤                         │
 │                       │                         │
 │ 4. Sign & send tx     │                         │
 ├────────────────────────────────────────────────>│
 │                       │                         │
 │                       │         5. Tx confirmed │
 │<────────────────────────────────────────────────┤
```

## Events

```solidity
event BlessingSubmitted(
    uint256 indexed seedId,
    address indexed blesser,
    uint256 score
);

event DelegateApproval(
    address indexed user,
    address indexed delegate,
    bool approved
);
```

## Configuration

### Voting Period

Duration of each blessing/voting period.

```typescript
// Default: 1 day (86400 seconds)
const period = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'votingPeriod'
});
```

### Blessings Per NFT

How many blessings each NFT grants per period.

```typescript
// Default: 1 blessing per NFT
const perNFT = await publicClient.readContract({
  address: SEEDS_CONTRACT,
  abi: abrahamSeedsABI,
  functionName: 'blessingsPerNFT'
});
```

## Updating Configuration (Admin Only)

```typescript
// Update via setConfig function
await adminWallet.writeContract({
  address: SEEDS_CONTRACT,
  abi: edenAgentABI,
  functionName: 'setConfig',
  args: [{
    periodDuration: 86400n,    // 1 day
    reactionsPerToken: 1n,     // 1 blessing per NFT
    messagesPerToken: 1n,      // 1 message per NFT
    editionPrice: 0n           // Free editions
  }]
});
```

## See Also

- [API Reference](./API_REFERENCE.md) - Full API documentation
- [Seeds Contract Reference](./SEEDS_CONTRACT_REFERENCE.md) - Contract function details
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Contract deployment
