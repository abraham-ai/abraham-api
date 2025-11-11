import { readFileSync, writeFileSync } from "fs";
import { keccak256, encodePacked, encodeAbiParameters } from "viem";
/**
 * Generate leaf hash for a holder
 */
function generateLeaf(address, tokenIds) {
    // Match Solidity: keccak256(bytes.concat(keccak256(abi.encode(owner, tokenIds))))
    const innerHash = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256[]" }], [address, tokenIds.map((id) => BigInt(id))]));
    return keccak256(encodePacked(["bytes32"], [innerHash]));
}
/**
 * Hash two nodes together
 */
function hashPair(left, right) {
    // Sort to ensure deterministic ordering
    const sorted = [left, right].sort();
    return keccak256(encodePacked(["bytes32", "bytes32"], [sorted[0], sorted[1]]));
}
/**
 * Build Merkle tree from leaves
 */
function buildMerkleTree(leaves) {
    if (leaves.length === 0) {
        throw new Error("Cannot build tree from empty leaves");
    }
    // Build the first level
    let currentLevel = leaves.map((hash) => ({ hash }));
    const tree = [currentLevel];
    // Build tree level by level
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i]; // Duplicate last node if odd number
            const parentHash = hashPair(left.hash, right.hash);
            const parent = {
                hash: parentHash,
                left,
                right: right !== left ? right : undefined,
            };
            nextLevel.push(parent);
        }
        currentLevel = nextLevel;
        tree.push(currentLevel);
    }
    return tree.flat();
}
/**
 * Generate Merkle proof for a specific leaf
 */
function generateProof(leaves, leafIndex) {
    const proof = [];
    let currentLevel = [...leaves];
    let currentIndex = leafIndex;
    while (currentLevel.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
            // If current index is at this pair, add sibling to proof
            if (i === currentIndex || i + 1 === currentIndex) {
                if (currentIndex % 2 === 0) {
                    // Current is left, add right
                    if (i + 1 < currentLevel.length) {
                        proof.push(right);
                    }
                }
                else {
                    // Current is right, add left
                    proof.push(left);
                }
            }
            nextLevel.push(hashPair(left, right));
        }
        currentIndex = Math.floor(currentIndex / 2);
        currentLevel = nextLevel;
    }
    return proof;
}
/**
 * Generate Merkle tree from snapshot
 */
export function generateMerkleTree(snapshotPath) {
    // Load snapshot
    const snapshotData = JSON.parse(readFileSync(snapshotPath, "utf-8"));
    console.log(`Generating Merkle tree for ${snapshotData.totalHolders} holders...`);
    // Generate leaves
    const holders = snapshotData.holders;
    const leaves = [];
    const leavesMap = {};
    holders.forEach((holder) => {
        const leaf = generateLeaf(holder.address, holder.tokenIds);
        leaves.push(leaf);
        leavesMap[holder.address.toLowerCase()] = leaf;
    });
    console.log(`Generated ${leaves.length} leaves`);
    // Build tree
    buildMerkleTree(leaves);
    // Get root (last node in tree)
    const root = leaves.length === 1
        ? leaves[0]
        : (() => {
            let currentLevel = [...leaves];
            while (currentLevel.length > 1) {
                const nextLevel = [];
                for (let i = 0; i < currentLevel.length; i += 2) {
                    const left = currentLevel[i];
                    const right = i + 1 < currentLevel.length
                        ? currentLevel[i + 1]
                        : currentLevel[i];
                    nextLevel.push(hashPair(left, right));
                }
                currentLevel = nextLevel;
            }
            return currentLevel[0];
        })();
    console.log(`Merkle Root: ${root}`);
    // Generate proofs for all holders
    const proofs = {};
    holders.forEach((holder, index) => {
        const proof = generateProof(leaves, index);
        proofs[holder.address.toLowerCase()] = proof;
    });
    return {
        root,
        proofs,
        leaves: leavesMap,
    };
}
/**
 * Verify a Merkle proof
 */
export function verifyProof(proof, root, leaf) {
    let computedHash = leaf;
    for (const proofElement of proof) {
        computedHash = hashPair(computedHash, proofElement);
    }
    return computedHash === root;
}
/**
 * Main execution
 */
async function main() {
    const snapshotPath = process.argv[2] || "./lib/snapshots/latest.json";
    const outputPath = process.argv[3] || "./lib/snapshots/firstWorks_merkle.json";
    console.log("=== FirstWorks Merkle Tree Generator ===\n");
    console.log(`Reading snapshot from: ${snapshotPath}`);
    try {
        const merkleData = generateMerkleTree(snapshotPath);
        // Save to file
        writeFileSync(outputPath, JSON.stringify(merkleData, null, 2));
        console.log(`\nMerkle tree saved to: ${outputPath}`);
        // Print stats
        console.log("\n=== Statistics ===");
        console.log(`Total Leaves: ${Object.keys(merkleData.leaves).length}`);
        console.log(`Total Proofs: ${Object.keys(merkleData.proofs).length}`);
        console.log(`Merkle Root: ${merkleData.root}`);
        // Verify a random proof
        const randomHolder = Object.keys(merkleData.proofs)[0];
        const randomProof = merkleData.proofs[randomHolder];
        const randomLeaf = merkleData.leaves[randomHolder];
        const isValid = verifyProof(randomProof, merkleData.root, randomLeaf);
        console.log("\n=== Verification Test ===");
        console.log(`Testing holder: ${randomHolder}`);
        console.log(`Proof valid: ${isValid ? "✓" : "✗"}`);
        if (!isValid) {
            console.error("ERROR: Proof verification failed!");
            process.exit(1);
        }
        console.log("\n✓ Merkle tree generation complete!");
        console.log("\nNext steps:");
        console.log("1. Deploy The Seeds contract on L2");
        console.log("2. Update ownership root with:");
        console.log(`   cast send $SEEDS_CONTRACT "updateOwnershipRoot(bytes32)" ${merkleData.root} --rpc-url $BASE_RPC_URL --private-key $OWNER_KEY`);
        console.log("3. Set up API endpoint to serve proofs to users");
    }
    catch (error) {
        console.error("Error generating Merkle tree:", error);
        process.exit(1);
    }
}
// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
