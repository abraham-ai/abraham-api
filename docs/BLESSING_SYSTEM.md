# TheSeeds Blessing System

## Overview

TheSeeds contract includes a secure blessing system with **on-chain eligibility enforcement**. Users can show support for Seeds (artwork proposals) based on their FirstWorks NFT ownership, with all eligibility rules verified directly by the smart contract.

## Key Features

### 1. **On-Chain Eligibility Verification**
- NFT ownership verified via Merkle proofs
- Daily blessing limits enforced by the contract
- No reliance on off-chain systems for eligibility

### 2. **FirstWorks NFT-Based Blessings**
- Own N NFTs = N blessings per day
- `BLESSINGS_PER_NFT = 1` (one blessing per NFT owned)
- Automatic 24-hour period resets (based on `block.timestamp / 1 days`)

### 3. **Delegation System**
Users can approve delegates (e.g., backend server, smart wallets) to bless on their behalf, enabling:
- Gasless transactions through meta-transactions
- Backend-verified blessing submissions
- Smart wallet integration

### 4. **Relayer Role**
Backend servers with `RELAYER_ROLE` can submit verified blessings on behalf of users without requiring individual user delegation.

## Architecture

### Roles

- **ADMIN_ROLE**: Admin functions (add/remove relayers/creators, update Merkle root, pause/unpause)
- **RELAYER_ROLE**: Backend servers that can submit blessings on behalf of verified users
- **CREATOR_ROLE**: Authorized addresses that can submit seeds

### Security Features

1. **On-Chain NFT Verification**: Merkle proofs verify FirstWorks ownership on-chain
2. **Daily Blessing Limits**: Contract enforces N blessings per day (N = NFTs owned)
3. **Access Control**: Uses OpenZeppelin's `AccessControl` for role-based permissions
4. **Reentrancy Protection**: `ReentrancyGuard` on all state-changing functions
5. **Multiple Blessings Allowed**: Users can bless the same seed multiple times (subject to daily limits)
6. **Authorization Checks**: Validates that only authorized parties can submit delegated blessings

## Contract Functions

### User Functions

#### `blessSeed(uint256 _seedId, uint256[] _tokenIds, bytes32[] _merkleProof)`
Directly bless a seed with NFT ownership proof.

```solidity
function blessSeed(
    uint256 _seedId,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external whenNotPaused nonReentrant
```

**Requirements:**
- Must own FirstWorks NFTs (verified via Merkle proof)
- Must not have reached daily blessing limit

**Example:**
```javascript
// User owns token IDs [42, 123, 456]
const tokenIds = [42, 123, 456];
const merkleProof = getMerkleProof(userAddress, tokenIds);

await theSeedsContract.blessSeed(seedId, tokenIds, merkleProof);
```

#### `approveDelegate(address _delegate, bool _approved)`
Approve or revoke a delegate's permission to bless on your behalf.

```solidity
function approveDelegate(address _delegate, bool _approved) external
```

**Example:**
```javascript
// Approve backend server as delegate
await theSeedsContract.approveDelegate(backendServerAddress, true);

// Revoke delegate
await theSeedsContract.approveDelegate(backendServerAddress, false);
```

### Relayer Functions

#### `blessSeedFor(uint256 _seedId, address _blesser, uint256[] _tokenIds, bytes32[] _merkleProof)`
Submit a blessing on behalf of a user with NFT proof verification.

```solidity
function blessSeedFor(
    uint256 _seedId,
    address _blesser,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external whenNotPaused nonReentrant
```

**Authorization:** Caller must either:
- Have been approved as a delegate by the blesser, OR
- Have the `RELAYER_ROLE`

**On-Chain Checks:**
- Verifies NFT ownership via Merkle proof
- Checks daily blessing limit (N NFTs = N blessings/day)

**Example:**
```javascript
// Backend server submits blessing for user
const tokenIds = getUserTokenIds(userAddress);
const merkleProof = getMerkleProof(userAddress, tokenIds);

await theSeedsContract.blessSeedFor(
    seedId,
    userAddress,
    tokenIds,
    merkleProof
);
```

#### `batchBlessSeedsFor(uint256[] _seedIds, address[] _blessers, uint256[][] _tokenIdsArray, bytes32[][] _merkleProofs)`
Batch submit multiple blessings with NFT proof verification.

```solidity
function batchBlessSeedsFor(
    uint256[] calldata _seedIds,
    address[] calldata _blessers,
    uint256[][] calldata _tokenIdsArray,
    bytes32[][] calldata _merkleProofs
) external whenNotPaused nonReentrant onlyRole(RELAYER_ROLE)
```

