import { Injectable, Logger } from '@nestjs/common';

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { access, constants } from 'fs/promises';

import { MarketDataSet } from './market-data-set.entity';

import { toErrorInfo } from '../../shared/error.util';

/**
 * Validation error with error code and message.
 */
export interface ValidationError {
  code: 'CHECKSUM_MISMATCH' | 'NO_DATE_OVERLAP' | 'INVALID_DATE_RANGE' | 'DATASET_NOT_FOUND' | 'STORAGE_NOT_ACCESSIBLE';
  message: string;
}

/**
 * Result of dataset validation.
 */
export interface ValidationResult {
  /** Whether the dataset passed validation */
  valid: boolean;
  /** Validation errors (empty if valid) */
  errors: ValidationError[];
  /** Warnings that don't prevent execution but should be noted */
  warnings: string[];
}

/**
 * Backtest configuration for validation purposes.
 */
export interface BacktestConfigForValidation {
  /** Start date for the backtest */
  startDate: Date;
  /** End date for the backtest */
  endDate: Date;
  /** Coin IDs to be used in the backtest */
  coinIds?: string[];
}

/**
 * Service for validating market data sets before backtest execution.
 * Provides checksum verification, date range overlap validation, and instrument coverage checks.
 */
@Injectable()
export class DatasetValidatorService {
  private readonly logger = new Logger(DatasetValidatorService.name);

  /**
   * Validates a dataset against the backtest configuration.
   *
   * @param dataset - The market data set to validate
   * @param config - The backtest configuration to validate against
   * @returns Validation result with errors and warnings
   */
  async validateDataset(dataset: MarketDataSet, config: BacktestConfigForValidation): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // 1. Checksum verification (for CSV datasets with storage location)
    if (dataset.storageLocation && dataset.checksum) {
      const checksumResult = await this.verifyChecksum(dataset);
      if (!checksumResult.valid) {
        errors.push({
          code: 'CHECKSUM_MISMATCH',
          message: checksumResult.message
        });
      }
      if (checksumResult.warning) {
        warnings.push(checksumResult.warning);
      }
    }

    // 2. Date range validation
    const dateRangeResult = this.validateDateRangeOverlap(dataset, config);
    if (!dateRangeResult.valid) {
      errors.push({
        code: 'NO_DATE_OVERLAP',
        message: dateRangeResult.message
      });
    } else if (dateRangeResult.warning) {
      warnings.push(dateRangeResult.warning);
    }

    // 3. Instrument coverage check
    if (config.coinIds && config.coinIds.length > 0) {
      const coverageResult = this.validateInstrumentCoverage(dataset, config.coinIds);
      if (coverageResult.missing.length > 0) {
        warnings.push(`Missing instruments in dataset: ${coverageResult.missing.join(', ')}`);
      }
      if (coverageResult.coverage < 0.5) {
        warnings.push(
          `Low instrument coverage: only ${(coverageResult.coverage * 100).toFixed(1)}% of requested instruments are available`
        );
      }
    }

