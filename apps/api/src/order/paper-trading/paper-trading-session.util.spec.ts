import { PaperTradingStatus, type PaperTradingSession } from './entities';
import { evaluateStopReason } from './paper-trading-session.util';

const ONE_DAY_MS = 86_400_000;

function makeSession(overrides: Partial<PaperTradingSession> = {}): PaperTradingSession {
  return {
    id: 'session-123',
    status: PaperTradingStatus.ACTIVE,
    initialCapital: 10_000,
    totalTrades: 0,
    startedAt: new Date(Date.now() - ONE_DAY_MS), // 1 day ago by default
    ...overrides
  } as PaperTradingSession;
}

describe('evaluateStopReason', () => {
  describe('insufficient_signals gate', () => {
    it('returns insufficient_signals at day 5 with 0 trades for risk=3 (default)', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 5 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBe('insufficient_signals');
    });

    it('does NOT return insufficient_signals at day 3 for risk=3 (too early)', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 3 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBeNull();
    });

    it('does NOT return insufficient_signals at day 6 with 2 trades (signal present)', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 2,
        startedAt: new Date(Date.now() - 6 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBeNull();
    });

    it('uses 7-day patience window for risk=1 (conservative)', () => {
      const atDay6 = makeSession({
        riskLevel: 1,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 6 * ONE_DAY_MS)
      });
      const atDay7 = makeSession({
        riskLevel: 1,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 7 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(atDay6, 10_000, 0)).toBeNull();
      expect(evaluateStopReason(atDay7, 10_000, 0)).toBe('insufficient_signals');
    });

    it('uses 4-day patience window for risk=5 (aggressive)', () => {
      const atDay3 = makeSession({
        riskLevel: 5,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 3 * ONE_DAY_MS)
      });
      const atDay4 = makeSession({
        riskLevel: 5,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 4 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(atDay3, 10_000, 0)).toBeNull();
      expect(evaluateStopReason(atDay4, 10_000, 0)).toBe('insufficient_signals');
    });

    it('falls back to default (risk=3) thresholds when riskLevel is missing', () => {
      const session = makeSession({
        riskLevel: undefined,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 5 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBe('insufficient_signals');
    });
  });

  describe('precedence', () => {
    it('fires max_drawdown before insufficient_signals even when starvation condition is also met', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 10 * ONE_DAY_MS),
        stopConditions: { maxDrawdown: 0.2 }
      });

      expect(evaluateStopReason(session, 10_000, 0.5)).toBe('max_drawdown');
    });

    it('fires target_reached before insufficient_signals even when starvation condition is also met', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 10 * ONE_DAY_MS),
        stopConditions: { targetReturn: 0.1 }
      });

      expect(evaluateStopReason(session, 12_000, 0)).toBe('target_reached');
    });

    it('fires min_trades_reached before insufficient_signals', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 30,
        minTrades: 30,
        startedAt: new Date(Date.now() - 10 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBe('min_trades_reached');
    });

    it('fires insufficient_signals before duration_reached', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 0,
        duration: '1d',
        startedAt: new Date(Date.now() - 10 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBe('insufficient_signals');
    });
  });

  describe('existing behavior unchanged', () => {
    it('returns null when session is not ACTIVE', () => {
      const session = makeSession({
        status: PaperTradingStatus.PAUSED,
        riskLevel: 3,
        totalTrades: 0,
        startedAt: new Date(Date.now() - 10 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBeNull();
    });

    it('still returns duration_reached when min trades satisfied but time cap hit', () => {
      const session = makeSession({
        riskLevel: 3,
        totalTrades: 5,
        duration: '1d',
        startedAt: new Date(Date.now() - 2 * ONE_DAY_MS)
      });

      expect(evaluateStopReason(session, 10_000, 0)).toBe('duration_reached');
    });
  });
});
