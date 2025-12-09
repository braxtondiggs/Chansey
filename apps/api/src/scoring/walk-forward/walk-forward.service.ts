import { Injectable, Logger } from '@nestjs/common';

import { WalkForwardConfig } from '@chansey/api-interfaces';

export interface WalkForwardWindowConfig {
  windowIndex: number;
  trainStartDate: Date;
  trainEndDate: Date;
  testStartDate: Date;
  testEndDate: Date;
}

export interface GenerateWindowsParams {
  startDate: Date;
  endDate: Date;
  trainDays: number;
  testDays: number;
  stepDays: number;
  method?: 'rolling' | 'anchored';
}

/**
 * Walk-Forward Analysis Service
 * Generates train/test windows for out-of-sample validation
 * Prevents overfitting by testing strategies on unseen data
 */
@Injectable()
export class WalkForwardService {
  private readonly logger = new Logger(WalkForwardService.name);

  /**
   * Generate walk-forward windows
   * @param params Window generation parameters
   * @returns Array of window configurations
   */
  generateWindows(params: GenerateWindowsParams): WalkForwardWindowConfig[] {
    const { startDate, endDate, trainDays, testDays, stepDays, method = 'rolling' } = params;

    // Validate inputs
    if (trainDays <= 0 || testDays <= 0 || stepDays <= 0) {
      throw new Error('trainDays, testDays, and stepDays must be positive');
    }

    if (startDate >= endDate) {
      throw new Error('startDate must be before endDate');
    }

    const windows: WalkForwardWindowConfig[] = [];
    let windowIndex = 0;
    let currentDate = new Date(startDate);
    let continueGenerating = true;

    while (continueGenerating && windowIndex <= 1000) {
      // Calculate train window
      const trainStartDate = method === 'rolling' ? new Date(currentDate) : new Date(startDate);
      const trainEndDate = this.addDays(trainStartDate, trainDays);

      // Check if train window exceeds end date
      if (trainEndDate > endDate) {
        continueGenerating = false;
        continue;
      }

      // Calculate test window (immediately after train window)
      const testStartDate = new Date(trainEndDate);
      testStartDate.setDate(testStartDate.getDate() + 1); // Next day after train end
      const testEndDate = this.addDays(testStartDate, testDays);

      // Check if test window exceeds end date
      if (testEndDate > endDate) {
        continueGenerating = false;
        continue;
      }

      // Add window
      windows.push({
        windowIndex,
        trainStartDate,
        trainEndDate,
        testStartDate,
        testEndDate
      });

      // Move to next window
      currentDate = this.addDays(currentDate, stepDays);
      windowIndex++;
    }

    // Safety check: log warning if max windows reached
    if (windowIndex > 1000) {
      this.logger.warn('Window generation exceeded 1000 windows, stopping');
    }

    this.logger.log(
      `Generated ${windows.length} walk-forward windows (${method} method, ${trainDays}d train / ${testDays}d test / ${stepDays}d step)`
    );

    return windows;
  }

  /**
   * Generate standard walk-forward configuration
   * Default: 180 days train, 90 days test, 30 days step
   */
  generateStandardWindows(startDate: Date, endDate: Date): WalkForwardWindowConfig[] {
    return this.generateWindows({
      startDate,
      endDate,
      trainDays: 180,
      testDays: 90,
      stepDays: 30,
      method: 'rolling'
    });
  }

  /**
   * Validate walk-forward configuration
   */
  validateConfig(config: WalkForwardConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.trainDays <= 0) {
      errors.push('trainDays must be positive');
    }

    if (config.testDays <= 0) {
      errors.push('testDays must be positive');
    }

    if (config.stepDays <= 0) {
      errors.push('stepDays must be positive');
    }

    if (config.trainDays < 30) {
      errors.push('trainDays should be at least 30 for statistical significance');
    }

    if (config.testDays < 14) {
      errors.push('testDays should be at least 14 for meaningful out-of-sample testing');
    }

    if (config.stepDays > config.trainDays) {
      errors.push('stepDays should not exceed trainDays to ensure overlap');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Calculate total data days required
   */
  calculateRequiredDays(config: WalkForwardConfig, numWindows: number): number {
    if (config.method === 'anchored') {
      // Anchored: train window grows, test windows stack
      return config.trainDays + numWindows * config.testDays;
    } else {
      // Rolling: windows move forward
      return config.trainDays + config.testDays + (numWindows - 1) * config.stepDays;
    }
  }

  /**
   * Estimate number of windows for date range
   */
  estimateWindowCount(startDate: Date, endDate: Date, config: WalkForwardConfig): number {
    const totalDays = this.daysBetween(startDate, endDate);
    const windowSize = config.trainDays + config.testDays;

    if (totalDays < windowSize) {
      return 0;
    }

    // Calculate max possible windows
    const maxWindows = Math.floor((totalDays - windowSize) / config.stepDays) + 1;

    return maxWindows;
  }

  /**
   * Get window overlap percentage (for rolling windows)
   */
  calculateOverlapPercentage(config: WalkForwardConfig): number {
    if (config.method === 'anchored') {
      return 0; // No overlap in anchored mode
    }

    const overlap = config.trainDays - config.stepDays;
    return (overlap / config.trainDays) * 100;
  }

  /**
   * Add days to a date
   */
  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Calculate days between two dates
   */
  private daysBetween(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000; // milliseconds in a day
    return Math.round(Math.abs((date2.getTime() - date1.getTime()) / oneDay));
  }

  /**
   * Format window for logging
   */
  formatWindow(window: WalkForwardWindowConfig): string {
    return `Window ${window.windowIndex}: Train ${this.formatDate(window.trainStartDate)}-${this.formatDate(
      window.trainEndDate
    )}, Test ${this.formatDate(window.testStartDate)}-${this.formatDate(window.testEndDate)}`;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
