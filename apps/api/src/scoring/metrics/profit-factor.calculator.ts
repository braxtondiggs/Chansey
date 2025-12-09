import { Injectable } from '@nestjs/common';

/**
 * Profit Factor Calculator
 * Measures gross profit divided by gross loss
 * Profit Factor = Total Winning Trades / Total Losing Trades
 */
@Injectable()
export class ProfitFactorCalculator {
  /**
   * Calculate profit factor from trade results
   * @param trades Array of trade P&L values
   */
  calculate(trades: number[]): number {
    if (trades.length === 0) return 0;

    const grossProfit = trades.filter((t) => t > 0).reduce((sum, t) => sum + t, 0);
    const grossLoss = Math.abs(trades.filter((t) => t < 0).reduce((sum, t) => sum + t, 0));

    if (grossLoss === 0) {
      return grossProfit > 0 ? Infinity : 0;
    }

    return grossProfit / grossLoss;
  }

  /**
   * Calculate profit factor from gross profit and loss
   */
  calculateFromGross(grossProfit: number, grossLoss: number): number {
    if (grossLoss === 0) {
      return grossProfit > 0 ? Infinity : 0;
    }

    return grossProfit / grossLoss;
  }

  /**
   * Calculate expectancy (expected value per trade)
   * Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
   */
  calculateExpectancy(trades: number[]): number {
    if (trades.length === 0) return 0;

    const wins = trades.filter((t) => t > 0);
    const losses = trades.filter((t) => t < 0);

    const winRate = wins.length / trades.length;
    const lossRate = losses.length / trades.length;

    const avgWin = wins.length > 0 ? wins.reduce((sum, w) => sum + w, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, l) => sum + l, 0) / losses.length) : 0;

    return winRate * avgWin - lossRate * avgLoss;
  }

  /**
   * Interpret profit factor quality
   */
  interpret(profitFactor: number): {
    grade: 'excellent' | 'good' | 'acceptable' | 'poor';
    description: string;
  } {
    if (profitFactor === Infinity) {
      return { grade: 'excellent', description: 'Perfect profit factor - no losing trades' };
    } else if (profitFactor >= 2.0) {
      return { grade: 'excellent', description: 'Excellent profit factor - strong edge' };
    } else if (profitFactor >= 1.5) {
      return { grade: 'good', description: 'Good profit factor - positive edge' };
    } else if (profitFactor >= 1.2) {
      return { grade: 'acceptable', description: 'Acceptable profit factor - modest edge' };
    } else {
      return { grade: 'poor', description: 'Poor profit factor - weak or negative edge' };
    }
  }
}
