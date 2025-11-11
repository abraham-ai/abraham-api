/**
 * Vercel Blob Storage Service
 *
 * This service handles uploading, downloading, and managing FirstWorks snapshots
 * in Vercel Blob storage, eliminating the need for manual git commits.
 *
 * Features:
 * - Upload snapshots and merkle trees to blob storage
 * - Download latest snapshots for API usage
 * - Automatic cleanup of old snapshots (keeps last 5 versions)
 * - Fast CDN-backed reads
 *
 * Storage Structure:
 * - snapshots/latest.json (always points to latest snapshot)
 * - snapshots/snapshot-{timestamp}.json (versioned snapshots)
 * - merkle/latest.json (always points to latest merkle tree)
 * - merkle/merkle-{timestamp}.json (versioned merkle trees)
 */

import { put, list, del, head } from '@vercel/blob';
import type { PutBlobResult, ListBlobResult } from '@vercel/blob';

/**
 * Check if Vercel Blob is configured
 */
export function isBlobStorageConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Upload snapshot to Vercel Blob storage
 * Uploads both a versioned file and updates the "latest" file
 *
 * @param data - Snapshot JSON data
 * @param type - Type of file: 'snapshot' or 'merkle'
 * @returns Blob metadata including URL
 */
export async function uploadToBlob(
  data: any,
  type: 'snapshot' | 'merkle'
): Promise<PutBlobResult> {
  if (!isBlobStorageConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN not configured. Set it in Vercel environment variables.');
  }

  const timestamp = Date.now();
  const folderName = type === 'snapshot' ? 'snapshots' : 'merkle';
  const filePrefix = type === 'snapshot' ? 'snapshot' : 'merkle';

  // Upload versioned file
  const versionedPath = `${folderName}/${filePrefix}-${timestamp}.json`;
  const versionedBlob = await put(versionedPath, JSON.stringify(data, null, 2), {
    access: 'public',
    addRandomSuffix: false,
  });

  console.log(`✓ Uploaded versioned ${type}: ${versionedBlob.url}`);

  // Upload/update "latest" file
  const latestPath = `${folderName}/latest.json`;
  const latestBlob = await put(latestPath, JSON.stringify(data, null, 2), {
    access: 'public',
    addRandomSuffix: false,
  });

  console.log(`✓ Updated latest ${type}: ${latestBlob.url}`);

  return latestBlob;
}

/**
 * Download latest snapshot from Vercel Blob storage
 *
 * @param type - Type of file: 'snapshot' or 'merkle'
 * @returns Parsed JSON data or null if not found
 */
export async function downloadFromBlob(
  type: 'snapshot' | 'merkle'
): Promise<any | null> {
  if (!isBlobStorageConfigured()) {
    console.warn('Blob storage not configured, skipping download');
    return null;
  }

  try {
    const folderName = type === 'snapshot' ? 'snapshots' : 'merkle';
    const latestPath = `${folderName}/latest.json`;

    // Check if file exists
    const metadata = await head(latestPath);
    if (!metadata) {
      console.log(`No ${type} found in blob storage`);
      return null;
    }

    // Download the file
    const response = await fetch(metadata.url);
    if (!response.ok) {
      throw new Error(`Failed to download ${type}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✓ Downloaded ${type} from blob storage`);
    return data;
  } catch (error) {
    console.error(`Error downloading ${type} from blob:`, error);
    return null;
  }
}

/**
 * List all blobs in a folder
 *
 * @param folderName - Folder name: 'snapshots' or 'merkle'
 * @returns List of blobs
 */
export async function listBlobs(folderName: 'snapshots' | 'merkle'): Promise<ListBlobResult> {
  if (!isBlobStorageConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN not configured');
  }

  return await list({
    prefix: `${folderName}/`,
  });
}

/**
 * Clean up old snapshots, keeping only the most recent versions
 *
 * Strategy:
 * - Keep the "latest.json" file (always)
 * - Keep the last N versioned files (default: 5)
 * - Delete all older versioned files
 *
 * @param type - Type of file: 'snapshot' or 'merkle'
 * @param keepCount - Number of recent versions to keep (default: 5)
 * @returns Number of files deleted
 */
export async function cleanupOldBlobs(
  type: 'snapshot' | 'merkle',
  keepCount: number = 5
): Promise<number> {
  if (!isBlobStorageConfigured()) {
    console.warn('Blob storage not configured, skipping cleanup');
    return 0;
  }

  const folderName = type === 'snapshot' ? 'snapshots' : 'merkle';
  const filePrefix = type === 'snapshot' ? 'snapshot' : 'merkle';

  console.log(`\n🧹 Cleaning up old ${type} files...`);
  console.log(`   Strategy: Keep latest.json + ${keepCount} most recent versions`);

  // List all blobs in the folder
  const { blobs } = await listBlobs(folderName);

  // Filter to only versioned files (exclude latest.json)
  const versionedFiles = blobs
    .filter(blob => blob.pathname.includes(`${filePrefix}-`) && blob.pathname.endsWith('.json'))
    .sort((a, b) => {
      // Sort by upload date descending (newest first)
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });

  console.log(`   Found ${versionedFiles.length} versioned ${type} files`);

  // Keep only the most recent N files
  const filesToDelete = versionedFiles.slice(keepCount);

  if (filesToDelete.length === 0) {
    console.log(`   ✓ No cleanup needed (${versionedFiles.length} <= ${keepCount})`);
    return 0;
  }

  console.log(`   Deleting ${filesToDelete.length} old files...`);

  // Delete old files
  let deletedCount = 0;
  for (const blob of filesToDelete) {
    try {
      await del(blob.url);
      console.log(`   ✓ Deleted: ${blob.pathname}`);
      deletedCount++;
    } catch (error) {
      console.error(`   ✗ Failed to delete ${blob.pathname}:`, error);
    }
  }

  console.log(`   ✓ Cleanup complete: ${deletedCount} files deleted`);
  return deletedCount;
}

/**
 * Get blob storage statistics
 *
 * @returns Storage stats including file count and total size
 */
export async function getBlobStats(): Promise<{
  snapshots: { count: number; latestUrl?: string; uploadedAt?: string };
  merkle: { count: number; latestUrl?: string; uploadedAt?: string };
}> {
  if (!isBlobStorageConfigured()) {
    return {
      snapshots: { count: 0 },
      merkle: { count: 0 },
    };
  }

  const [snapshotBlobs, merkleBlobs] = await Promise.all([
    listBlobs('snapshots'),
    listBlobs('merkle'),
  ]);

  // Find latest.json files
  const latestSnapshot = snapshotBlobs.blobs.find(b => b.pathname.endsWith('latest.json'));
  const latestMerkle = merkleBlobs.blobs.find(b => b.pathname.endsWith('latest.json'));

  return {
    snapshots: {
      count: snapshotBlobs.blobs.length,
      latestUrl: latestSnapshot?.url,
      uploadedAt: latestSnapshot?.uploadedAt ? new Date(latestSnapshot.uploadedAt).toISOString() : undefined,
    },
    merkle: {
      count: merkleBlobs.blobs.length,
      latestUrl: latestMerkle?.url,
      uploadedAt: latestMerkle?.uploadedAt ? new Date(latestMerkle.uploadedAt).toISOString() : undefined,
    },
  };
}