**Example:**
```javascript
await theSeedsContract.batchBlessSeedsFor(
    [seedId1, seedId2, seedId3],
    [user1, user2, user3],
    [tokenIds1, tokenIds2, tokenIds3],
    [proof1, proof2, proof3]
);
```

### Admin Functions

#### `updateOwnershipRoot(bytes32 _newRoot)`
Update the Merkle root for FirstWorks NFT ownership verification.

```solidity
function updateOwnershipRoot(bytes32 _newRoot) external onlyRole(ADMIN_ROLE)
```

**When to use:** After generating a new FirstWorks snapshot and Merkle tree.

#### `addRelayer(address _relayer)`
Add a relayer (backend server).

```solidity
function addRelayer(address _relayer) external onlyRole(ADMIN_ROLE)
```

#### `removeRelayer(address _relayer)`
Remove a relayer.

```solidity
function removeRelayer(address _relayer) external onlyRole(ADMIN_ROLE)
```

### View Functions

#### `getUserDailyBlessingCount(address _user)`
Get number of blessings a user has used today.

```solidity
function getUserDailyBlessingCount(address _user)
    external view returns (uint256)
```

#### `getRemainingBlessings(address _user, uint256 _nftCount)`
Calculate remaining blessings for today based on NFT count.

```solidity
function getRemainingBlessings(address _user, uint256 _nftCount)
    external view returns (uint256)
```

#### `canBlessToday(address _user, uint256 _nftCount)`
Check if user has remaining blessings today.

```solidity
function canBlessToday(address _user, uint256 _nftCount)
    external view returns (bool)
```

#### `getSeedBlessings(uint256 _seedId)`
Get all blessings for a specific seed.

```solidity
function getSeedBlessings(uint256 _seedId)
    external view returns (Blessing[] memory)
```

#### `getUserBlessings(address _user)`
Get all blessings given by a specific user.

```solidity
function getUserBlessings(address _user)
    external view returns (Blessing[] memory)
```

#### `getBlessingCount(address _user, uint256 _seedId)`
Get the number of times a user has blessed a specific seed.

```solidity
function getBlessingCount(address _user, uint256 _seedId)
    external view returns (uint256)
```

#### `hasBlessed(address _user, uint256 _seedId)` (Legacy)
Check if a user has blessed a specific seed at least once.

```solidity
function hasBlessed(address _user, uint256 _seedId)
    external view returns (bool)
```

**Note:** This function is deprecated. Use `getBlessingCount()` for accurate blessing counts. This returns `true` if the user has blessed the seed at least once.

#### `isDelegate(address _user, address _delegate)`
Check if an address is an approved delegate for a user.

```solidity
function isDelegate(address _user, address _delegate)
    external view returns (bool)
```

## Data Structures

### Blessing Struct

```solidity
struct Blessing {
    uint256 seedId;      // Seed being blessed
    address blesser;     // User who gave the blessing
    address actor;       // Account that executed the transaction
    uint256 timestamp;   // When the blessing was submitted
    bool isDelegated;    // True if submitted by delegate/relayer
}
```

### Seed Struct

```solidity
struct Seed {
    uint256 id;
    address creator;
    string ipfsHash;
    string title;
    string description;
    uint256 votes;
    uint256 blessings;      // Total blessings received
    uint256 createdAt;
    bool minted;
    uint256 mintedInRound;
}
```

## Events

### `BlessingSubmitted`
```solidity
event BlessingSubmitted(
    uint256 indexed seedId,
    address indexed blesser,
    address indexed actor,
    bool isDelegated,
    uint256 timestamp
);
```

### `DelegateApproval`
```solidity
event DelegateApproval(
    address indexed user,
    address indexed delegate,
    bool approved
);
```

### `OwnershipRootUpdated`
```solidity
event OwnershipRootUpdated(
    bytes32 indexed newRoot,
    uint256 timestamp,
    uint256 blockNumber
);
```

## Backend Integration

### Setup

1. **Generate FirstWorks Snapshot:**
```bash
npm run snapshot:generate
```

2. **Generate Merkle Tree:**
```bash
npm run merkle:generate
```

3. **Deploy Contract:**
```javascript
const theSeeds = await deploy("TheSeeds", [adminAddress]);
```

4. **Update Merkle Root:**
```bash
cast send $CONTRACT_ADDRESS "updateOwnershipRoot(bytes32)" $MERKLE_ROOT \
  --rpc-url $RPC_URL --private-key $ADMIN_KEY
```

