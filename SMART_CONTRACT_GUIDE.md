# Smart Contract Integration Guide

This guide covers deploying and integrating The Seeds governance contract with the Abraham API backend.

## Overview

**The Seeds** is an L2 (Base) governance contract that allows holders of Abraham's First Works NFTs to vote on daily artwork submissions. The winning artwork each day is selected for minting on L1.

### Key Features

- **Merkle Proof Voting**: Verify L1 NFT ownership on L2 without bridging assets
- **Daily Governance**: 24-hour voting periods with automatic winner selection
- **Decentralized Curation**: Community-driven artwork selection
- **Gas Efficient**: All voting happens on L2 (Base)

## Prerequisites

1. Node.js 18+ installed
2. Ethereum wallet with funds for deployment
3. RPC endpoints for Base (or Base Sepolia for testnet)
4. BaseScan API key for contract verification

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Update your `.env` file:

```bash
# Existing API variables
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_secret
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# New Smart Contract Variables
DEPLOYER_PRIVATE_KEY=your_deployer_private_key
OWNER_ADDRESS=your_owner_address
ROOT_UPDATER_ADDRESS=your_backend_wallet_address

# L2 RPC
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Block Explorer Keys
BASESCAN_API_KEY=your_basescan_api_key

# Deployed Contract Address (after deployment)
L2_SEEDS_CONTRACT=
```

## Deployment

### Step 1: Compile Contracts

```bash
npm run compile
```

### Step 2: Deploy to Testnet (Base Sepolia)

```bash
npm run deploy:base-sepolia
```

Save the deployed contract address!

### Step 3: Generate Merkle Tree

Generate a Merkle tree from the FirstWorks snapshot:

```bash
# First, generate or update the snapshot
npm run snapshot:generate

# Then generate the Merkle tree
npm run merkle:generate
```

This creates `lib/snapshots/firstWorks_merkle.json` with:
- `root`: Merkle root hash
- `proofs`: Merkle proofs for each holder
- `leaves`: Leaf hashes for each holder

### Step 4: Update Merkle Root on Contract

```bash
npm run update-root -- --network baseSepolia
```

### Step 5: Verify Contract

```bash
npx hardhat verify --network baseSepolia <CONTRACT_ADDRESS> <OWNER_ADDRESS>
```

## API Integration

### 1. Add Seeds Routes

Create `src/routes/seeds.ts`:

```typescript
import { Hono } from 'hono';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const app = new Hono();

// Contract ABI (simplified)
const SEEDS_ABI = [
  "function submitSeed(string ipfsHash, string title, string description) returns (uint256)",
  "function voteForSeed(uint256 seedId, uint256[] tokenIds, bytes32[] proof)",
  "function getSeed(uint256 seedId) view returns (tuple)",
  "function getCurrentLeader() view returns (uint256, uint256)",
  "function getSeeds(uint256 start, uint256 count) view returns (tuple[])"
];

// Initialize contract
const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
const contract = new ethers.Contract(
  process.env.L2_SEEDS_CONTRACT!,
  SEEDS_ABI,
  provider
);

// Get all seeds
app.get('/seeds', async (c) => {
  try {
    const seeds = await contract.getSeeds(0, 100);
    return c.json({ success: true, data: seeds });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Get current leader
app.get('/seeds/leader', async (c) => {
  try {
    const [seedId, votes] = await contract.getCurrentLeader();
    return c.json({
      success: true,
      data: { seedId: Number(seedId), votes: Number(votes) }
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

// Get Merkle proof for voting
app.post('/seeds/proof', async (c) => {
  try {
    const { address, tokenIds } = await c.req.json();

    // Load Merkle tree
    const merkleData = JSON.parse(
      readFileSync('./lib/snapshots/firstWorks_merkle.json', 'utf-8')
    );

    const proof = merkleData.proofs[address.toLowerCase()];

    if (!proof) {
      return c.json({
        success: false,
        error: 'Address not found in snapshot'
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        proof,
        root: merkleData.root,
        tokenIds
      }
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

export default app;
```

### 2. Add to Main App

In `src/index.ts`:

```typescript
import seedsRoutes from './routes/seeds';

// ... existing code ...

app.route('/api/seeds', seedsRoutes);
```

## Frontend Integration

### Voting Flow

```typescript
import { ethers } from 'ethers';

async function voteForSeed(seedId: number) {
  // 1. Get user's wallet and token IDs
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  // Get user's FirstWorks tokens from API
  const response = await fetch('/api/blessings/firstworks/snapshot');
  const snapshot = await response.json();
  const tokenIds = snapshot.data.holderIndex[address.toLowerCase()] || [];

  if (tokenIds.length === 0) {
    throw new Error('No FirstWorks NFTs owned');
  }

  // 2. Get Merkle proof from API
  const proofResponse = await fetch('/api/seeds/proof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, tokenIds })
  });
  const { data: { proof } } = await proofResponse.json();

  // 3. Submit vote on-chain
  const contract = new ethers.Contract(
    process.env.NEXT_PUBLIC_SEEDS_CONTRACT!,
    SEEDS_ABI,
    signer
  );

  const tx = await contract.voteForSeed(seedId, tokenIds, proof);
  await tx.wait();

  console.log('Vote submitted!');
}
```

### Submit Seed Flow

```typescript
async function submitSeed(ipfsHash: string, title: string, description: string) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const contract = new ethers.Contract(
    process.env.NEXT_PUBLIC_SEEDS_CONTRACT!,
    SEEDS_ABI,
    signer
  );

  const tx = await contract.submitSeed(ipfsHash, title, description);
  const receipt = await tx.wait();

  // Parse event to get seed ID
  const event = receipt.logs.find((log: any) =>
    log.topics[0] === contract.interface.getEvent('SeedSubmitted').topicHash
  );

  const seedId = event ? contract.interface.parseLog(event)?.args.seedId : null;

  return seedId;
}
```

