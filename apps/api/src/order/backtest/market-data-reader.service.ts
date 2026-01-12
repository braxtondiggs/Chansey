/**
 * Market Data Reader Service
 *
 * Reads and parses market data CSV files from MinIO storage.
 * Supports OHLCV (Open, High, Low, Close, Volume) format for backtesting.
 */

import { Injectable, Logger } from '@nestjs/common';

import * as path from 'path';

import { MarketDataSet } from './market-data-set.entity';

import { StorageService } from '../../storage/storage.service';

/**
 * Maximum allowed CSV file size (100MB)
 * Larger files should use streaming parsing or be split
 */
const MAX_CSV_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Unix timestamp bounds for validation
 * Used to distinguish between seconds and milliseconds timestamps
 */
const UNIX_TIMESTAMP_BOUNDS = {
  /** Jan 1, 2000 00:00:00 UTC in seconds */
  MIN_SECONDS: 946684800,
  /** Jan 1, 2100 00:00:00 UTC in seconds */
  MAX_SECONDS: 4102444800,
  /** Jan 1, 2000 00:00:00 UTC in milliseconds */
  MIN_MILLISECONDS: 946684800000
};

/**
 * OHLCV data point structure
 */
export interface OHLCVData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  coinId: string;
}

/**
 * Result of reading market data
 */
export interface MarketDataResult {
  data: OHLCVData[];
  source: 'storage' | 'database';
  recordCount: number;
  dateRange: {
    start: Date;
    end: Date;
  };
}

@Injectable()
export class MarketDataReaderService {
  private readonly logger = new Logger(MarketDataReaderService.name);

  constructor(private readonly storageService: StorageService) {}

  /**
   * Check if a dataset has a storage location that can be read from MinIO/S3
   *
   * Storage Location Convention:
   * - `null` or `undefined`: Dataset uses the database Price table (legacy/default)
   * - Empty string `''`: Dataset uses the database Price table (explicit fallback)
   * - Non-empty string: Path to CSV file in MinIO storage (e.g., "datasets/btc-hourly.csv")
   *
   * @param dataset - The MarketDataSet to check
   * @returns true if dataset has a valid storage location for file-based data
   */
  hasStorageLocation(dataset: MarketDataSet): boolean {
    return !!(dataset.storageLocation && dataset.storageLocation.trim().length > 0);
  }

  /**
   * Read market data from a dataset's storage location
   *
   * @param dataset - The MarketDataSet entity
   * @param startDate - Optional start date filter
   * @param endDate - Optional end date filter
   * @returns Parsed OHLCV data array
   */
  async readMarketData(dataset: MarketDataSet, startDate?: Date, endDate?: Date): Promise<MarketDataResult> {
    if (!this.hasStorageLocation(dataset)) {
      throw new Error('Dataset does not have a storage location configured');
    }

    const objectPath = this.parseStorageLocation(dataset.storageLocation);

    this.logger.log(`Reading market data from storage: ${objectPath}`);

    // Check if file exists and get its size
    const fileStats = await this.storageService.getFileStats(objectPath);
    if (!fileStats) {
      throw new Error(`Market data file not found: ${objectPath}`);
    }

    // Validate file size to prevent memory exhaustion
    if (fileStats.size > MAX_CSV_FILE_SIZE_BYTES) {
      throw new Error(
        `CSV file exceeds maximum size of ${MAX_CSV_FILE_SIZE_BYTES / 1024 / 1024}MB. ` +
          `File size: ${(fileStats.size / 1024 / 1024).toFixed(2)}MB`
      );
    }

    // Fetch the file
    const fileBuffer = await this.storageService.getFile(objectPath);
    const csvContent = fileBuffer.toString('utf-8');

    // Parse CSV
    const allData = this.parseCSV(csvContent, dataset.instrumentUniverse);

    // Filter by date range if provided
    let filteredData = allData;
    if (startDate || endDate) {
      filteredData = allData.filter((row) => {
        if (startDate && row.timestamp < startDate) return false;
        if (endDate && row.timestamp > endDate) return false;
        return true;
      });
    }

    // Sort by timestamp
    filteredData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const result: MarketDataResult = {
      data: filteredData,
      source: 'storage',
      recordCount: filteredData.length,
      dateRange: {
        start: filteredData.length > 0 ? filteredData[0].timestamp : (startDate ?? new Date()),
        end: filteredData.length > 0 ? filteredData[filteredData.length - 1].timestamp : (endDate ?? new Date())
      }
    };

    this.logger.log(
      `Loaded ${result.recordCount} OHLCV records from ${objectPath} ` +
        `(${result.dateRange.start.toISOString()} to ${result.dateRange.end.toISOString()})`
    );

    return result;
  }

  /**
   * Parse storage location to extract the object path
   * Supports formats:
   * - Direct path: "datasets/btc-hourly.csv"
   * - MinIO URL: "http://minio:9000/bucket/datasets/btc-hourly.csv"
   * - S3-style: "s3://bucket/datasets/btc-hourly.csv"
   *
   * Security: Validates path to prevent traversal attacks
   */
  private parseStorageLocation(storageLocation: string): string {
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
    return this.sanitizeObjectPath(objectPath);
  }

