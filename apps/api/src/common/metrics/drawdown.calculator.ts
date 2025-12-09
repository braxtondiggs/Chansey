import { Injectable } from '@nestjs/common';

export interface DrawdownResult {
  maxDrawdown: number;
  maxDrawdownPercentage: number;
  currentDrawdown: number;
  drawdownDuration: number;
  peakDate?: number; // Index of peak
  troughDate?: number; // Index of trough
  recoveryDate?: number; // Index of recovery (null if not recovered)
}

export interface DrawdownPeriod {
  startIndex: number;
  endIndex: number;
  recoveryIndex?: number;
  drawdown: number;
  duration: number;
}

/**
 * Drawdown Calculator
 * Measures peak-to-trough decline in cumulative returns
 */
@Injectable()
export class DrawdownCalculator {
  /**
   * Calculate maximum drawdown from cumulative returns
   * @param cumulativeReturns Array of cumulative returns (equity curve)
   */
  calculateMaxDrawdown(cumulativeReturns: number[]): DrawdownResult {
    if (cumulativeReturns.length === 0) {
      return {
        maxDrawdown: 0,
        maxDrawdownPercentage: 0,
        currentDrawdown: 0,
        drawdownDuration: 0
      };
    }

    let maxDrawdown = 0;
    let maxDrawdownPercentage = 0;
    let peak = cumulativeReturns[0];
    let peakIndex = 0;
    let troughIndex = 0;
    let currentDrawdown = 0;

    for (let i = 1; i < cumulativeReturns.length; i++) {
      const value = cumulativeReturns[i];

      // Update peak
      if (value > peak) {
        peak = value;
        peakIndex = i;
      }

      // Calculate drawdown from peak
      const drawdown = peak - value;
      const drawdownPercentage = peak !== 0 ? (drawdown / peak) * 100 : 0;

      // Update max drawdown
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercentage = drawdownPercentage;
        troughIndex = i;
      }

      // Update current drawdown
      currentDrawdown = peak - value;
    }

    // Calculate drawdown duration (from peak to trough)
    const drawdownDuration = troughIndex - peakIndex;

    // Check if recovered (current value equals or exceeds peak)
    const currentValue = cumulativeReturns[cumulativeReturns.length - 1];
    const recoveryIndex = currentValue >= peak ? cumulativeReturns.length - 1 : undefined;

    return {
      maxDrawdown,
      maxDrawdownPercentage,
      currentDrawdown,
      drawdownDuration,
      peakDate: peakIndex,
      troughDate: troughIndex,
      recoveryDate: recoveryIndex
    };
  }

  /**
   * Calculate drawdown from period returns
   */
  calculateFromReturns(returns: number[]): DrawdownResult {
    const cumulativeReturns = this.convertToCumulativeReturns(returns);
    return this.calculateMaxDrawdown(cumulativeReturns);
  }

  /**
   * Calculate all drawdown periods
   */
  calculateAllDrawdowns(cumulativeReturns: number[]): DrawdownPeriod[] {
    const drawdowns: DrawdownPeriod[] = [];
    let peak = cumulativeReturns[0];
    let peakIndex = 0;
    let inDrawdown = false;

    for (let i = 1; i < cumulativeReturns.length; i++) {
      const value = cumulativeReturns[i];

      if (value > peak) {
        // New peak - end current drawdown if any
        if (inDrawdown) {
          const lastDrawdown = drawdowns[drawdowns.length - 1];
          lastDrawdown.recoveryIndex = i;
          inDrawdown = false;
        }

        peak = value;
        peakIndex = i;
      } else if (value < peak) {
        // In drawdown
        if (!inDrawdown) {
          // Start new drawdown period
          drawdowns.push({
            startIndex: peakIndex,
            endIndex: i,
            drawdown: peak - value,
            duration: i - peakIndex
          });
          inDrawdown = true;
        } else {
          // Update existing drawdown
          const lastDrawdown = drawdowns[drawdowns.length - 1];
          lastDrawdown.endIndex = i;
          lastDrawdown.drawdown = Math.max(lastDrawdown.drawdown, peak - value);
          lastDrawdown.duration = i - peakIndex;
        }
      }
    }

    return drawdowns;
  }

  /**
   * Calculate Calmar ratio (annualized return / max drawdown)
   */
  calculateCalmarRatio(annualizedReturn: number, maxDrawdownPercentage: number): number {
    if (maxDrawdownPercentage === 0) return 0;

    // Convert percentage to decimal
    const maxDrawdownDecimal = maxDrawdownPercentage / 100;

    return annualizedReturn / maxDrawdownDecimal;
  }

  /**
   * Calculate average drawdown
   */
  calculateAverageDrawdown(cumulativeReturns: number[]): number {
    const drawdowns = this.calculateAllDrawdowns(cumulativeReturns);

    if (drawdowns.length === 0) return 0;

    const totalDrawdown = drawdowns.reduce((sum, dd) => sum + dd.drawdown, 0);
    return totalDrawdown / drawdowns.length;
  }

  /**
   * Calculate drawdown duration statistics
   */
  calculateDrawdownDurations(cumulativeReturns: number[]): {
    average: number;
    max: number;
    total: number;
  } {
    const drawdowns = this.calculateAllDrawdowns(cumulativeReturns);

    if (drawdowns.length === 0) {
      return { average: 0, max: 0, total: 0 };
    }

    const durations = drawdowns.map((dd) => dd.duration);
    const totalDuration = durations.reduce((sum, dur) => sum + dur, 0);
    const maxDuration = Math.max(...durations);
    const avgDuration = totalDuration / durations.length;

    return {
      average: avgDuration,
      max: maxDuration,
      total: totalDuration
    };
  }

  /**
   * Convert period returns to cumulative returns (equity curve)
   */
  private convertToCumulativeReturns(returns: number[]): number[] {
    const cumulative: number[] = [1.0]; // Start with $1

    for (const ret of returns) {
      const lastValue = cumulative[cumulative.length - 1];
      cumulative.push(lastValue * (1 + ret));
    }

    return cumulative;
  }

  /**
   * Calculate underwater plot (current drawdown over time)
   */
  calculateUnderwaterPlot(cumulativeReturns: number[]): number[] {
    const underwater: number[] = [];
    let peak = cumulativeReturns[0];

    for (const value of cumulativeReturns) {
      if (value > peak) {
        peak = value;
      }

      const drawdown = peak !== 0 ? ((peak - value) / peak) * 100 : 0;
      underwater.push(-drawdown); // Negative values for underwater plot
    }

    return underwater;
  }

  /**
   * Interpret drawdown severity
   */
  interpretDrawdown(drawdownPercentage: number): {
    severity: 'low' | 'moderate' | 'high' | 'extreme';
    description: string;
  } {
    if (drawdownPercentage < 10) {
      return { severity: 'low', description: 'Low drawdown - well-controlled risk' };
    } else if (drawdownPercentage < 20) {
      return { severity: 'moderate', description: 'Moderate drawdown - acceptable for most strategies' };
    } else if (drawdownPercentage < 40) {
      return { severity: 'high', description: 'High drawdown - careful monitoring required' };
    } else {
      return { severity: 'extreme', description: 'Extreme drawdown - significant risk' };
    }
  }
}
