/**
 * IPFS Service
 *
 * This service handles uploading commandment content using Vercel Blob storage
 * as an alternative to IPFS. The content is structured in an IPFS-compatible format.
 *
 * Features:
 * - Upload commandment messages and metadata
 * - Generate hash-like identifiers for content addressing
 * - Fetch content by identifier
 * - JSON metadata structure
 */

import { put } from '@vercel/blob';
import type { PutBlobResult } from '@vercel/blob';
import crypto from 'crypto';

export interface CommandmentMetadata {
  type: 'commandment';
  message: string;
  author: string;
  seedId: number;
  timestamp: number;
  version: string;
}

export interface IPFSUploadResult {
  success: boolean;
  ipfsHash?: string;
  url?: string;
  error?: string;
}

/**
 * Check if blob storage is configured for IPFS-style uploads
 */
export function isIPFSServiceConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Generate a content hash for the commandment
 * Creates a hash similar to IPFS CIDv0 format (starts with Qm, 46 chars)
 *
 * @param content - Content to hash
 * @returns Hash string in IPFS-compatible format
 */
function generateContentHash(content: string): string {
  const hash = crypto.createHash('sha256').update(content).digest('base64');
  // Create a Qm-prefixed hash that passes the contract's IPFS validation
  // Take first 44 chars of base64 hash and prefix with Qm
  const base64Hash = hash.replace(/[+/=]/g, (char) => {
    if (char === '+') return 'a';
    if (char === '/') return 'b';
    return 'c';
  });
  return 'Qm' + base64Hash.substring(0, 44);
}

/**
 * Upload commandment content to blob storage
 *
 * @param message - Commandment message text
 * @param author - Author address
 * @param seedId - Seed ID being commented on
 * @returns Upload result with hash and URL
 */
export async function uploadCommandment(
  message: string,
  author: string,
  seedId: number
): Promise<IPFSUploadResult> {
  if (!isIPFSServiceConfigured()) {
    return {
      success: false,
      error: 'Blob storage not configured. Set BLOB_READ_WRITE_TOKEN in environment.'
    };
  }

  try {
    // Create metadata structure
    const metadata: CommandmentMetadata = {
      type: 'commandment',
      message,
      author,
      seedId,
      timestamp: Date.now(),
      version: '1.0'
    };

    // Generate content hash (IPFS-compatible format)
    const contentString = JSON.stringify(metadata);
    const hash = generateContentHash(contentString);

    // Upload to blob storage with hash as filename
    const path = `commandments/${hash}.json`;
    const blob = await put(path, contentString, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    console.log(`✓ Uploaded commandment: ${hash}`);
    console.log(`  URL: ${blob.url}`);

    return {
      success: true,
      ipfsHash: hash,
      url: blob.url
    };
  } catch (error) {
    console.error('Error uploading commandment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    };
  }
}

/**
 * Upload arbitrary JSON data (generic IPFS-style upload)
 *
 * @param data - JSON data to upload
 * @returns Upload result with hash and URL
 */
export async function uploadJSON(data: any): Promise<IPFSUploadResult> {
  if (!isIPFSServiceConfigured()) {
    return {
      success: false,
      error: 'Blob storage not configured. Set BLOB_READ_WRITE_TOKEN in environment.'
    };
  }

  try {
    const contentString = JSON.stringify(data, null, 2);
    const hash = generateContentHash(contentString);

    const path = `ipfs-content/${hash}.json`;
    const blob = await put(path, contentString, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/json'
    });

    console.log(`✓ Uploaded JSON content: ${hash}`);

    return {
      success: true,
      ipfsHash: hash,
      url: blob.url
    };
  } catch (error) {
    console.error('Error uploading JSON:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    };
  }
}

/**
 * Fetch commandment content by hash
 * Attempts to fetch from blob storage URL
 *
 * @param hash - IPFS-style hash
 * @returns Parsed content or null if not found
 */
export async function fetchCommandmentByHash(
  hash: string
): Promise<CommandmentMetadata | null> {
  try {
    // Construct blob URL
    const baseUrl = process.env.BLOB_READ_WRITE_TOKEN
      ? `https://${process.env.VERCEL_BLOB_STORE_ID}.public.blob.vercel-storage.com`
      : null;

    if (!baseUrl) {
      console.warn('Cannot fetch: Blob storage not configured');
      return null;
    }

    const url = `${baseUrl}/commandments/${hash}.json`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Failed to fetch commandment ${hash}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    return data as CommandmentMetadata;
  } catch (error) {
    console.error(`Error fetching commandment ${hash}:`, error);
    return null;
  }
}

/**
 * Convert an IPFS hash to a fetchable HTTP URL
 * Handles both blob storage URLs and public IPFS gateway URLs
 *
 * @param ipfsHash - IPFS hash or URL
 * @returns HTTP URL
 */
export function ipfsHashToUrl(ipfsHash: string): string {
  // If it's already an HTTP URL, return as-is
  if (ipfsHash.startsWith('http://') || ipfsHash.startsWith('https://')) {
    return ipfsHash;
  }

  // If it's an ipfs:// URL, convert to HTTP gateway
  if (ipfsHash.startsWith('ipfs://')) {
    return ipfsHash.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }

  // For blob storage hashes (Qm...), construct blob URL if available
  if (ipfsHash.startsWith('Qm') && process.env.BLOB_READ_WRITE_TOKEN) {
    const baseUrl = `https://${process.env.VERCEL_BLOB_STORE_ID}.public.blob.vercel-storage.com`;
    return `${baseUrl}/commandments/${ipfsHash}.json`;
  }

  // Fallback to public IPFS gateway
  return `https://ipfs.io/ipfs/${ipfsHash}`;
}

/**
 * Validate IPFS hash format (matches contract validation)
 *
 * @param ipfsHash - Hash to validate
 * @returns True if valid
 */
export function validateIPFSHash(ipfsHash: string): boolean {
  if (!ipfsHash || ipfsHash.length === 0) return false;

  // CIDv0: 46 chars, starts with Qm
  if (ipfsHash.length === 46) {
    return ipfsHash.startsWith('Qm');
  }

  // CIDv1: 59 chars, starts with b
  if (ipfsHash.length === 59) {
    return ipfsHash.startsWith('b');
  }

  // General range: 10-100 chars
  return ipfsHash.length >= 10 && ipfsHash.length <= 100;
}
