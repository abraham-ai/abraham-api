# Abraham API - Quick Start Guide

## What We've Built

A complete NFT-based blessing system with:

1. **Privy Authentication Middleware** ([src/middleware/auth.ts](src/middleware/auth.ts))

   - Verifies Privy JWT tokens
   - Extracts wallet addresses from authenticated users

2. **NFT Snapshot Generator** ([lib/snapshots/firstWorksSnapshot.ts](lib/snapshots/firstWorksSnapshot.ts))

   - Fetches all FirstWorks NFT ownership data
   - Saves to `lib/snapshots/latest.json`
   - Should be run daily via cron

3. **Blessing Service** ([src/services/blessingService.ts](src/services/blessingService.ts))

   - Tracks blessings per user
   - Enforces: N NFTs = N blessings per 24 hours
   - Resets at midnight UTC daily

4. **Blessing API Routes** ([src/routes/blessings.ts](src/routes/blessings.ts))
   - `GET /api/blessings/eligibility` - Check if user can bless
   - `GET /api/blessings/stats` - Get user stats
   - `POST /api/blessings` - Perform a blessing
   - `POST /api/blessings/reload-snapshot` - Reload snapshot

## Next Steps

### 1. Set Up Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add:

```env
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret
CONTRACT_ADDRESS=0x8F814c7C75C5E9e0EDe0336F535604B1915C1985
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
```

### 2. Generate Initial NFT Snapshot

**IMPORTANT:** You must run this before starting the API:

```bash
npm run snapshot:generate
```

This will:

- Fetch all NFT ownership from the FirstWorks contract
- Save to `lib/snapshots/latest.json`
- Take a few minutes to complete

### 3. Start the Server

```bash
# Development mode with hot reload
npm run dev

# OR production mode
npm start
```

### 4. Test the API

```bash
# Health check (no auth required)
curl http://localhost:3000

# Check eligibility (requires Privy token)
curl http://localhost:3000/api/blessings/eligibility \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN"

# Perform a blessing (requires Privy token)
curl http://localhost:3000/api/blessings \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PRIVY_TOKEN" \
  -d '{"targetId": "post_123"}'

# Get all blessings (no auth required)
curl http://localhost:3000/api/blessings/all

# Get blessings for a specific target (no auth required)
curl http://localhost:3000/api/blessings/target/post_123

# Get blessings by a specific wallet (no auth required)
curl http://localhost:3000/api/blessings/wallet/0x1234...

# Get FirstWorks NFT snapshot (no auth required)
curl http://localhost:3000/api/blessings/firstworks/snapshot
```

## Client Integration Example

### React + Privy

```typescript
import { usePrivy } from "@privy-io/react-auth";

function BlessingButton({ targetId }: { targetId: string }) {
  const { getAccessToken } = usePrivy();

  async function handleBless() {
    const token = await getAccessToken();

    const response = await fetch("https://your-api.com/api/blessings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetId }),
    });

    const result = await response.json();

    if (result.success) {
      alert(`Blessed! ${result.data.remainingBlessings} remaining`);
    } else {
      alert(`Error: ${result.error}`);
    }
  }

  return <button onClick={handleBless}>Bless</button>;
}
```

## Important Configuration

### Change Blessings Per NFT

Edit [src/services/blessingService.ts:19](src/services/blessingService.ts#L19):

```typescript
const BLESSINGS_PER_NFT = 1; // Change this value
```

### Schedule Daily Snapshot Generation

Add to crontab (runs daily at 1 AM):

```bash
crontab -e
# Add this line:
0 1 * * * cd /path/to/abraham-api && npm run snapshot:generate
```

## Production Considerations

1. **Storage**: Currently uses in-memory storage. For production:

   - Use Redis for distributed caching
   - Use PostgreSQL/MongoDB for persistent storage

2. **Admin Authentication**: The `/reload-snapshot` endpoint should have admin auth

3. **Rate Limiting**: Add rate limiting middleware to prevent abuse

4. **CORS**: Update CORS settings in [src/index.ts:8-12](src/index.ts#L8-L12) to whitelist your domains

5. **Monitoring**: Add logging and error tracking (Sentry, DataDog, etc.)

## File Structure

```
abraham-api/
├── lib/
│   ├── abi/
│   │   └── firstWorks.ts              # NFT contract ABI
│   └── snapshots/
│       ├── firstWorksSnapshot.ts      # Snapshot generator
│       └── latest.json                # Generated snapshot (gitignored)
├── src/
│   ├── middleware/
│   │   └── auth.ts                    # Privy authentication
│   ├── routes/
│   │   └── blessings.ts               # Blessing endpoints
│   ├── services/
│   │   └── blessingService.ts         # Blessing logic
│   ├── index.ts                       # Hono app
│   └── server.ts                      # Server entry
├── .env.example                       # Environment template
├── .gitignore
├── package.json
├── README.md                          # Overview
├── SETUP.md                           # Detailed documentation
└── QUICKSTART.md                      # This file
```

## Troubleshooting

### "No snapshot found" Error

- Run `npm run snapshot:generate` first
- Verify RPC URL is correct in `.env`

### "Invalid authentication token" Error

- Check Privy credentials in `.env`
- Ensure client is sending valid Privy JWT

### "Wallet address not found" Error

- User needs to connect wallet in Privy first

## Need Help?

See [SETUP.md](./SETUP.md) for detailed documentation including:

- API endpoint specifications
- Deployment guides (Vercel, Docker)
- Advanced configuration options
- Client integration examples

---

## Smart Contract Development

This project now includes **The Seeds** - an L2 governance contract for decentralized artwork curation.

### Quick Start with Smart Contracts

1. **Compile contracts**:
   ```bash
   npm run compile
   ```

2. **Generate Merkle tree** (for voting proofs):
   ```bash
   npm run merkle:generate
   ```

3. **Deploy to Base Sepolia** (testnet):
   ```bash
   npm run deploy:base-sepolia
   ```

4. **Update Merkle root on contract**:
   ```bash
   npm run update-root -- --network baseSepolia
   ```

5. **Run contract tests**:
   ```bash
   npm run test:contracts
   ```

### What The Seeds Does

- **Seed Submission**: Artists submit artwork proposals (Seeds)
- **Voting**: FirstWorks NFT holders vote for Seeds
- **Daily Winner**: Highest voted Seed wins each day
- **L1 Minting**: Winner gets minted on Ethereum L1

### Resources

- [Smart Contract Guide](./SMART_CONTRACT_GUIDE.md) - Complete integration guide
- [Architecture Overview](./ARCHITECTURE.md) - System design and cross-chain flow
- [The Seeds Contract](./contracts/TheSeeds.sol) - Source code

---

**Ready to go!** Run `npm run snapshot:generate` then `npm run dev` to start.