5. **Add Backend as Relayer:**
```javascript
await theSeeds.addRelayer(backendServerAddress);
```

### Blessing Flow with On-Chain Verification

#### Backend API Implementation

```typescript
app.post('/api/blessings', async (req, res) => {
  const { seedId } = req.body;
  const user = req.user; // From auth middleware

  // 1. Get user's NFT token IDs from snapshot
  const snapshot = await loadSnapshot();
  const tokenIds = snapshot.holderIndex[user.address.toLowerCase()] || [];

  if (tokenIds.length === 0) {
    return res.status(403).json({ error: 'No NFTs owned' });
  }

  // 2. Get Merkle proof for user
  const merkleTree = await loadMerkleTree();
  const proof = merkleTree.proofs[user.address.toLowerCase()] || [];

  // 3. Check if backend is approved delegate
  const isApproved = await contract.isDelegate(
    user.address,
    BACKEND_WALLET_ADDRESS
  );

  if (!isApproved) {
    return res.status(400).json({
      error: 'Backend not approved as delegate',
      action: 'APPROVE_DELEGATE_REQUIRED'
    });
  }

  // 4. Submit blessing with NFT proof
  // Contract will verify ownership and daily limits on-chain
  // Users can bless the same seed multiple times (subject to daily limits)
  try {
    const tx = await contract.blessSeedFor(
      seedId,
      user.address,
      tokenIds,
      proof
    );
    await tx.wait();

    // Get updated blessing count for this seed
    const blessingCount = await contract.getBlessingCount(user.address, seedId);

    res.json({
      success: true,
      txHash: tx.hash,
      blessingCount: Number(blessingCount),
      remainingBlessings: await calculateRemainingBlessings(user.address)
    });
  } catch (error) {
    // Handle contract errors
    if (error.message.includes('DailyBlessingLimitReached')) {
      return res.status(429).json({ error: 'Daily blessing limit reached' });
    }
    if (error.message.includes('InvalidMerkleProof')) {
      return res.status(400).json({ error: 'Invalid NFT proof' });
    }
    throw error;
  }
});
```

### User Experience Flows

#### Flow 1: First-Time User (With Delegation)
1. User clicks "Bless" on frontend
2. Frontend checks if backend is approved delegate
3. If not approved, prompt user to approve (one transaction)
4. User approves backend as delegate
5. Backend API submits blessing with NFT proof
6. Contract verifies ownership and daily limits on-chain
7. UI updates showing blessing confirmed

#### Flow 2: Returning User (Already Delegated)
1. User clicks "Bless" on frontend
2. API call to backend `/api/blessings`
3. Backend fetches tokenIds and Merkle proof
4. Backend submits blessing with proof
5. Contract verifies eligibility on-chain
6. UI updates immediately (gasless for user)

#### Flow 3: Direct On-Chain (No Backend)
1. User clicks "Bless" on frontend
2. Frontend fetches user's tokenIds and proof from API
3. Frontend calls `contract.blessSeed(seedId, tokenIds, proof)` directly
4. User signs transaction in wallet
5. Contract verifies eligibility on-chain
6. UI updates after confirmation

## Eligibility Rules

### Daily Blessing Limits

- **Formula:** `maxBlessings = nftCount * BLESSINGS_PER_NFT`
- **Example:** Own 3 NFTs → 3 blessings per day
- **Reset:** Automatic at midnight UTC (based on `block.timestamp / 1 days`)
- **Tracking:** Contract maintains `userDailyBlessings[user][day]` mapping

### Multiple Blessings Per Seed

- Users can bless the same seed **multiple times** (subject to daily limits)
- Each blessing counts against the user's daily total
- Blessing count per user per seed tracked via `userSeedBlessingCount[user][seedId]` mapping
- Example: User with 3 NFTs can use all 3 daily blessings on one seed, or distribute across multiple seeds

### NFT Ownership Verification

- Verified via Merkle proofs against `currentOwnershipRoot`
- Admin must update root when FirstWorks ownership changes
- Invalid proofs are rejected on-chain

## Security Considerations

### ✅ On-Chain Security

1. **Trustless Verification**: NFT ownership verified on-chain via Merkle proofs
2. **Tamper-Proof Limits**: Daily limits enforced by contract, not API
3. **No API Bypass**: Even if API is compromised, contract enforces all rules
4. **Transparent Logic**: All eligibility rules are public and auditable
5. **Automatic Resets**: Time-based limits reset automatically via `block.timestamp`

### ✅ Contract Protections

