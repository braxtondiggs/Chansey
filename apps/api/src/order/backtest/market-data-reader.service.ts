/**
 * Market Data Reader Service
 *
 * Reads and parses market data CSV files from MinIO storage using stream-based parsing.
 * Supports OHLCV (Open, High, Low, Close, Volume) format for backtesting.
 */

import { Injectable, Logger } from '@nestjs/common';

import { Options, parse } from 'csv-parse';

import * as path from 'path';

import { MarketDataSet } from './market-data-set.entity';

import { StorageService } from '../../storage/storage.service';

/**
 * Maximum allowed CSV file size (500MB)
 * Stream-based parsing supports larger files with constant memory usage
 */
const MAX_CSV_FILE_SIZE_BYTES = 500 * 1024 * 1024;

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

interface ParsedRow {
  timestamp: string;
  close: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  symbol?: string;
  _lineNumber: number;
}

/**
 * Column alias mappings: canonical name -> aliases
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  timestamp: ['time', 'date', 'datetime'],
  close: ['c', 'price'],
  open: ['o'],
  high: ['h'],
  low: ['l'],
  volume: ['vol', 'v'],
  symbol: ['coin', 'asset', 'ticker']
};

/**
 * Service for reading and parsing market data CSV files from MinIO/S3 storage.
 *
 * This service provides the data layer for backtesting by reading historical OHLCV
 * (Open, High, Low, Close, Volume) data from CSV files stored in object storage.
 * It handles multiple storage location formats, CSV parsing, and date filtering.
 *
 * ## Supported CSV Format
 *
 * The CSV must include a header row with the following columns:
 *
 * | Column      | Required | Aliases                              | Description                    |
 * |-------------|----------|--------------------------------------|--------------------------------|
 * | timestamp   | Yes      | `time`, `date`, `datetime`           | Candle timestamp               |
 * | close       | Yes      | `c`, `price`                         | Closing price                  |
 * | open        | No       | `o`                                  | Opening price (defaults to close) |
 * | high        | No       | `h`                                  | High price (defaults to close) |
 * | low         | No       | `l`                                  | Low price (defaults to close)  |
 * | volume      | No       | `vol`, `v`                           | Trading volume (defaults to 0) |
 * | symbol      | No       | `coin`, `asset`, `ticker`            | Asset symbol (defaults to first in instrumentUniverse) |
 *
 * ## Supported Timestamp Formats
 *
 * - ISO 8601: `2024-01-01T00:00:00Z`
 * - Unix seconds: `1704067200` (valid range: 2000-2100)
 * - Unix milliseconds: `1704067200000` (valid if > year 2000)
 *
 * ## Example CSV
 *
 * ```csv
 * timestamp,open,high,low,close,volume,symbol
 * 2024-01-01T00:00:00Z,42000.50,42150.00,41900.00,42100.00,1500.5,BTC
 * 2024-01-01T01:00:00Z,42100.00,42200.00,42000.00,42150.00,1200.0,BTC
 * ```
 *
 * ## Storage Location Formats
 *
 * - Direct path: `datasets/btc-hourly.csv`
 * - S3 URL: `s3://bucket/datasets/btc-hourly.csv`
 * - HTTP URL: `http://minio:9000/bucket/datasets/btc-hourly.csv`
 *
 * @see {@link StorageService} for underlying MinIO operations
 * @see {@link MarketDataSet} for dataset configuration entity
 */
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
   * Read market data from a dataset's storage location using stream-based parsing
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

    // Stream-parse CSV with a 5-minute timeout
    const abortController = new AbortController();
    const timeoutMs = 5 * 60 * 1000;

    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`CSV parsing timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      // Allow process to exit if this is the only timer
      if (timer.unref) timer.unref();
    });

    const parsePromise = this.streamParseCSV(
      objectPath,
      dataset.instrumentUniverse,
      abortController.signal,
      startDate,
      endDate
    );

    try {
      const filteredData = await Promise.race([parsePromise, timeoutPromise]);

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
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Stream-parse a CSV file from storage into OHLCVData[]
   */
  private async streamParseCSV(
    objectPath: string,
    instrumentUniverse: string[],
    signal: AbortSignal,
    startDate?: Date,
    endDate?: Date
  ): Promise<OHLCVData[]> {
    const dataStream = await this.storageService.getFileStream(objectPath);
    const defaultCoinId = instrumentUniverse.length > 0 ? instrumentUniverse[0] : 'UNKNOWN';

    const parserOptions: Options = {
      columns: (header: string[]) => this.mapColumnNames(header),
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
      on_record: (record, context) => {
        (record as unknown as ParsedRow)._lineNumber = context.lines;
        return record;
      }
    };
    const parser = parse(parserOptions);

    const data: OHLCVData[] = [];
    const errors: string[] = [];
    let totalRows = 0;

    return new Promise<OHLCVData[]>((resolve, reject) => {
      let settled = false;
      const safeResolve = (val: OHLCVData[]) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      const safeReject = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      const cleanup = () => {
        dataStream.destroy();
        parser.destroy();
      };

      const onAbort = () => {
        cleanup();
        safeReject(new Error('CSV parsing aborted'));
      };

      if (signal.aborted) {
        cleanup();
        safeReject(new Error('CSV parsing aborted'));
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });

      dataStream.pipe(parser);

      parser.on('data', (row: ParsedRow) => {
        totalRows++;
        try {
          const parsed = this.parseRow(row, defaultCoinId, startDate, endDate);
          if (parsed) {
            data.push(parsed);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (errors.length < 1000) {
            errors.push(`Line ${row._lineNumber}: ${message}`);
          } else if (errors.length === 1000) {
            errors.push('... additional errors truncated');
          }
        }
      });

      parser.on('error', (error: Error) => {
        signal.removeEventListener('abort', onAbort);
        cleanup();
        safeReject(new Error(`CSV parsing error: ${error.message}`));
      });

      parser.on('end', () => {
        signal.removeEventListener('abort', onAbort);

        if (errors.length > 0 && totalRows > 0 && errors.length > totalRows * 0.1) {
          this.logger.warn(`CSV parsing had ${errors.length} errors out of ${totalRows} rows`);
        }

        if (data.length === 0) {
          const reason =
            totalRows > 0 && (startDate || endDate)
              ? 'all valid rows were outside the requested date range'
              : 'the file contains no valid data rows';
          safeReject(
            new Error(`No market data loaded because ${reason}. Parse errors: ${errors.slice(0, 5).join('; ')}`)
          );
          return;
        }

        safeResolve(data);
      });
    });
  }

  /**
   * Map CSV header column names to canonical names using alias mappings.
   * Validates that required columns (timestamp, close) are present.
   * @throws Error if required columns are missing
   */
  private mapColumnNames(header: string[]): string[] {
    const lowerHeader = header.map((h) => h.toLowerCase().trim());

    const mapped = lowerHeader.map((col) => {
      // Check if it's already a canonical name
      if (COLUMN_ALIASES[col]) return col;

      // Check aliases
      for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.includes(col)) return canonical;
      }

      // Unknown column — pass through
      return col;
    });

    if (!mapped.includes('timestamp')) {
      throw new Error('CSV must have a timestamp column (timestamp, time, date, or datetime)');
    }
    if (!mapped.includes('close')) {
      throw new Error('CSV must have a close/price column');
    }

    return mapped;
  }

  /**
   * Parse a single CSV row into OHLCVData.
   * Returns null if the row is filtered out by date range (not an error).
   * Throws for invalid data.
   */
  private parseRow(row: ParsedRow, defaultCoinId: string, startDate?: Date, endDate?: Date): OHLCVData | null {
    const timestamp = this.parseTimestamp(row.timestamp);
    if (!timestamp) {
      throw new Error('Invalid timestamp');
    }

    // Filter by date range inline — filtered rows never enter the result array
    if (startDate && timestamp < startDate) return null;
    if (endDate && timestamp > endDate) return null;

    const close = parseFloat(row.close);
    if (isNaN(close)) {
      throw new Error('Invalid close price');
    }

    const open = row.open !== undefined ? parseFloat(row.open) : close;
    const high = row.high !== undefined ? parseFloat(row.high) : close;
    const low = row.low !== undefined ? parseFloat(row.low) : close;
    const volume = row.volume !== undefined ? parseFloat(row.volume) : 0;
    const coinId = row.symbol ?? defaultCoinId;

    return {
      timestamp,
      open: isNaN(open) ? close : open,
      high: isNaN(high) ? close : high,
      low: isNaN(low) ? close : low,
      close,
      volume: isNaN(volume) ? 0 : volume,
      coinId: coinId.toUpperCase()
    };
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

    // Try Unix timestamp - parse once, check both seconds and milliseconds ranges
    const unixValue = parseInt(trimmed, 10);
    if (!isNaN(unixValue)) {
      // Check if it's Unix seconds (valid range: 2000-2100)
      if (unixValue > UNIX_TIMESTAMP_BOUNDS.MIN_SECONDS && unixValue < UNIX_TIMESTAMP_BOUNDS.MAX_SECONDS) {
        return new Date(unixValue * 1000);
      }
      // Check if it's Unix milliseconds (valid if > year 2000)
      if (unixValue > UNIX_TIMESTAMP_BOUNDS.MIN_MILLISECONDS) {
        return new Date(unixValue);
      }
    }

    return null;
  }
}
