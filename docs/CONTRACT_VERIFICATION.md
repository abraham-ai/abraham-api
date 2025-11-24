# Contract Verification Guide

This guide explains how to verify your deployed smart contracts on block explorers.

## Prerequisites

1. **Basescan API Key**: Get one from [Basescan](https://basescan.org/myapikey) or [Base Sepolia](https://sepolia.basescan.org/myapikey)
2. **Deployed Contract**: Contract must be deployed and address saved in `deployment-result.json`
3. **Environment Variables**: Add your API key to `.env.local`

## Setup

### 1. Add API Key to `.env.local`

```bash
BASESCAN_API_KEY=your_api_key_here
```

### 2. Verify the Contract

```bash
# Automatic verification (uses deployment-result.json)
npm run verify:contract

# Or specify network explicitly
npm run verify:contract:base-sepolia
npm run verify:contract:base
```

## What Gets Verified

The verification script automatically verifies your contract on multiple explorers:

- ✅ **Basescan** - Primary block explorer for Base
- ✅ **Blockscout** - Alternative open-source explorer
- ✅ **Sourcify** - Decentralized verification platform

## Verification Details

The script automatically handles:

- ✅ Reading deployment info from `deployment-result.json`
- ✅ Detecting network (Base Sepolia or Base Mainnet)
- ✅ Extracting constructor arguments
- ✅ Matching compiler settings (0.8.28, optimization enabled, 200 runs)
- ✅ Providing explorer links after verification

## Manual Verification

If you need to verify manually:

```bash
npx hardhat verify --network baseSepolia \
  <CONTRACT_ADDRESS> \
  <CONSTRUCTOR_ARG_1> \
  <CONSTRUCTOR_ARG_2>
```

For TheSeeds contract:
```bash
npx hardhat verify --network baseSepolia \
  0x2bb7830b1d6a0994a4581239f89aa7ecb375479b \
  0x641f5ffC5F6239A0873Bd00F9975091FB035aAFC
```

## Troubleshooting

### "Already Verified" Error

This is actually success! The contract is already verified. The script will show you the explorer link.

### "Invalid API Key" Error

1. Check that `BASESCAN_API_KEY` is set in `.env.local`
2. Verify the API key is valid on Basescan
3. Note: The same API key works for both mainnet and testnet

### "Compilation Failed" Error

Ensure your contract was compiled with the same settings:
- Solidity version: 0.8.28
- Optimization: Enabled
- Runs: 200

Recompile with:
```bash
npm run compile
```

### "Constructor Arguments Mismatch" Error

The script automatically reads constructor arguments from `deployment-result.json`. If you get this error:

1. Check `deployment-result.json` has the correct `deployer` address
2. Verify the deployed contract was created with those arguments

## Networks Supported

- **Base Sepolia (Testnet)**: Chain ID 84532
- **Base Mainnet**: Chain ID 8453

## Current Deployment Status

Your current deployment on Base Sepolia is verified at:
- **Basescan**: https://sepolia.basescan.org/address/0x2bb7830b1d6a0994a4581239f89aa7ecb375479b#code
- **Blockscout**: https://base-sepolia.blockscout.com/address/0x2bb7830b1d6a0994a4581239f89aa7ecb375479b#code

## Benefits of Verification

✅ **Transparency**: Users can read your contract source code
✅ **Trust**: Proves the deployed bytecode matches the source
✅ **Interaction**: Enable contract interaction through block explorers
✅ **Debugging**: Easier to debug transactions and events
✅ **Integration**: Tools and frontends can parse your ABI automatically

## Next Steps

After verification, your contract is ready for:
- Public interaction through block explorers
- Integration with frontend applications
- Auditing and security reviews
- Community inspection and trust building
