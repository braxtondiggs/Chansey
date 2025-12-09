import { Injectable } from '@nestjs/common';

import { WindowMetrics } from '@chansey/api-interfaces';

export interface DegradationAnalysis {
  overallDegradation: number;
  metricDegradations: {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    volatility: number;
  };
  severity: 'excellent' | 'good' | 'acceptable' | 'warning' | 'critical';
  recommendation: string;
}

/**
 * Degradation Calculator
 * Calculates performance degradation from training to test periods
 * Used for overfitting detection in walk-forward analysis
 */
@Injectable()
export class DegradationCalculator {
  /**
   * Calculate comprehensive degradation analysis
   */
  calculate(trainMetrics: WindowMetrics, testMetrics: WindowMetrics): DegradationAnalysis {
    const metricDegradations = {
      sharpeRatio: this.calculateSharpeDegrad(trainMetrics.sharpeRatio, testMetrics.sharpeRatio),
      totalReturn: this.calculateReturnDegrad(trainMetrics.totalReturn, testMetrics.totalReturn),
      maxDrawdown: this.calculateDrawdownDegrad(trainMetrics.maxDrawdown, testMetrics.maxDrawdown),
      winRate: this.calculateWinRateDegrad(trainMetrics.winRate, testMetrics.winRate),
      profitFactor: this.calculateProfitFactorDegrad(trainMetrics.profitFactor || 1, testMetrics.profitFactor || 1),
      volatility: this.calculateVolatilityDegrad(trainMetrics.volatility, testMetrics.volatility)
    };

    // Weighted overall degradation
    const overallDegradation = this.calculateWeightedDegradation(metricDegradations);

    // Determine severity
    const severity = this.determineSeverity(overallDegradation);

    // Generate recommendation
    const recommendation = this.generateRecommendation(severity, metricDegradations);

    return {
      overallDegradation,
      metricDegradations,
      severity,
      recommendation
    };
  }

  /**
   * Calculate Sharpe ratio degradation
   * Higher Sharpe in train but lower in test indicates overfitting
   */
  private calculateSharpeDegrad(trainSharpe: number, testSharpe: number): number {
    if (trainSharpe === 0) return 0;

    return ((trainSharpe - testSharpe) / Math.abs(trainSharpe)) * 100;
  }

  /**
   * Calculate return degradation
   */
  private calculateReturnDegrad(trainReturn: number, testReturn: number): number {
    if (trainReturn === 0) return 0;

    return ((trainReturn - testReturn) / Math.abs(trainReturn)) * 100;
  }

  /**
   * Calculate drawdown degradation
   * Worse drawdown in test (more negative) indicates poor generalization
   */
  private calculateDrawdownDegrad(trainDrawdown: number, testDrawdown: number): number {
    // Drawdowns are negative, so worse test = more negative
    if (trainDrawdown === 0) return 0;

    // Positive degradation = test drawdown is worse
    return ((testDrawdown - trainDrawdown) / Math.abs(trainDrawdown)) * 100;
  }

  /**
   * Calculate win rate degradation
   */
  private calculateWinRateDegrad(trainWinRate: number, testWinRate: number): number {
    if (trainWinRate === 0) return 0;

    return ((trainWinRate - testWinRate) / trainWinRate) * 100;
  }

  /**
   * Calculate profit factor degradation
   */
  private calculateProfitFactorDegrad(trainPF: number, testPF: number): number {
    if (trainPF === 0) return 0;

    return ((trainPF - testPF) / trainPF) * 100;
  }

  /**
   * Calculate volatility degradation
   * Higher volatility in test indicates unstable performance
   */
  private calculateVolatilityDegrad(trainVol: number, testVol: number): number {
    if (trainVol === 0) return 0;

    return ((testVol - trainVol) / trainVol) * 100;
  }

  /**
   * Calculate weighted overall degradation
   * Weights based on research.md scoring framework
   */
  private calculateWeightedDegradation(metricDegradations: {
    sharpeRatio: number;
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    volatility: number;
  }): number {
    const weights = {
      sharpeRatio: 0.3, // Most important
      totalReturn: 0.25,
      winRate: 0.15,
      profitFactor: 0.15,
      maxDrawdown: 0.1,
      volatility: 0.05
    };

    return (
      metricDegradations.sharpeRatio * weights.sharpeRatio +
      metricDegradations.totalReturn * weights.totalReturn +
      metricDegradations.winRate * weights.winRate +
      metricDegradations.profitFactor * weights.profitFactor +
      metricDegradations.maxDrawdown * weights.maxDrawdown +
      metricDegradations.volatility * weights.volatility
    );
  }

  /**
   * Determine severity level based on degradation percentage
   */
  private determineSeverity(degradation: number): 'excellent' | 'good' | 'acceptable' | 'warning' | 'critical' {
    if (degradation < 0) {
      return 'excellent'; // Performance improved in test!
    } else if (degradation < 10) {
      return 'excellent'; // Minimal degradation
    } else if (degradation < 20) {
      return 'good'; // Acceptable degradation
    } else if (degradation < 30) {
      return 'acceptable'; // Within threshold
    } else if (degradation < 50) {
      return 'warning'; // Concerning degradation
    } else {
      return 'critical'; // Severe overfitting
    }
  }

  /**
   * Generate recommendation based on severity and metric degradations
   */
  private generateRecommendation(
    severity: string,
    metricDegradations: {
      sharpeRatio: number;
      totalReturn: number;
      maxDrawdown: number;
      winRate: number;
      profitFactor: number;
      volatility: number;
    }
  ): string {
    if (severity === 'excellent') {
      return 'Strategy generalizes well to out-of-sample data. Proceed with confidence.';
    }

    if (severity === 'good') {
      return 'Strategy shows good generalization with minor performance degradation. Acceptable for deployment.';
    }

    if (severity === 'acceptable') {
      return 'Strategy within acceptable degradation threshold. Monitor closely during live trading.';
    }

    // Identify problem areas
    const problems: string[] = [];

    if (metricDegradations.sharpeRatio > 30) {
      problems.push('significant Sharpe ratio drop');
    }
    if (metricDegradations.totalReturn > 40) {
      problems.push('large return degradation');
    }
    if (metricDegradations.winRate > 25) {
      problems.push('win rate decline');
    }
    if (metricDegradations.maxDrawdown > 50) {
      problems.push('increased drawdown risk');
    }

    if (severity === 'warning') {
      return `Strategy shows concerning degradation (${problems.join(', ')}). Consider parameter optimization or reject.`;
    }

    // Critical
    return `Critical overfitting detected (${problems.join(', ')}). DO NOT deploy. Revise strategy parameters.`;
  }

  /**
   * Check if degradation is within acceptable limits
   */
  isAcceptable(degradation: number, threshold = 30): boolean {
    return degradation <= threshold;
  }

  /**
   * Check if degradation indicates critical overfitting
   */
  isCritical(degradation: number, threshold = 50): boolean {
    return degradation > threshold;
  }
}
