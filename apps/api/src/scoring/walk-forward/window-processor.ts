import { Injectable, Logger } from '@nestjs/common';

import { WindowMetrics } from '@chansey/api-interfaces';

import { WalkForwardWindowConfig } from './walk-forward.service';

export interface WindowProcessingResult {
  windowIndex: number;
  trainMetrics: WindowMetrics;
  testMetrics: WindowMetrics;
  degradation: number;
  overfittingDetected: boolean;
}

/**
 * Walk-Forward Window Processor
 * Processes individual train/test windows and detects overfitting
 */
@Injectable()
export class WindowProcessor {
  private readonly logger = new Logger(WindowProcessor.name);

  /**
   * Process a single walk-forward window
   * Executes backtest on train and test periods, calculates degradation
   */
  async processWindow(
    window: WalkForwardWindowConfig,
    trainResults: WindowMetrics,
    testResults: WindowMetrics
  ): Promise<WindowProcessingResult> {
    // Calculate degradation (performance drop from train to test)
    const degradation = this.calculateDegradation(trainResults, testResults);

    // Detect overfitting
    const overfittingDetected = this.detectOverfitting(degradation, trainResults, testResults);

    if (overfittingDetected) {
      this.logger.warn(`Overfitting detected in window ${window.windowIndex}: ${degradation.toFixed(2)}% degradation`);
    }

    return {
      windowIndex: window.windowIndex,
      trainMetrics: trainResults,
      testMetrics: testResults,
      degradation,
      overfittingDetected
    };
  }

  /**
   * Calculate performance degradation from train to test
   * Uses multiple metrics for comprehensive evaluation
   */
  calculateDegradation(trainMetrics: WindowMetrics, testMetrics: WindowMetrics): number {
    // Primary metric: Sharpe ratio degradation
    const sharpeDegradation = this.calculateMetricDegradation(trainMetrics.sharpeRatio, testMetrics.sharpeRatio);

    // Secondary metrics
    const returnDegradation = this.calculateMetricDegradation(trainMetrics.totalReturn, testMetrics.totalReturn);

    const profitFactorDegradation = this.calculateMetricDegradation(
      trainMetrics.profitFactor || 1,
      testMetrics.profitFactor || 1
    );

    // Weighted average degradation
    const weightedDegradation =
      sharpeDegradation * 0.5 + // Sharpe is most important
      returnDegradation * 0.3 + // Return is secondary
      profitFactorDegradation * 0.2; // Profit factor is tertiary

    return weightedDegradation;
  }

  /**
   * Calculate degradation for a single metric
   * Positive values indicate degradation, negative indicate improvement
   */
  private calculateMetricDegradation(trainValue: number, testValue: number): number {
    if (trainValue === 0) return 0;

    // Percentage change from train to test
    const change = ((trainValue - testValue) / Math.abs(trainValue)) * 100;

    return change;
  }

  /**
   * Detect overfitting based on degradation thresholds
   */
  detectOverfitting(degradation: number, trainMetrics: WindowMetrics, testMetrics: WindowMetrics): boolean {
    // Critical degradation threshold: 30%
    if (degradation > 30) {
      return true;
    }

    // Sharpe ratio drops significantly
    if (trainMetrics.sharpeRatio > 1.0 && testMetrics.sharpeRatio < 0.5) {
      return true;
    }

    // Positive train returns but negative test returns
    if (trainMetrics.totalReturn > 0 && testMetrics.totalReturn < -0.05) {
      return true;
    }

    // Win rate drops more than 20 percentage points (0.20 in decimal scale)
    if (trainMetrics.winRate - testMetrics.winRate > 0.2) {
      return true;
    }

    return false;
  }

  /**
   * Aggregate results across all windows
   */
  aggregateWindowResults(windows: WindowProcessingResult[]): {
    avgDegradation: number;
    maxDegradation: number;
    minDegradation: number;
    overfittingCount: number;
    consistencyScore: number;
  } {
    if (windows.length === 0) {
      return {
        avgDegradation: 0,
        maxDegradation: 0,
        minDegradation: 0,
        overfittingCount: 0,
        consistencyScore: 0
      };
    }

    const degradations = windows.map((w) => w.degradation);
    const overfittingCount = windows.filter((w) => w.overfittingDetected).length;

    const avgDegradation = degradations.reduce((sum, d) => sum + d, 0) / degradations.length;
    const maxDegradation = Math.max(...degradations);
    const minDegradation = Math.min(...degradations);

    // Consistency score: lower degradation variance = higher consistency
    const degradationStdDev = this.calculateStdDev(degradations);
    const consistencyScore = Math.max(0, 100 - degradationStdDev * 2); // 0-100 scale

    return {
      avgDegradation,
      maxDegradation,
      minDegradation,
      overfittingCount,
      consistencyScore
    };
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;

    return Math.sqrt(variance);
  }

  /**
   * Generate degradation report
   */
  generateDegradationReport(windows: WindowProcessingResult[]): string {
    const agg = this.aggregateWindowResults(windows);

    return `
Walk-Forward Analysis Results:
- Total Windows: ${windows.length}
- Average Degradation: ${agg.avgDegradation.toFixed(2)}%
- Max Degradation: ${agg.maxDegradation.toFixed(2)}%
- Min Degradation: ${agg.minDegradation.toFixed(2)}%
- Overfitting Detected: ${agg.overfittingCount} windows
- Consistency Score: ${agg.consistencyScore.toFixed(0)}/100
    `.trim();
  }
}
