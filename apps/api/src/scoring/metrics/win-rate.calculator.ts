import { Injectable } from '@nestjs/common';

/**
 * Win Rate Calculator
 * Calculates percentage of winning trades
 */
@Injectable()
export class WinRateCalculator {
  /**
   * Calculate win rate from trade results
   * @param trades Array of trade P&L values
   */
  calculate(trades: number[]): number {
    if (trades.length === 0) return 0;

    const winningTrades = trades.filter((trade) => trade > 0).length;
    return (winningTrades / trades.length) * 100;
  }

  /**
   * Calculate win rate with separate wins/losses counts
   */
  calculateFromCounts(wins: number, losses: number): number {
    const total = wins + losses;
    if (total === 0) return 0;

    return (wins / total) * 100;
  }

  /**
   * Calculate average win and average loss
   */
  calculateWinLossStats(trades: number[]): {
    winRate: number;
    avgWin: number;
    avgLoss: number;
    winLossRatio: number;
  } {
    if (trades.length === 0) {
      return { winRate: 0, avgWin: 0, avgLoss: 0, winLossRatio: 0 };
    }

    const wins = trades.filter((t) => t > 0);
    const losses = trades.filter((t) => t < 0);

    const avgWin = wins.length > 0 ? wins.reduce((sum, w) => sum + w, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, l) => sum + l, 0) / losses.length) : 0;

    const winLossRatio = avgLoss !== 0 ? avgWin / avgLoss : 0;

    return {
      winRate: this.calculate(trades),
      avgWin,
      avgLoss,
      winLossRatio
    };
  }

  /**
   * Interpret win rate quality
   */
  interpret(winRate: number): {
    grade: 'excellent' | 'good' | 'acceptable' | 'poor';
    description: string;
  } {
    if (winRate >= 60) {
      return { grade: 'excellent', description: 'Excellent win rate - highly consistent' };
    } else if (winRate >= 50) {
      return { grade: 'good', description: 'Good win rate - above breakeven' };
    } else if (winRate >= 45) {
      return { grade: 'acceptable', description: 'Acceptable win rate - needs strong win/loss ratio' };
    } else {
      return { grade: 'poor', description: 'Low win rate - requires exceptional win/loss ratio' };
    }
  }
}
