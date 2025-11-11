# TheSeeds Blessing System

## Overview

TheSeeds contract now includes a secure blessing system that allows users to show support for Seeds (artwork proposals). The system supports both direct blessings and delegated blessings through trusted relayers (like your backend server).

## Key Features

### 1. **Direct Blessings**
Users can directly call the contract to bless seeds they support.

### 2. **Delegation System**
Users can approve delegates (e.g., backend server, smart wallets) to bless on their behalf. This enables:
- Gasless transactions through meta-transactions
- Backend-verified blessing submissions
- Smart wallet integration

### 3. **Relayer Role**
Backend servers can be assigned the `RELAYER_ROLE` to submit verified blessings on behalf of users without requiring individual user delegation.

## Architecture

### Roles

- **ADMIN_ROLE**: Admin functions (add/remove relayers, update Merkle root, pause/unpause)
- **RELAYER_ROLE**: Backend servers that can submit blessings on behalf of verified users

### Security Features

1. **Access Control**: Uses OpenZeppelin's `AccessControl` for role-based permissions
2. **Reentrancy Protection**: `ReentrancyGuard` on all state-changing functions
3. **Double-Blessing Prevention**: Tracks if a user has already blessed a seed
4. **Authorization Checks**: Validates that only authorized parties can submit delegated blessings

## Contract Functions

### User Functions

#### `blessSeed(uint256 _seedId)`
Directly bless a seed (user calls this themselves).

```solidity
function blessSeed(uint256 _seedId) external whenNotPaused nonReentrant
```

**Example:**
```javascript
await theSeedsContract.blessSeed(seedId);
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

#### `blessSeedFor(uint256 _seedId, address _blesser)`
Submit a blessing on behalf of a user (requires delegation or RELAYER_ROLE).

```solidity
function blessSeedFor(uint256 _seedId, address _blesser)
    external whenNotPaused nonReentrant
```

**Authorization:** Caller must either:
- Have been approved as a delegate by the blesser, OR
- Have the `RELAYER_ROLE`

**Example:**
```javascript
// Backend server submits blessing for user
await theSeedsContract.blessSeedFor(seedId, userAddress);
```

#### `batchBlessSeedsFor(uint256[] _seedIds, address[] _blessers)`
Batch submit multiple blessings (only for RELAYER_ROLE).

```solidity
function batchBlessSeedsFor(
    uint256[] calldata _seedIds,
    address[] calldata _blessers
) external whenNotPaused nonReentrant onlyRole(RELAYER_ROLE)
```

**Example:**
```javascript
// Batch process verified blessings
await theSeedsContract.batchBlessSeedsFor(
    [seedId1, seedId2, seedId3],
    [user1, user2, user3]
);
```

### Admin Functions

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

#### `hasBlessed(address _user, uint256 _seedId)`
Check if a user has blessed a specific seed.

```solidity
function hasBlessed(address _user, uint256 _seedId)
    external view returns (bool)
```

#### `isDelegate(address _user, address _delegate)`
Check if an address is an approved delegate for a user.

```solidity
function isDelegate(address _user, address _delegate)
    external view returns (bool)
```

#### `getTotalBlessings()`
Get total number of blessings in the system.

```solidity
function getTotalBlessings() external view returns (uint256)
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

### Seed Struct (Updated)

```solidity
struct Seed {
    uint256 id;
    address creator;
    string ipfsHash;
    string title;
    string description;
    uint256 votes;
    uint256 blessings;      // NEW: Total blessings received
    uint256 createdAt;
    bool minted;
    uint256 mintedInRound;
}
```

## Events

### `DelegateApproval`
```solidity
event DelegateApproval(
    address indexed user,
    address indexed delegate,
    bool approved
);
```

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

### `RelayerAdded` / `RelayerRemoved`
```solidity
event RelayerAdded(address indexed relayer, address indexed addedBy);
event RelayerRemoved(address indexed relayer, address indexed removedBy);
```

## Backend Integration

### Setup

1. **Deploy the contract** with admin address:
```javascript
const theSeeds = await deploy("TheSeeds", [adminAddress]);
```

2. **Add backend server as relayer:**
```javascript
await theSeeds.addRelayer(backendServerAddress);
```

### Blessing Flow

#### Option 1: User Delegates to Backend (Recommended)

**Frontend:**
```javascript
// User approves backend as delegate (one-time)
await theSeedsContract.approveDelegate(BACKEND_ADDRESS, true);
```

**Backend API Endpoint (`/api/seeds/bless`):**
```typescript
app.post('/api/seeds/bless', async (req, res) => {
  const { seedId } = req.body;
  const user = req.user; // From authentication middleware

  // 1. Verify user eligibility (Privy authentication, rate limiting, etc.)
  if (!await isUserEligible(user)) {
    return res.status(403).json({ error: 'Not eligible' });
  }

  // 2. Check if user already blessed this seed
  const hasBlessed = await contract.hasBlessed(user.address, seedId);
  if (hasBlessed) {
    return res.status(400).json({ error: 'Already blessed' });
  }

  // 3. Check if backend is approved delegate
  const isApproved = await contract.isDelegate(user.address, BACKEND_WALLET_ADDRESS);
  if (!isApproved) {
    return res.status(400).json({
      error: 'Backend not approved as delegate',
      action: 'APPROVE_DELEGATE_REQUIRED'
    });
  }

  // 4. Submit blessing on behalf of user
  const tx = await contract.blessSeedFor(seedId, user.address);
  await tx.wait();

  res.json({
    success: true,
    txHash: tx.hash,
    blessingCount: (await contract.getSeed(seedId)).blessings
  });
});
```

