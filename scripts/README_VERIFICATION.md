# Contract Verification Guide

This guide explains how to verify TheSeeds contract on Basescan.

## Prerequisites

1. **Basescan API Key**: You need a Basescan API key to verify contracts
   - For Base Mainnet: Get key from https://basescan.org/myapikey
   - For Base Sepolia: Get key from https://sepolia.basescan.org/myapikey

2. **Add API key to .env.local**:
   ```
   BASESCAN_API_KEY=your_api_key_here
   ```

3. **Deployed Contract**: The contract must be deployed and the deployment info saved in `deployment-result.json`

## Usage

### Option 1: Verify using deployment info (Recommended)

This automatically reads the network from your deployment file:

```bash
npm run verify:seeds
```

### Option 2: Specify network explicitly

Verify on Base Sepolia:
```bash
npm run verify:seeds:base-sepolia
```

Verify on Base Mainnet:
```bash
npm run verify:seeds:base
```

## What the script does

1. Reads deployment information from `deployment-result.json`
2. Validates that you have a Basescan API key
3. Constructs the verification command with correct constructor arguments:
   - `_admin`: The deployer address
   - `_initialCreator`: The deployer address (same as admin)
4. Submits the contract source code to Basescan
5. Displays the verified contract URL

## Expected Output

```
=== TheSeeds Contract Verification Script ===

Using network from deployment-result.json: baseSepolia

Deployment Information:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Network:            Base Sepolia
Contract Address:   0x1234...5678
Deployer:           0xabcd...ef01
Block Explorer:     https://sepolia.basescan.org
Deployment Time:    2024-01-15T10:30:00.000Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Constructor Arguments:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_admin (address):           0xabcd...ef01
_initialCreator (address):  0xabcd...ef01
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Running verification command:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
npx hardhat verify --network baseSepolia 0x1234...5678 0xabcd...ef01 0xabcd...ef01
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This may take a minute...

✅ Verification completed successfully!

🔍 View verified contract:
   https://sepolia.basescan.org/address/0x1234...5678#code

📝 Contract Details:
   Name: TheSeeds
   Version: 1.2.0
   Compiler: Solidity 0.8.28
   Optimization: Enabled (200 runs)
```

## Troubleshooting

### "Already Verified" Error

If the contract is already verified, the script will detect this and show success:

```
✅ Contract is already verified!
```

### "BASESCAN_API_KEY not found"

Make sure you've added your Basescan API key to `.env.local`:

```bash
BASESCAN_API_KEY=your_actual_api_key_here
```

### "deployment-result.json not found"

Deploy the contract first using one of these commands:

```bash
npm run deployseeds:base-sepolia    # For Base Sepolia
npm run deployseeds:base            # For Base Mainnet
```

### "Invalid constructor arguments"

The script automatically handles constructor arguments. TheSeeds contract requires:
- `_admin`: Admin role address
- `_initialCreator`: Initial creator role address

Both are set to the deployer address during deployment.

### Verification takes too long

Wait a few minutes after deployment before verifying. The contract bytecode needs to be indexed by Basescan first.

## Manual Verification

If automatic verification fails, you can verify manually on Basescan:

1. Go to your contract address on Basescan
2. Click on "Contract" tab
3. Click "Verify and Publish"
4. Enter these details:
   - **Contract Name**: `TheSeeds`
   - **Compiler Version**: `v0.8.28+commit.7893614a`
   - **Optimization**: `Yes`
   - **Runs**: `200`
   - **Constructor Arguments**: Get from the script output
5. Paste the contract source code
6. Submit

## Files

- **Script**: `scripts/verifySeedsContract.ts` - Main verification script
- **Config**: `hardhat.config.ts` - Hardhat configuration with network settings
- **Contract**: `contracts/TheSeeds.sol` - The Seeds contract source code

## Related Scripts

- `npm run deployseeds:base-sepolia` - Deploy to Base Sepolia
- `npm run deployseeds:base` - Deploy to Base Mainnet
- `npm run verify:contract` - Verify using the old script (has a bug with constructor args)
- `npm run verify:seeds` - Verify using the new script (recommended)