import { type PaperTradingSession, PaperTradingStatus } from './entities';

import { getInsufficientSignalThreshold } from '../../tasks/dto/pipeline-orchestration.dto';

export type StopReason =
  | 'max_drawdown'
  | 'target_reached'
  | 'min_trades_reached'
  | 'duration_reached'
  | 'insufficient_signals';

/**
 * Parse duration string (e.g. "30d", "24h") to milliseconds.
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhdwMy])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000
  };

  return value * (multipliers[unit] ?? 0);
}

/**
 * Evaluate whether any stop condition is met for the session.
 *
 * Precedence (order matters):
 *   1. Safety overrides — maxDrawdown / targetReturn protect capital
 *   2. Min-trades gate — ensures statistical significance before graduation
 *   3. Insufficient-signals gate — early termination when the strategy is
 *      not producing enough signals to ever satisfy the trade-count gate
 *   4. Duration cap — hard time limit prevents runaway sessions
 *
 * Min-trades runs before insufficient-signals because satisfying the target
 * trade count is the primary completion path — once hit, starvation no
 * longer applies. In practice, min-trades thresholds (30-50) are much
 * higher than starvation floors (2-3), so the two rarely race.
 *
 * Returns the first triggered reason, or null if none apply.
 * Pure function — does not mutate the session or perform I/O. The caller
 * is responsible for calling `markCompleted` and updating `session.status`.
 */
export function evaluateStopReason(
  session: PaperTradingSession,
  portfolioValue: number,
  currentDrawdown: number
): StopReason | null {
  if (session.status !== PaperTradingStatus.ACTIVE) return null;

  // 1. Safety overrides
  if (session.stopConditions) {
    const { maxDrawdown, targetReturn } = session.stopConditions;

    if (maxDrawdown !== undefined && currentDrawdown > maxDrawdown) {
      return 'max_drawdown';
    }

    const currentReturn = (portfolioValue - session.initialCapital) / session.initialCapital;
    if (targetReturn !== undefined && currentReturn >= targetReturn) {
      return 'target_reached';
    }
  }

  // 2. Min-trades gate
  if (session.minTrades != null && session.totalTrades >= session.minTrades) {
    return 'min_trades_reached';
  }

  // 3. Insufficient-signals gate
  if (session.startedAt) {
    const { checkAfterDays, minTradesByThen } = getInsufficientSignalThreshold(session.riskLevel);
    const daysRun = (Date.now() - session.startedAt.getTime()) / 86_400_000;
    if (daysRun >= checkAfterDays && (session.totalTrades ?? 0) < minTradesByThen) {
      return 'insufficient_signals';
    }
  }

  // 4. Duration cap
  if (session.duration && session.startedAt) {
    const startTime = session.startedAt.getTime();
    const now = Date.now();
    const durationMs = parseDuration(session.duration);

    if (durationMs > 0 && now - startTime >= durationMs) {
      return 'duration_reached';
    }
  }

  return null;
}

/**
 * Apply a successful tick result to the session in-place.
 *
 * Resets error counters, advances tick count, updates portfolio/peak/drawdown
 * metrics, and recomputes total return. Returns the current drawdown so the
 * caller can pass it to `evaluateStopReason`.
 *
 * Pure mutator — does NOT persist. The caller is responsible for
 * `sessionRepository.save(session)` after invoking this function.
 */
export function applySuccessfulTickResult(
  session: PaperTradingSession,
  result: { portfolioValue: number; ordersExecuted: number }
): number {
  session.consecutiveErrors = 0;
  session.retryAttempts = 0;
  session.tickCount++;
  session.lastTickAt = new Date();
  session.currentPortfolioValue = result.portfolioValue;

  if (result.ordersExecuted > 0) {
    session.totalTrades = (session.totalTrades ?? 0) + result.ordersExecuted;
  }

  if (result.portfolioValue > (session.peakPortfolioValue ?? session.initialCapital)) {
    session.peakPortfolioValue = result.portfolioValue;
  }

  const currentDrawdown =
    (session.peakPortfolioValue ?? 0) > 0
      ? ((session.peakPortfolioValue ?? 0) - result.portfolioValue) / (session.peakPortfolioValue ?? 0)
      : 0;

  if (currentDrawdown > (session.maxDrawdown ?? 0)) {
    session.maxDrawdown = currentDrawdown;
  }

  session.totalReturn = (result.portfolioValue - session.initialCapital) / session.initialCapital;

  return currentDrawdown;
}