1. **Role-Based Access Control**: Only authorized relayers can submit delegated blessings
2. **Reentrancy Guards**: All state-changing functions protected
3. **Daily Limit Tracking**: Per-day blessing limits enforced on-chain
4. **Authorization Validation**: Strict delegate/relayer checks

### 🔒 Best Practices

1. **Merkle Root Updates**: Keep FirstWorks snapshot up-to-date
2. **Rate Limiting**: Still implement API rate limits for DoS protection
3. **Key Management**: Secure backend private key (AWS KMS, Azure Key Vault, etc.)
4. **Monitoring**: Monitor `BlessingSubmitted` events for anomalies
5. **User Consent**: Always get user consent before blessing on their behalf

### ⚠️ Important Notes

- **Delegation is Powerful**: Users trust delegates with their blessing rights
- **Relayer Role is Privileged**: RELAYER_ROLE can bless for ANY user (with valid proof)
- **Multiple Blessings Allowed**: Users can bless the same seed multiple times within their daily limit
- **Merkle Root Currency**: Ensure root is updated when FirstWorks ownership changes

## Error Messages

### Contract Errors

- `InvalidMerkleProof`: NFT ownership proof is invalid
- `DailyBlessingLimitReached`: User has used all daily blessings
- `NoVotingPower`: User owns no NFTs (0 tokenIds provided)
- `NotAuthorized`: Caller not approved as delegate or relayer
- `SeedNotFound`: Seed does not exist
- `SeedAlreadyMinted`: Cannot bless minted seeds

## Testing

### Test Scenarios

1. **NFT Ownership Verification**
   - Valid proof → blessing succeeds
   - Invalid proof → transaction reverts
   - Zero NFTs → transaction reverts

2. **Daily Blessing Limits**
   - Own 3 NFTs → can bless 3 times per day (total across all seeds)
   - 4th blessing same day → reverts with `DailyBlessingLimitReached`
   - Next day → limit resets, can bless again
   - Can use all 3 blessings on one seed or distribute across multiple

3. **Multiple Blessings Per Seed**
   - Bless seed #1 once → succeeds (2 blessings remaining)
   - Bless seed #1 again → succeeds (1 blessing remaining)
   - Bless seed #1 third time → succeeds (0 blessings remaining)
   - Try to bless again → reverts with `DailyBlessingLimitReached`

4. **Delegation**
   - User approves delegate → delegate can bless
   - User revokes delegate → delegate cannot bless
   - Non-delegate tries → reverts

5. **Relayer Role**
   - Relayer with valid proof → succeeds
   - Relayer with invalid proof → reverts
   - Non-relayer tries `batchBlessSeedsFor` → reverts

## Migration Guide

### From Old System (API-Only Enforcement)

1. **Generate Merkle Tree:**
   ```bash
   npm run snapshot:generate
   npm run merkle:generate
   ```

2. **Deploy New Contract:**
   ```bash
   npx hardhat run scripts/deploy.ts --network baseSepolia
   ```

3. **Update Merkle Root:**
   ```bash
   cast send $CONTRACT "updateOwnershipRoot(bytes32)" $ROOT \
     --rpc-url $RPC --private-key $ADMIN_KEY
   ```

4. **Update Backend:**
   - Import `loadMerkleTree()` function
   - Fetch tokenIds and proof for users
   - Pass to `blessSeedFor()` function

5. **Update Frontend:**
   - Fetch tokenIds and proof from API
   - Pass to `blessSeed()` when user blesses directly

## Example Frontend Integration

```typescript
// Get user's NFT data and proof
const getUserNFTData = async (userAddress: string) => {
  const response = await fetch(`/api/users/${userAddress}/nft-data`);
  return response.json(); // { tokenIds, proof }
};

// Bless via backend API (gasless)
const blessSeedGasless = async (seedId: number) => {
  // Check if approval needed
  if (await needsApproval(userAddress)) {
    await approveBackend();
  }

  // Backend handles tokenIds and proof
  const response = await fetch('/api/blessings', {
    method: 'POST',
    body: JSON.stringify({ seedId })
  });

  return response.json();
};

// Bless directly on-chain (user pays gas)
const blessSeedDirect = async (seedId: number) => {
  const { tokenIds, proof } = await getUserNFTData(userAddress);

  const tx = await contract.blessSeed(seedId, tokenIds, proof);
  await tx.wait();

  return tx.hash;
};
```

## Questions?

For implementation help or security questions, review:
- OpenZeppelin AccessControl docs
- Merkle tree generation and verification
- Solidity security best practices
- Meta-transaction patterns