    // 4. Dataset integrity score check
    if (dataset.integrityScore < 50) {
      warnings.push(`Dataset integrity score is very low (${dataset.integrityScore}%). Results may be unreliable.`);
    } else if (dataset.integrityScore < 80) {
      warnings.push(`Dataset integrity score is below optimal (${dataset.integrityScore}%).`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Verifies the checksum of a dataset file using streaming to handle large files.
   *
   * @param dataset - Dataset with storage location and checksum
   * @returns Verification result with optional warning
   */
  private async verifyChecksum(dataset: MarketDataSet): Promise<{ valid: boolean; message: string; warning?: string }> {
    try {
      // Only verify local file checksums (MinIO/S3 checksums are verified by the storage service)
      if (
        !dataset.storageLocation ||
        dataset.storageLocation.startsWith('s3://') ||
        dataset.storageLocation.startsWith('minio://')
      ) {
        // Skip checksum verification for remote storage - handled by storage service
        return { valid: true, message: 'Remote storage checksum verification delegated to storage service' };
      }

      // Check if file exists before attempting to read
      try {
        await access(dataset.storageLocation, constants.R_OK);
      } catch {
        this.logger.warn(`Dataset file not accessible for checksum verification: ${dataset.storageLocation}`);
        return {
          valid: true,
          message: 'Checksum verification skipped',
          warning: `Dataset file not accessible for verification: ${dataset.storageLocation}`
        };
      }

      // Use streaming to compute checksum for large files without memory exhaustion
      const computedChecksum = await this.computeStreamingChecksum(dataset.storageLocation);

      if (computedChecksum !== dataset.checksum) {
        return {
          valid: false,
          message: `Dataset checksum mismatch: expected ${dataset.checksum}, computed ${computedChecksum}. Data may be corrupted.`
        };
      }

      return { valid: true, message: 'Checksum verified' };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Unable to verify checksum for dataset ${dataset.id}: ${err.message}`);
      return {
        valid: true,
        message: 'Checksum verification skipped due to error',
        warning: `Checksum verification failed: ${err.message}`
      };
    }
  }

  /**
   * Computes SHA-256 checksum of a file using streaming to handle large files.
   *
   * @param filePath - Path to the file
   * @returns First 16 characters of the hex-encoded SHA-256 hash
   */
  private computeStreamingChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex').substring(0, 16)));
      stream.on('error', (error) => reject(error));
    });
  }

  /**
   * Validates that the backtest date range overlaps with the dataset's date range.
   *
   * @param dataset - Dataset with start and end dates
   * @param config - Backtest configuration with date range
   * @returns Validation result with overlap details
   */
  private validateDateRangeOverlap(
    dataset: MarketDataSet,
    config: BacktestConfigForValidation
  ): { valid: boolean; message: string; warning?: string } {
    const datasetStart = new Date(dataset.startAt);
    const datasetEnd = new Date(dataset.endAt);
    const backtestStart = new Date(config.startDate);
    const backtestEnd = new Date(config.endDate);

    // Check for invalid date ranges
    if (backtestStart >= backtestEnd) {
      return {
        valid: false,
        message: 'Backtest start date must be before end date'
      };
    }

    if (datasetStart >= datasetEnd) {
      return {
        valid: false,
        message: 'Dataset start date must be before end date'
      };
    }

    // Calculate overlap
    const overlapStart = new Date(Math.max(datasetStart.getTime(), backtestStart.getTime()));
    const overlapEnd = new Date(Math.min(datasetEnd.getTime(), backtestEnd.getTime()));

    if (overlapStart >= overlapEnd) {
      return {
        valid: false,
        message: `No overlap between dataset date range (${datasetStart.toISOString()} to ${datasetEnd.toISOString()}) and backtest date range (${backtestStart.toISOString()} to ${backtestEnd.toISOString()})`
      };
    }

    // Calculate overlap percentage
    const backtestDuration = backtestEnd.getTime() - backtestStart.getTime();
    const overlapDuration = overlapEnd.getTime() - overlapStart.getTime();
    const overlapPercentage = (overlapDuration / backtestDuration) * 100;

    let warning: string | undefined;
    if (overlapPercentage < 100) {
      warning = `Backtest date range only ${overlapPercentage.toFixed(1)}% covered by dataset. Effective range: ${overlapStart.toISOString()} to ${overlapEnd.toISOString()}`;
    }

    return { valid: true, message: 'Date ranges overlap', warning };
  }

  /**
   * Validates that the dataset contains data for the requested instruments.
   *
   * @param dataset - Dataset with instrument universe
   * @param requestedCoinIds - Coin IDs requested for the backtest
   * @returns Coverage result
   */
  private validateInstrumentCoverage(
    dataset: MarketDataSet,
    requestedCoinIds: string[]
  ): { coverage: number; missing: string[]; available: string[] } {
    const instrumentSet = new Set((dataset.instrumentUniverse ?? []).map((s) => s.toUpperCase()));

    const available: string[] = [];
    const missing: string[] = [];

    for (const coinId of requestedCoinIds) {
      const upperCoinId = coinId.toUpperCase();
      if (instrumentSet.has(upperCoinId)) {
        available.push(coinId);
      } else {
        // Also try with common quote currency suffixes
        const withSuffixes = [`${upperCoinId}USDT`, `${upperCoinId}USD`, `${upperCoinId}BTC`];
        const found = withSuffixes.some((s) => instrumentSet.has(s));
        if (found) {
          available.push(coinId);
        } else {
          missing.push(coinId);
        }
      }
    }

    const coverage = requestedCoinIds.length > 0 ? available.length / requestedCoinIds.length : 1;

    return { coverage, missing, available };
  }

  /**
   * Quick validation check for critical errors only.
   * Use this for pre-flight checks before queueing a backtest.
   *
   * @param dataset - Dataset to validate
   * @param config - Backtest configuration
   * @returns True if no critical errors, false otherwise
   */
  async quickValidate(dataset: MarketDataSet, config: BacktestConfigForValidation): Promise<boolean> {
    const result = await this.validateDataset(dataset, config);
    return result.valid;
  }
}
