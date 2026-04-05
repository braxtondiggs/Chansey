/**
 * Market Data Reader Service
 *
 * Reads and parses market data CSV files from MinIO storage using stream-based parsing.
 * Supports OHLCV (Open, High, Low, Close, Volume) format for backtesting.
 */

import { Injectable, Logger } from '@nestjs/common';

import { Options, parse } from 'csv-parse';

import { MarketDataSet } from './market-data-set.entity';
import { parseStorageLocation } from './storage-path.util';

import { toErrorInfo } from '../../shared/error.util';
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
 * Provides the data layer for backtesting by reading historical OHLCV data from
 * CSV files in object storage. Handles CSV parsing, column alias mapping, and date filtering.
 *
 * @see {@link StorageService} for underlying MinIO operations
 * @see {@link MarketDataSet} for dataset configuration entity
 * @see {@link parseStorageLocation} for storage URL/path resolution
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

    const objectPath = parseStorageLocation(dataset.storageLocation);

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

    let timer: NodeJS.Timeout | undefined;
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
      if (timer) clearTimeout(timer);
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
        } catch (error: unknown) {
          const message = toErrorInfo(error).message;
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
