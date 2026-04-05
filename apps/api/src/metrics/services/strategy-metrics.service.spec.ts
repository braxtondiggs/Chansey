import { StrategyMetricsService } from './strategy-metrics.service';

const createCounterMock = () => ({ inc: jest.fn() }) as any;
const createGaugeMock = () => ({ set: jest.fn() }) as any;

const buildService = () => {
  const mocks = {
    strategyDeploymentsActive: createGaugeMock(),
    strategySignalsTotal: createCounterMock(),
    strategyHeartbeatAge: createGaugeMock(),
    strategyHeartbeatTotal: createCounterMock(),
    strategyHeartbeatFailures: createGaugeMock(),
    strategyHealthScore: createGaugeMock(),
    portfolioTotalValue: createGaugeMock(),
    portfolioAssetsCount: createGaugeMock()
  };

  const service = new StrategyMetricsService(
    mocks.strategyDeploymentsActive,
    mocks.strategySignalsTotal,
    mocks.strategyHeartbeatAge,
    mocks.strategyHeartbeatTotal,
    mocks.strategyHeartbeatFailures,
    mocks.strategyHealthScore,
    mocks.portfolioTotalValue,
    mocks.portfolioAssetsCount
  );

  return { service, mocks };
};

describe('StrategyMetricsService', () => {
  describe('setStrategyHealthScore', () => {
    it('clamps score above 100 down to 100', () => {
      const { service, mocks } = buildService();
      service.setStrategyHealthScore('trend', 'shadow', 150);
      expect(mocks.strategyHealthScore.set).toHaveBeenCalledWith({ strategy: 'trend', shadow_status: 'shadow' }, 100);
    });

    it('clamps score below 0 up to 0', () => {
      const { service, mocks } = buildService();
      service.setStrategyHealthScore('trend', 'shadow', -10);
      expect(mocks.strategyHealthScore.set).toHaveBeenCalledWith({ strategy: 'trend', shadow_status: 'shadow' }, 0);
    });

    it('passes through score within 0-100 range', () => {
      const { service, mocks } = buildService();
      service.setStrategyHealthScore('trend', 'shadow', 72);
      expect(mocks.strategyHealthScore.set).toHaveBeenCalledWith({ strategy: 'trend', shadow_status: 'shadow' }, 72);
    });
  });

  describe('calculateAndSetHealthScore', () => {
    it.each<{ scenario: string; age: number; failures: number; maxAge: number; expected: number }>([
      {
        scenario: 'deducts for stale heartbeat and failures',
        age: 900,
        failures: 3,
        maxAge: 300,
        // ageRatio = min(900/900, 1) = 1 → -40; failures: 3*15=45 → score = 100-40-45 = 15
        expected: 15
      },
      {
        scenario: 'only deducts for failures when heartbeat is fresh',
        age: 100,
        failures: 2,
        maxAge: 300,
        // age ≤ 300 → no penalty; failures: 2*15=30 → score = 100-30 = 70
        expected: 70
      },
      {
        scenario: 'caps failure penalty at 60 points',
        age: 100,
        failures: 5,
        maxAge: 300,
        // age ≤ 300 → no penalty; failures: min(75, 60)=60 → score = 100-60 = 40
        expected: 40
      },
      {
        scenario: 'clamps to 0 when penalties exceed 100',
        age: 900,
        failures: 5,
        maxAge: 300,
        // age: -40; failures: -60 → score = 100-40-60 = 0 (clamped)
        expected: 0
      },
      {
        scenario: 'returns 100 with no issues',
        age: 0,
        failures: 0,
        maxAge: 300,
        expected: 100
      }
    ])('$scenario', ({ age, failures, maxAge, expected }) => {
      const { service, mocks } = buildService();
      service.calculateAndSetHealthScore('scalper', 'shadow', age, failures, maxAge);
      expect(mocks.strategyHealthScore.set).toHaveBeenCalledWith(
        { strategy: 'scalper', shadow_status: 'shadow' },
        expected
      );
    });

    it('uses default maxHeartbeatAge of 300', () => {
      const { service, mocks } = buildService();
      // 600 > 300 (default) → ageRatio = min(600/900, 1) = 0.667 → -26.67; failures: 0 → score ≈ 73
      service.calculateAndSetHealthScore('scalper', 'shadow', 600, 0);
      const actualScore = mocks.strategyHealthScore.set.mock.calls[0][1];
      expect(actualScore).toBeCloseTo(73.33, 0);
    });
  });
});