## Daily Operations

### Automated Merkle Root Update

Set up a daily cron job to update the Merkle root:

```typescript
// scripts/dailyUpdate.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function dailyUpdate() {
  console.log('Starting daily update...');

  // 1. Generate new snapshot
  await execAsync('npm run snapshot:generate');

  // 2. Generate new Merkle tree
  await execAsync('npm run merkle:generate');

  // 3. Update root on contract
  await execAsync('npm run update-root -- --network base');

  console.log('Daily update complete!');
}

dailyUpdate().catch(console.error);
```

Add to `package.json`:

```json
{
  "scripts": {
    "daily-update": "tsx scripts/dailyUpdate.ts"
  }
}
```

Set up cron (Linux/Mac):

```bash
crontab -e

# Add this line (runs daily at midnight UTC)
0 0 * * * cd /path/to/abraham-api && npm run daily-update >> /var/log/abraham-update.log 2>&1
```

### Select Daily Winner

Create a script to select winners:

```typescript
// scripts/selectWinner.ts
import { ethers } from 'ethers';

async function selectWinner() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY!, provider);

  const contract = new ethers.Contract(
    process.env.L2_SEEDS_CONTRACT!,
    SEEDS_ABI,
    wallet
  );

  console.log('Selecting daily winner...');

  try {
    const tx = await contract.selectDailyWinner();
    const receipt = await tx.wait();

    // Parse WinnerSelected event
    const event = receipt.logs.find((log: any) =>
      log.topics[0] === contract.interface.getEvent('WinnerSelected').topicHash
    );

    if (event) {
      const parsed = contract.interface.parseLog(event);
      console.log('Winner selected!');
      console.log('Seed ID:', parsed?.args.seedId.toString());
      console.log('Votes:', parsed?.args.votes.toString());
      console.log('IPFS Hash:', parsed?.args.ipfsHash);
    }

    return receipt;
  } catch (error: any) {
    if (error.message.includes('VotingPeriodNotEnded')) {
      console.log('Voting period has not ended yet');
    } else if (error.message.includes('NoValidWinner')) {
      console.log('No valid winner (no votes cast)');
    } else {
      throw error;
    }
  }
}

selectWinner().catch(console.error);
```

## Testing

### Test Merkle Proof Generation

```bash
npm run merkle:generate
```

Check `lib/snapshots/firstWorks_merkle.json` for:
- Valid Merkle root
- Proofs for all holders
- Verification test passes

### Test Contract Interactions

```typescript
// test/TheSeeds.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TheSeeds", function () {
  it("Should submit a seed", async function () {
    const [owner] = await ethers.getSigners();
    const TheSeeds = await ethers.getContractFactory("TheSeeds");
    const seeds = await TheSeeds.deploy(owner.address);

    await seeds.submitSeed(
      "QmTestHash",
      "Test Artwork",
      "A test description"
    );

    const seed = await seeds.getSeed(0);
    expect(seed.title).to.equal("Test Artwork");
  });
});
```

Run tests:

```bash
npm run test:contracts
```

## Monitoring

### Contract Events

Monitor key events:

```typescript
const contract = new ethers.Contract(address, abi, provider);

// Listen for new seeds
contract.on('SeedSubmitted', (seedId, creator, ipfsHash, title, timestamp) => {
  console.log('New seed submitted:', {
    seedId: seedId.toString(),
    creator,
    title
  });
});

// Listen for votes
contract.on('VoteCast', (voter, seedId, votePower, round, timestamp) => {
  console.log('Vote cast:', {
    voter,
    seedId: seedId.toString(),
    votePower: votePower.toString()
  });
});

// Listen for winners
contract.on('WinnerSelected', (round, seedId, ipfsHash, votes, proof) => {
  console.log('Winner selected:', {
    round: round.toString(),
    seedId: seedId.toString(),
    votes: votes.toString()
  });
});
```

## Security Considerations

1. **Private Keys**: Never commit private keys. Use environment variables.
2. **Merkle Root Updates**: Only owner can update. Protect owner key.
3. **Proof Verification**: Proofs are verified on-chain. Frontend cannot fake votes.
4. **Rate Limiting**: Add rate limiting to proof endpoint to prevent DoS.
5. **Snapshot Integrity**: Ensure snapshot generation is accurate and timely.

## Troubleshooting

### "Invalid Merkle Proof" Error

- Ensure Merkle root on contract matches generated tree
- Verify token IDs are correct
- Check that snapshot is recent

### "Voting Period Not Ended" Error

- Wait for 24 hours to pass since period start
- Check `getTimeUntilPeriodEnd()` for remaining time

### Gas Issues

- Increase gas limit if transactions fail
- Consider batching operations
- Use gas estimation before transactions

## Next Steps

1. **L1 Integration**: Deploy Abraham Covenant contract on Ethereum
2. **Bridge Setup**: Create relayer to bridge L2 decisions to L1
3. **Frontend UI**: Build voting interface
4. **Mobile App**: Enable mobile voting
5. **Analytics**: Track voting patterns and engagement

## Resources

- [Architecture Overview](./ARCHITECTURE.md)
- [Hardhat Documentation](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Base Documentation](https://docs.base.org/)
- [Ethers.js v6 Docs](https://docs.ethers.org/v6/)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review contract source code in `contracts/TheSeeds.sol`
3. Check deployment logs
4. Open an issue on GitHub
