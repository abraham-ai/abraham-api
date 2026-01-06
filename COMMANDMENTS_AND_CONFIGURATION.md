# Commandments & Configurable Scoring System

## Overview

This document covers the major features added to The Seeds contract in v2.0:
- **Commandments**: IPFS-based comments/discussion on seeds
- **Configurable Costs**: Dynamic pricing for blessings and commandments
- **Configurable Scoring**: Flexible point system with adjustable weights
- **Treasury Management**: Fee collection and withdrawal system

## Table of Contents
1. [Commandments System](#commandments-system)
2. [Configurable Costs](#configurable-costs)
3. [Configurable Scoring](#configurable-scoring)
4. [Treasury Management](#treasury-management)
5. [API Endpoints](#api-endpoints)
6. [Contract Optimizations](#contract-optimizations)

---

## Commandments System

### What are Commandments?

Commandments are **IPFS-based comments** on seeds, similar to how blessings are likes. They enable ongoing discussion and commentary on submitted seeds.

### Key Characteristics

**Eligibility:**
- ✅ Requires NFT ownership (same Merkle proof verification as blessings)
- ✅ Same delegation system as blessings (direct or via relayer)
- ✅ Daily limits per NFT (default: 1 commandment per NFT per day)

**No Time Restrictions:**
- ✅ Can comment on seeds **anytime** - even after voting period ends
- ✅ Can comment on seeds from **any round** - past or current
- ✅ Can comment on **winning seeds** (after they've been minted as NFTs)
- ✅ Only restriction: seed must exist

**Design Rationale:**
- Blessings = voting mechanism → restricted to voting period
- Commandments = discussion/comments → perpetual, like blog comments
- Enables ongoing conversation about winning seeds and historical works

### Smart Contract Functions

#### Direct Submission
```solidity
function commentOnSeed(
    uint256 _seedId,
    string memory _ipfsHash,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external payable
```

**Parameters:**
- `_seedId` - ID of the seed to comment on
- `_ipfsHash` - IPFS hash of the comment content
- `_tokenIds` - Array of FirstWorks NFT IDs owned by commenter
- `_merkleProof` - Merkle proof of NFT ownership

**Requirements:**
- Must pay `commandmentCost` (ETH) if > 0
- Must own NFTs and provide valid Merkle proof
- Must not exceed daily limit (NFT count × `commandmentsPerNFT`)

#### Delegated Submission (Gasless)
```solidity
function commentOnSeedFor(
    uint256 _seedId,
    address _commenter,
    string memory _ipfsHash,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external payable onlyRelayer
```

Used by backend API for gasless transactions. Same requirements as direct submission.

### Commandment Data Structure

```solidity
struct Commandment {
    uint256 id;           // Unique commandment ID
    uint256 seedId;       // Seed being commented on
    address commenter;    // Address of commenter
    string ipfsHash;      // IPFS hash of comment content
    uint256 createdAt;    // Timestamp
}
```

### Storage & Tracking

```solidity
mapping(uint256 => Commandment) public commandments;                    // ID → Commandment
mapping(uint256 => uint256[]) public seedCommandmentIds;                // Seed → Commandment IDs
mapping(uint256 => uint256) public commandmentCount;                    // Seed → Total count
mapping(address => mapping(uint256 => uint256)) public userDailyCommandments;  // User → Day → Count
```

### Events

```solidity
event CommandmentSubmitted(
    uint256 indexed commandmentId,
    uint256 indexed seedId,
    address indexed commenter,
    address actor,
    bool isDelegated,
    string ipfsHash,
    uint256 timestamp
);
```

**Indexed fields** (for efficient filtering):
- `commandmentId` - Filter by commandment
- `seedId` - Get all commandments for a seed
- `commenter` - Get all commandments by a user

---

## Configurable Costs

### Overview

Blessings and commandments can have configurable ETH costs. All fees are collected in the contract and withdrawable to the treasury.

### Cost Configuration

```solidity
uint256 public blessingCost;        // Current blessing cost (wei)
uint256 public commandmentCost;     // Current commandment cost (wei)
uint256 public nextBlessingCost;    // Pending blessing cost (applied at round end)
uint256 public nextCommandmentCost; // Pending commandment cost (applied at round end)
address public treasury;            // Fee recipient address
```

**Default Values:**
- Initial cost: `0 ETH` (free)
- Initial treasury: deployer address

### Admin Functions

#### Update Blessing Cost
```solidity
function updateBlessingCost(uint256 _newCost) external onlyRole(ADMIN_ROLE)
```

Sets the next blessing cost. Applied at the end of the current round to prevent mid-round manipulation.

#### Update Commandment Cost
```solidity
function updateCommandmentCost(uint256 _newCost) external onlyRole(ADMIN_ROLE)
```

Sets the next commandment cost. Applied at the end of the current round.

#### Update Treasury Address
```solidity
function updateTreasury(address _newTreasury) external onlyRole(ADMIN_ROLE)
```

Changes the fee recipient address. Applied immediately.

**Event:** `TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury)`

#### Withdraw Fees
```solidity
function withdrawFees() external onlyRole(ADMIN_ROLE)
```

Withdraws all collected fees to the treasury address.

**Requirements:**
- Treasury address must be set
- Contract must have a balance > 0

**Event:** `FeesWithdrawn(address indexed to, uint256 amount)`

### Deferred Application

Cost updates are **deferred** until the round ends to prevent:
- Mid-round price changes affecting ongoing votes
- Gaming the system by changing costs strategically

**Application trigger:** When `selectWinner()` is called, costs are updated via `_applyDeferredConfigUpdates()`

### Payment Handling

**Overpayment Protection:**
- Users can send more than required
- Excess is automatically refunded
- Example: If cost is 0.001 ETH and user sends 0.002 ETH, 0.001 ETH is refunded

**Code Example:**
```solidity
if (msg.value < commandmentCost) revert InsufficientPayment();

_processCommandment(...);

// Refund excess
if (msg.value > commandmentCost) {
    (bool success, ) = payable(msg.sender).call{value: msg.value - commandmentCost}("");
    require(success, "Refund failed");
}
```

---

## Configurable Scoring

### Overview

The scoring system is now fully configurable, allowing adjustment of:
- Blessing weight
- Commandment weight (currently 0 - commandments don't affect scores)
- Time decay parameters

### Scoring Configuration Structure

```solidity
struct ScoringConfig {
    uint256 blessingWeight;           // Multiplier for blessings (1000 = 1.0x)
    uint256 commandmentWeight;        // Multiplier for commandments (0 = disabled)
    uint256 timeDecayMin;             // Min time decay factor (default: 10)
    uint256 timeDecayBase;            // Base time decay (default: 1000)
    uint256 scaleFactorBlessings;     // Blessing scale factor (1e6)
    uint256 scaleFactorCommandments;  // Commandment scale factor (1e6)
}

ScoringConfig public scoringConfig;      // Current config
ScoringConfig public nextScoringConfig;  // Pending config
bool public pendingScoringUpdate;        // Flag for pending update
```

### Default Configuration

Set in constructor:
```solidity
scoringConfig = ScoringConfig({
    blessingWeight: 1000,              // 1.0x multiplier
    commandmentWeight: 0,              // Commandments don't affect score
    timeDecayMin: 10,                  // Quadratic decay minimum
    timeDecayBase: 1000,               // Decay base
    scaleFactorBlessings: 1e6,         // Scale factor
    scaleFactorCommandments: 1e6       // Scale factor (unused since weight=0)
});
```

### Admin Function

#### Update Scoring Config
```solidity
function updateScoringConfig(
    uint256 _blessingWeight,
    uint256 _commandmentWeight,
    uint256 _timeDecayMin,
    uint256 _timeDecayBase
) external onlyRole(ADMIN_ROLE)
```

**Parameters:**
- `_blessingWeight` - Multiplier for blessing scores (1000 = 1.0x, 500 = 0.5x, 2000 = 2.0x)
- `_commandmentWeight` - Multiplier for commandment scores (0 = disabled)
- `_timeDecayMin` - Minimum time decay factor
- `_timeDecayBase` - Base for time decay calculation

**Deferred Application:**
- Updates are applied at round end via `_applyDeferredConfigUpdates()`
- Prevents mid-round manipulation

**Event:** `ScoringConfigUpdated(blessingWeight, commandmentWeight, timeDecayMin, timeDecayBase)`

### Enabling Commandment Scoring

To enable commandments to affect seed scores in the future:

```bash
# Example: Set commandment weight to 0.5x (half the impact of blessings)
cast send $CONTRACT_ADDRESS "updateScoringConfig(uint256,uint256,uint256,uint256)" \
  1000 500 10 1000 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

This would make:
- Blessings = 1.0x weight
- Commandments = 0.5x weight
- Seeds would be scored by: `(blessings × 1.0) + (commandments × 0.5)`

---

## Treasury Management

### Fee Collection Flow

```
User Blesses/Comments (with payment)
         │
         ▼
   Contract Balance Increases
         │
         ▼
   Admin calls withdrawFees()
         │
         ▼
   Fees → Treasury Address
```

### Monitoring Contract Balance

```solidity
function getContractBalance() external view returns (uint256)
```

Returns current ETH balance held by the contract.

### Withdrawal Process

**Requirements:**
1. Caller must have `ADMIN_ROLE`
2. Treasury address must be set (non-zero)
3. Contract balance must be > 0

**Code:**
```bash
# Check balance
cast call $CONTRACT_ADDRESS "getContractBalance()" --rpc-url $RPC_URL

# Withdraw to treasury
cast send $CONTRACT_ADDRESS "withdrawFees()" \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

---

## API Endpoints

### Commandment Endpoints

#### Submit Commandment
```http
POST /api/commandments
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "seedId": 42,
  "message": "This seed is incredible! The composition really speaks to me."
}
```

**Response:**
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

#### Get Commandments by Seed
```http
GET /api/commandments/seed/:seedId
```

**Response:**
```json
{
  "success": true,
  "data": {
    "seedId": 42,
    "commandments": [
      {
        "id": 123,
        "seedId": 42,
        "commenter": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        "ipfsHash": "QmX7Y8Z9...",
        "createdAt": 1704067200,
        "metadata": {
          "type": "commandment",
          "message": "This seed is incredible!",
          "author": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
          "seedId": 42,
          "timestamp": 1704067200000
        }
      }
    ],
    "total": 1
  }
}
```

#### Get Commandments by User
```http
GET /api/commandments/user/:address
```

#### Get All Commandments
```http
GET /api/commandments/all
```

Returns all commandments across all seeds (paginated).

#### Check Commandment Eligibility
```http
GET /api/commandments/eligibility
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "canComment": true,
    "nftCount": 5,
    "remainingComments": 5,
    "dailyLimit": 5,
    "reason": "You can submit up to 5 commandments today"
  }
}
```

#### Get Commandment Stats
```http
GET /api/commandments/stats
Authorization: Bearer <JWT_TOKEN>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nftCount": 5,
    "commandmentsPerNFT": 1,
    "dailyLimit": 5,
    "used": 2,
    "remaining": 3
  }
}
```

### Admin Endpoints

#### Update Blessing Cost
```http
POST /api/admin/update-blessing-cost
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "costWei": "1000000000000000"  // 0.001 ETH
}
```

#### Update Commandment Cost
```http
POST /api/admin/update-commandment-cost
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "costWei": "1000000000000000"  // 0.001 ETH
}
```

#### Update Scoring Config
```http
POST /api/admin/update-scoring-config
X-Admin-Key: <ADMIN_KEY>
Content-Type: application/json

{
  "blessingWeight": 1000,
  "commandmentWeight": 500,
  "timeDecayMin": 10,
  "timeDecayBase": 1000
}
```

#### Withdraw Fees
```http
POST /api/admin/withdraw-fees
X-Admin-Key: <ADMIN_KEY>
```

---

## Contract Optimizations

### Size Optimization

The contract was optimized to fit within Ethereum's 24.5 KB contract size limit:

**Before Optimization:** 26,421 bytes (7.5% over limit)
**After Optimization:** 23,599 bytes (4.0% under limit)

### Removed View Functions

To reduce bytecode size, the following view functions were removed. The API now uses **event-based indexing** for better scalability:

#### Removed Functions:
1. **`getCommandmentsBySeed(uint256 seedId)`**
   - Replaced with: Filter `CommandmentSubmitted` events by `seedId`
   - API: `contractService.getCommandmentsBySeed()` now uses event filtering

2. **`getCurrentLeaders()`**
   - Replaced with: Calculate from seed data off-chain
   - API: `contractService.getCurrentLeaders()` builds leaders from all seeds

3. **`getSeedsByRound(uint256 round)`**
   - Replaced with: Filter `SeedSubmitted` events by round
   - API: `contractService.getSeedsByRound()` uses event filtering

4. **`getCurrentRoundSeeds()`**
   - Replaced with: Call `getSeedsByRound(currentRound)`
   - API: `contractService.getCurrentRoundSeeds()` delegates to event-based method

### Benefits of Event-Based Approach

**Advantages:**
- ✅ Smaller contract bytecode
- ✅ More gas efficient (no dynamic array construction on-chain)
- ✅ Better scalability (events indexed by RPC providers)
- ✅ Historical data accessible (events never deleted)
- ✅ Cheaper read operations

**Trade-offs:**
- ⚠️ API requires event indexing (already implemented)
- ⚠️ Slightly more complex API logic (handled transparently)

---

## Deployment Configuration

### Initial Setup

When deploying the contract, these values are set by default:

```typescript
// Commandments config
commandmentsPerNFT: 1              // 1 commandment per NFT per day

// Cost config
blessingCost: 0                     // Free
commandmentCost: 0                  // Free
treasury: deployer_address          // Fees go to deployer

// Scoring config
scoringConfig: {
  blessingWeight: 1000,             // 1.0x
  commandmentWeight: 0,             // Disabled
  timeDecayMin: 10,
  timeDecayBase: 1000,
  scaleFactorBlessings: 1000000,
  scaleFactorCommandments: 1000000
}
```

### Post-Deployment Configuration

#### Enable Paid Blessings (0.001 ETH example)
```bash
cast send $CONTRACT_ADDRESS "updateBlessingCost(uint256)" 1000000000000000 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

#### Enable Paid Commandments (0.001 ETH example)
```bash
cast send $CONTRACT_ADDRESS "updateCommandmentCost(uint256)" 1000000000000000 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

#### Enable Commandments in Scoring (0.5x weight example)
```bash
cast send $CONTRACT_ADDRESS "updateScoringConfig(uint256,uint256,uint256,uint256)" \
  1000 500 10 1000 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```
*Parameters: blessingWeight=1000, commandmentWeight=500, timeDecayMin=10, timeDecayBase=1000*

#### Increase Daily Limits (5 per NFT example)
```bash
cast send $CONTRACT_ADDRESS "updateBlessingsPerNFT(uint256)" 5 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

cast send $CONTRACT_ADDRESS "updateCommandmentsPerNFT(uint256)" 5 \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

#### Update Treasury Address
```bash
cast send $CONTRACT_ADDRESS "updateTreasury(address)" $TREASURY_ADDRESS \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

---

## Security Considerations

### Payment Security
- ✅ Reentrancy protection via `nonReentrant` modifier
- ✅ Overflow protection (Solidity 0.8+)
- ✅ Refund mechanism for overpayments
- ✅ Treasury withdrawal requires explicit admin action

### Access Control
- ✅ Role-based permissions (OpenZeppelin `AccessControl`)
- ✅ Admin-only configuration updates
- ✅ Relayer role for gasless transactions
- ✅ Delegate approval system

### Rate Limiting
- ✅ Daily limits per NFT prevent spam
- ✅ Separate pools for blessings and commandments
- ✅ Merkle proof verification prevents fake NFT claims

### Economic Security
- ✅ Deferred cost updates prevent mid-round manipulation
- ✅ Deferred scoring updates prevent gaming
- ✅ Treasury multisig recommended for production

---

## Future Enhancements

### Potential Features

1. **Negative Commandments (Downvotes)**
   - Add negative scoring for critical comments
   - Adjust `commandmentWeight` to negative value

2. **Reputation Multipliers**
   - Weight commandments by user reputation
   - Early supporters get higher weight

3. **Commandment Replies**
   - Nested commandment structure
   - Thread-based discussions

4. **Dynamic Cost Adjustment**
   - Automatic cost adjustment based on demand
   - Surge pricing during high activity

5. **Commandment NFTs**
   - Mint top commandments as NFTs
   - Reward insightful commentary

---

## Changelog

### v2.0.0 - Commandments & Configuration (2026-01-06)

**Added:**
- ✅ Commandments system (IPFS-based comments)
- ✅ Configurable blessing and commandment costs
- ✅ Configurable scoring system
- ✅ Treasury management and fee withdrawal
- ✅ 6 new API endpoints for commandments
- ✅ Admin endpoints for configuration management

**Optimized:**
- ✅ Contract size reduced from 26.4 KB to 23.6 KB
- ✅ Removed 4 view functions in favor of event indexing
- ✅ API now uses event-based data retrieval

**Security:**
- ✅ Deferred config updates prevent mid-round manipulation
- ✅ Overpayment refund mechanism
- ✅ Treasury withdrawal protection

---

## Support

For questions or issues:
- GitHub Issues: [abraham-api/issues](https://github.com/your-org/abraham-api/issues)
- Smart Contract: [contracts/TheSeeds.sol](./contracts/TheSeeds.sol)
- API Documentation: [src/index.ts](./src/index.ts) (see endpoint list)
