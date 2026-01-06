/**
 * IPFS Service
 *
 * This service handles uploading commandment content to IPFS using Pinata.
 *
 * Features:
 * - Upload commandment messages and metadata to IPFS
 * - Fetch content by IPFS hash
 * - JSON metadata structure
 */

import { PinataSDK } from 'pinata';

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

// Initialize Pinata client
let pinata: PinataSDK | null = null;

function getPinataClient(): PinataSDK | null {
  if (pinata) return pinata;

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    console.warn('PINATA_JWT not configured');
    return null;
  }

  pinata = new PinataSDK({ pinataJwt: jwt });
  return pinata;
}

/**
 * Check if IPFS service is configured
 */
export function isIPFSServiceConfigured(): boolean {
  return !!process.env.PINATA_JWT;
}

/**
 * Upload commandment content to IPFS via Pinata
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
  const client = getPinataClient();

  if (!client) {
    return {
      success: false,
      error: 'IPFS not configured. Set PINATA_JWT in environment.'
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

    // Upload to IPFS via Pinata
    const upload = await client.upload.public.json(metadata)
      .name(`commandment-seed-${seedId}-${Date.now()}.json`);

    const ipfsHash = upload.cid;
    const ipfsUrl = ipfsHashToUrl(ipfsHash);

    console.log(`✓ Uploaded commandment to IPFS: ${ipfsHash}`);
    console.log(`  URL: ${ipfsUrl}`);

    return {
      success: true,
      ipfsHash,
      url: ipfsUrl
    };
  } catch (error) {
    console.error('Error uploading commandment to IPFS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    };
  }
}

/**
 * Upload arbitrary JSON data to IPFS via Pinata
 *
 * @param data - JSON data to upload
 * @returns Upload result with hash and URL
 */
export async function uploadJSON(data: any): Promise<IPFSUploadResult> {
  const client = getPinataClient();

  if (!client) {
    return {
      success: false,
      error: 'IPFS not configured. Set PINATA_JWT in environment.'
    };
  }

  try {
    const upload = await client.upload.public.json(data)
      .name(`json-${Date.now()}.json`);

    const ipfsHash = upload.cid;
    const ipfsUrl = ipfsHashToUrl(ipfsHash);

    console.log(`✓ Uploaded JSON to IPFS: ${ipfsHash}`);

    return {
      success: true,
      ipfsHash,
      url: ipfsUrl
    };
  } catch (error) {
    console.error('Error uploading JSON to IPFS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Upload failed'
    };
  }
}

/**
 * Fetch commandment content by hash from IPFS
 *
 * @param hash - IPFS hash
 * @returns Parsed content or null if not found
 */
export async function fetchCommandmentByHash(
  hash: string
): Promise<CommandmentMetadata | null> {
  try {
    const url = ipfsHashToUrl(hash);
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`Failed to fetch commandment ${hash}: HTTP ${response.status} ${response.statusText}`);
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
 * Convert an IPFS hash to a fetchable HTTP URL via gateway
 *
 * @param ipfsHash - IPFS hash or URL
 * @returns HTTP URL
 */
export function ipfsHashToUrl(ipfsHash: string): string {
  // If it's already an HTTP URL, return as-is
  if (ipfsHash.startsWith('http://') || ipfsHash.startsWith('https://')) {
    return ipfsHash;
  }

  // Get IPFS gateway from environment or use default Pinata gateway
  const ipfsGateway = process.env.IPFS_GATEWAY || 'https://tomato-causal-partridge-743.mypinata.cloud/ipfs/';

  // If it's an ipfs:// URL, convert to HTTP gateway
  if (ipfsHash.startsWith('ipfs://')) {
    return ipfsHash.replace('ipfs://', ipfsGateway);
  }

  // Convert hash to gateway URL
  return `${ipfsGateway}${ipfsHash}`;
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
