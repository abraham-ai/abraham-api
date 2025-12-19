# Setting Up Continuous Voting

This guide explains how to configure the Seeds contract for near-continuous voting.

## Understanding the Limitation

Even in NON_ROUND_BASED mode, the contract enforces a **blessing period limit**. Users cannot vote indefinitely without calling `selectDailyWinner()` to reset the period.

## Quick Setup (Recommended)

Run these commands in order:

```bash
# 1. Select winner and start new round (resolves current "BlessingPeriodEnded" error)
npm run select-winner

# 2. Switch to non-round-based mode (all seeds eligible for blessings)
npm run switch-non-round

# 3. Extend voting period to maximum (7 days)
npm run extend-voting

# 4. Select winner again to apply the extended period
npm run select-winner
```

## What Each Mode Does

### ROUND_BASED (Default)
- Only seeds submitted in the current round can receive blessings
- Winner selection advances to next round
- Voting period: 1 day (default)

### NON_ROUND_BASED (Continuous)
- **All eligible seeds** can receive blessings (not just current round)
- Winner selection still resets the blessing period
- Better for ongoing, continuous voting

## Scripts Reference

### `npm run select-winner`
- Selects the winning seed for the current round
- Starts a new round with a fresh blessing period
- **Required** to reset the blessing period when it ends

### `npm run switch-non-round`
- Switches contract to NON_ROUND_BASED mode
- Allows all seeds to be blessed continuously
- Takes effect immediately

### `npm run extend-voting`
- Sets the voting period to 7 days (maximum allowed)
- **Note**: Only applies to the NEXT round after `select-winner` is called
- Gives you longer continuous voting windows

## Solving the Current Error

You're getting `BlessingPeriodEnded()` because the current voting period has expired.

**Immediate fix:**
```bash
npm run select-winner
```

This will:
1. Select the winner for the current round
2. Start a new round
3. Reset the blessing period timer
4. Allow blessings again

## Recommended Configuration

For maximum continuous voting:

1. **Switch to NON_ROUND_BASED**: All seeds always eligible
2. **Extend voting to 7 days**: Longer windows before needing winner selection
3. **Automate winner selection**: Set up a cron job to call it every 7 days

## Automation (Recommended)

To truly enable continuous voting, set up automated winner selection:

### Option 1: Cron Job
```bash
# Every 7 days at midnight
0 0 */7 * * cd /path/to/abraham-api && npm run select-winner
```

### Option 2: API Endpoint + Scheduler
Create an admin endpoint that calls `contractService.selectDailyWinner()` and trigger it via a service like:
- Vercel Cron (for Vercel deployments)
- GitHub Actions scheduled workflow
- AWS EventBridge

### Option 3: Smart Contract Modification
For truly continuous voting without periods, you would need to:
1. Remove the blessing period check from the contract
2. Implement a different winner selection mechanism
3. Redeploy the contract

## Important Notes

⚠️ **The voting period extension (`extend-voting`) is DEFERRED**
- Setting a new voting period doesn't affect the current round
- It only applies after the next `selectDailyWinner()` call
- This is by design to prevent mid-round rule changes

⚠️ **Maximum voting period is 7 days**
- This is a hard limit in the contract (see `TheSeeds.sol:449`)
- You cannot extend beyond this without contract changes

## Current State Check

To check your current configuration:

```bash
# Check voting state
tsx scripts/checkVotingState.ts

# Or query the contract directly
# - getRoundMode() -> 0 = ROUND_BASED, 1 = NON_ROUND_BASED
# - votingPeriod() -> current period in seconds
# - getTimeUntilPeriodEnd() -> seconds until blessing period ends
```

## Troubleshooting

### "Voting period not ended" when selecting winner
This is expected. The contract requires the period to end before selection. Wait until `getTimeUntilPeriodEnd()` returns 0.

### "No valid winner" error
- Happens when no seeds have any blessings
- Or when using DEADLOCK_STRATEGY = REVERT (default)
- Solution: Ensure at least one seed has blessings before selecting winner

### Blessings still failing after setup
1. Verify the new round started: Check `currentRound()` increased
2. Verify mode switched: Check `getRoundMode()` returns 1
3. Verify period active: Check `getTimeUntilPeriodEnd()` > 0
4. Check the API logs for specific error messages
