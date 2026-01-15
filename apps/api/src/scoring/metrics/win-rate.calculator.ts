import { Injectable } from '@nestjs/common';

/**
 * Win Rate Calculator
 * Calculates win rate as decimal (0.0 to 1.0)
 */
@Injectable()
export class WinRateCalculator {
  /**
   * Calculate win rate from trade results
   * @param trades Array of trade P&L values
   * @returns Win rate as decimal (0.0 to 1.0), e.g., 0.65 = 65% win rate
   */
  calculate(trades: number[]): number {
    if (trades.length === 0) return 0;

    const winningTrades = trades.filter((trade) => trade > 0).length;
    return winningTrades / trades.length;
  }

  /**
   * Calculate win rate with separate wins/losses counts
   * @returns Win rate as decimal (0.0 to 1.0)
   */
  calculateFromCounts(wins: number, losses: number): number {
    const total = wins + losses;
    if (total === 0) return 0;

    return wins / total;
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
   * @param winRate Win rate as decimal (0.0 to 1.0)
   */
  interpret(winRate: number): {
    grade: 'excellent' | 'good' | 'acceptable' | 'poor';
    description: string;
  } {
    if (winRate >= 0.6) {
      return { grade: 'excellent', description: 'Excellent win rate - highly consistent' };
    } else if (winRate >= 0.5) {
      return { grade: 'good', description: 'Good win rate - above breakeven' };
    } else if (winRate >= 0.45) {
      return { grade: 'acceptable', description: 'Acceptable win rate - needs strong win/loss ratio' };
    } else {
      return { grade: 'poor', description: 'Low win rate - requires exceptional win/loss ratio' };
    }
  }
}