#### Option 2: Backend as Trusted Relayer (No delegation needed)

If backend has `RELAYER_ROLE`, it can submit blessings without user delegation:

```typescript
// Backend automatically has authority via RELAYER_ROLE
const tx = await contract.blessSeedFor(seedId, user.address);
```

#### Option 3: Batch Processing

```typescript
// Process multiple verified blessings in one transaction
const blessings = await getVerifiedBlessingsQueue();

const tx = await contract.batchBlessSeedsFor(
  blessings.map(b => b.seedId),
  blessings.map(b => b.userAddress)
);
```

### User Experience Flows

#### Flow 1: First-Time User (With Delegation)
1. User clicks "Bless" on frontend
2. Frontend checks if backend is approved delegate
3. If not approved, prompt user to approve (one transaction)
4. User approves backend as delegate
5. Backend API call submits blessing
6. UI updates showing blessing confirmed

#### Flow 2: Returning User (Already Delegated)
1. User clicks "Bless" on frontend
2. API call to backend `/api/seeds/bless`
3. Backend submits blessing on-chain
4. UI updates immediately (gasless for user)

#### Flow 3: Direct On-Chain (No Backend)
1. User clicks "Bless" on frontend
2. Frontend calls `contract.blessSeed(seedId)` directly
3. User signs transaction in wallet
4. UI updates after confirmation

## Security Considerations

### ✅ Implemented Protections

1. **Role-Based Access Control**: Only authorized relayers can submit delegated blessings
2. **Reentrancy Guards**: All state-changing functions protected
3. **Double-Blessing Prevention**: Users can only bless each seed once
4. **Authorization Validation**: Strict checks on who can bless for whom
5. **Event Emissions**: All actions emit events for transparency and tracking

### 🔒 Best Practices

1. **Backend Verification**: Always verify user eligibility off-chain before submitting
2. **Rate Limiting**: Implement rate limits in backend API
3. **Nonce Management**: Ensure backend wallet has proper nonce handling for batch operations
4. **Key Management**: Secure backend private key (use AWS KMS, Azure Key Vault, etc.)
5. **Monitoring**: Monitor `BlessingSubmitted` events for anomalies
6. **User Consent**: Always get user consent before blessing on their behalf

### ⚠️ Important Notes

- **Delegation is Powerful**: Users trust delegates with their blessing rights
- **Relayer Role is Privileged**: RELAYER_ROLE can bless for ANY user (use with extreme caution)
- **One Blessing Per Seed**: Users cannot bless the same seed twice (intentional design)
- **Blessings are Permanent**: Once blessed, it cannot be undone (consider adding unbless if needed)

## Testing

### Test Scenarios

1. **Direct Blessing**
   - User directly calls `blessSeed`
   - Verify blessing count increases
   - Verify user cannot bless again

2. **Delegated Blessing**
   - User approves delegate
   - Delegate calls `blessSeedFor`
   - Verify blessing attributed to user, not delegate

3. **Relayer Blessing**
   - Admin adds relayer
   - Relayer submits blessing without delegation
   - Verify blessing succeeds

4. **Unauthorized Blessing**
   - Non-delegate tries to call `blessSeedFor`
   - Verify transaction reverts

5. **Batch Blessing**
   - Relayer submits batch
   - Verify all blessings recorded correctly
   - Verify skips already-blessed seeds

## Migration from Old Contract

If you're upgrading from the previous contract version:

1. **Deploy new contract** with blessing functionality
2. **Update frontend** to handle new delegation flow
3. **Update backend** to use new blessing functions
4. **Add backend as relayer** using `addRelayer`
5. **Test thoroughly** on testnet before mainnet

## Example Frontend Integration

```typescript
// Check if user needs to approve delegate
const needsApproval = async (userAddress: string) => {
  const isApproved = await contract.isDelegate(
    userAddress,
    BACKEND_ADDRESS
  );
  return !isApproved;
};

// Approve backend as delegate
const approveBackend = async () => {
  const tx = await contract.approveDelegate(BACKEND_ADDRESS, true);
  await tx.wait();
};

// Bless via backend API
const blessSeed = async (seedId: number) => {
  // Check if approval needed
  if (await needsApproval(userAddress)) {
    await approveBackend();
  }

  // Call backend API
  const response = await fetch('/api/seeds/bless', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seedId })
  });

  return response.json();
};
```

## Questions?

For implementation help or security questions, review:
- OpenZeppelin AccessControl docs
- Solidity security best practices
- Meta-transaction patterns
