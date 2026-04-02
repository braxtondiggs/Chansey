/**
 * Pure utility functions for parsing and sanitizing storage paths.
 * Extracted from MarketDataReaderService for independent testability.
 */

import * as path from 'path';

/**
 * Parse storage location to extract the object path.
 * Supports formats:
 * - Direct path: "datasets/btc-hourly.csv"
 * - MinIO URL: "http://minio:9000/bucket/datasets/btc-hourly.csv"
 * - S3-style: "s3://bucket/datasets/btc-hourly.csv"
 *
 * Security: Validates path to prevent traversal attacks
 */
export function parseStorageLocation(storageLocation: string): string {
  const location = storageLocation.trim();
  let objectPath: string;

  // Handle s3:// URLs
  if (location.startsWith('s3://')) {
    // s3://bucket/path/to/file.csv -> path/to/file.csv
    const withoutProtocol = location.substring(5);
    const slashIndex = withoutProtocol.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(`Invalid s3:// URL format: ${location}`);
    }
    objectPath = withoutProtocol.substring(slashIndex + 1);
  } else if (location.startsWith('http://') || location.startsWith('https://')) {
    // Handle HTTP/HTTPS URLs
    try {
      const url = new URL(location);
      // Remove leading slash and bucket name from path
      const pathParts = url.pathname.split('/').filter((p) => p);
      if (pathParts.length < 2) {
        throw new Error(`Invalid URL path format: ${location}`);
      }
      // Skip first part (bucket name)
      objectPath = pathParts.slice(1).join('/');
    } catch {
      throw new Error(`Failed to parse storage URL: ${location}`);
    }
  } else {
    // Assume it's a direct path
    objectPath = location;
  }

  // Security: Validate path to prevent traversal attacks
  return sanitizeObjectPath(objectPath);
}

/**
 * Sanitize and validate object path to prevent path traversal attacks.
 * @throws Error if path contains traversal sequences or is invalid
 */
export function sanitizeObjectPath(objectPath: string): string {
  // Reject explicit traversal segments before normalization
  const pathSegments = objectPath.split('/').filter((segment) => segment.length > 0);
  if (pathSegments.some((segment) => segment === '..')) {
    throw new Error('Invalid storage path: path traversal not allowed');
  }

  // Normalize path to resolve any . or .. components
  const normalized = path.posix.normalize(objectPath);

  // Check for path traversal attempts
  if (normalized.includes('..')) {
    throw new Error('Invalid storage path: path traversal not allowed');
  }

  // Reject absolute paths (should be relative to bucket)
  if (normalized.startsWith('/')) {
    throw new Error('Invalid storage path: absolute paths not allowed');
  }

  // Reject empty paths
  if (!normalized || normalized === '.') {
    throw new Error('Invalid storage path: path cannot be empty');
  }

  // Reject paths with null bytes (common injection technique)
  if (normalized.includes('\0')) {
    throw new Error('Invalid storage path: null bytes not allowed');
  }

  return normalized;
}