  /**
   * Sanitize and validate object path to prevent path traversal attacks
   * @throws Error if path contains traversal sequences or is invalid
   */
  private sanitizeObjectPath(objectPath: string): string {
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

  /**
   * Parse CSV content into OHLCV data
   *
   * Expected CSV format:
   * timestamp,open,high,low,close,volume[,symbol]
   * 2024-01-01T00:00:00Z,42000.50,42150.00,41900.00,42100.00,1500.5[,BTC]
   */
  private parseCSV(csvContent: string, instrumentUniverse: string[]): OHLCVData[] {
    const lines = csvContent.split('\n').filter((line) => line.trim());

    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    // Parse header
    const header = lines[0]
      .toLowerCase()
      .split(',')
      .map((h) => h.trim());
    const timestampIndex = this.findColumnIndex(header, ['timestamp', 'time', 'date', 'datetime']);
    const openIndex = this.findColumnIndex(header, ['open', 'o']);
    const highIndex = this.findColumnIndex(header, ['high', 'h']);
    const lowIndex = this.findColumnIndex(header, ['low', 'l']);
    const closeIndex = this.findColumnIndex(header, ['close', 'c', 'price']);
    const volumeIndex = this.findColumnIndex(header, ['volume', 'vol', 'v']);
    const symbolIndex = this.findColumnIndex(header, ['symbol', 'coin', 'asset', 'ticker']);

    if (timestampIndex === -1) {
      throw new Error('CSV must have a timestamp column (timestamp, time, date, or datetime)');
    }
    if (closeIndex === -1) {
      throw new Error('CSV must have a close/price column');
    }

    // Default coin ID from instrument universe
    const defaultCoinId = instrumentUniverse.length > 0 ? instrumentUniverse[0] : 'UNKNOWN';

    const data: OHLCVData[] = [];
    const errors: string[] = [];

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const values = this.parseCSVLine(line);

        const timestamp = this.parseTimestamp(values[timestampIndex]);
        if (!timestamp) {
          errors.push(`Line ${i + 1}: Invalid timestamp`);
          continue;
        }

        const close = parseFloat(values[closeIndex]);
        if (isNaN(close)) {
          errors.push(`Line ${i + 1}: Invalid close price`);
          continue;
        }

        const open = openIndex !== -1 ? parseFloat(values[openIndex]) : close;
        const high = highIndex !== -1 ? parseFloat(values[highIndex]) : close;
        const low = lowIndex !== -1 ? parseFloat(values[lowIndex]) : close;
        const volume = volumeIndex !== -1 ? parseFloat(values[volumeIndex]) : 0;
        const coinId = symbolIndex !== -1 ? values[symbolIndex] : defaultCoinId;

        data.push({
          timestamp,
          open: isNaN(open) ? close : open,
          high: isNaN(high) ? close : high,
          low: isNaN(low) ? close : low,
          close,
          volume: isNaN(volume) ? 0 : volume,
          coinId: coinId.toUpperCase()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Line ${i + 1}: ${message}`);
      }
    }

    if (errors.length > 0 && errors.length > data.length * 0.1) {
      // More than 10% errors - warn
      this.logger.warn(`CSV parsing had ${errors.length} errors out of ${lines.length - 1} rows`);
    }

    if (data.length === 0) {
      throw new Error(`No valid data rows found in CSV. Errors: ${errors.slice(0, 5).join('; ')}`);
    }

    return data;
  }

  /**
   * Find column index by possible names
   * @param header - Array of header column names
   * @param possibleNames - Array of possible column name variations to search for
   * @returns Column index or -1 if not found
   */
  private findColumnIndex(header: string[], possibleNames: string[]): number {
    for (const name of possibleNames) {
      const index = header.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  }

  /**
   * Parse a CSV line handling quoted values
   */
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current.trim());
    return values;
  }

  /**
   * Parse timestamp string to Date
   * Supports ISO 8601 format, Unix seconds, and Unix milliseconds
   */
  private parseTimestamp(value: string): Date | null {
    if (!value) return null;

    const trimmed = value.trim();

    // Try ISO format first (e.g., "2024-01-01T00:00:00Z")
    const isoDate = new Date(trimmed);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // Try Unix timestamp (seconds) - valid range: 2000-2100
    const unixSeconds = parseInt(trimmed, 10);
    if (
      !isNaN(unixSeconds) &&
      unixSeconds > UNIX_TIMESTAMP_BOUNDS.MIN_SECONDS &&
      unixSeconds < UNIX_TIMESTAMP_BOUNDS.MAX_SECONDS
    ) {
      return new Date(unixSeconds * 1000);
    }

    // Try Unix timestamp (milliseconds) - valid if > year 2000
    const unixMs = parseInt(trimmed, 10);
    if (!isNaN(unixMs) && unixMs > UNIX_TIMESTAMP_BOUNDS.MIN_MILLISECONDS) {
      return new Date(unixMs);
    }

    return null;
  }
}
