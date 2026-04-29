import { Test, type TestingModule } from '@nestjs/testing';

import { CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { CompositeRegimeService } from './composite-regime.service';
import { RegimeFitnessService, type PerCoinRegime, type RegimeSnapshot } from './regime-fitness.service';

import { TradingStyle } from '../algorithm/interfaces/trading-style.enum';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';

describe('RegimeFitnessService', () => {
  let service: RegimeFitnessService;
  let mockCompositeRegimeService: jest.Mocked<
    Pick<
      CompositeRegimeService,
      | 'getCompositeRegime'
      | 'getCompositeRegimeForCoin'
      | 'getVolatilityRegimeForCoin'
      | 'getTrendAboveSma'
      | 'getCacheStatus'
      | 'isOverrideActive'
    >
  >;
  let mockAlgorithmRegistry: jest.Mocked<Pick<AlgorithmRegistry, 'getStrategy'>>;

  // Build a stub for AlgorithmRegistry.getStrategy that returns a fake strategy
  // with the requested style for known IDs and undefined for unknowns.
  const stubRegistry = (styleMap: Record<string, TradingStyle>) => {
    mockAlgorithmRegistry.getStrategy.mockImplementation((id: string) => {
      const style = styleMap[id];
      return style ? ({ id, name: id, tradingStyle: style } as any) : undefined;
    });
  };

  beforeEach(async () => {
    mockCompositeRegimeService = {
      getCompositeRegime: jest.fn().mockReturnValue(CompositeRegimeType.BULL),
      getCompositeRegimeForCoin: jest.fn().mockResolvedValue(CompositeRegimeType.BULL),
      getVolatilityRegimeForCoin: jest.fn().mockReturnValue(MarketRegimeType.NORMAL),
      getTrendAboveSma: jest.fn().mockReturnValue(true),
      getCacheStatus: jest.fn().mockReturnValue({ stale: false, ageMs: 30_000 }),
      isOverrideActive: jest.fn().mockReturnValue(false)
    };

    mockAlgorithmRegistry = {
      getStrategy: jest.fn().mockReturnValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegimeFitnessService,
        { provide: CompositeRegimeService, useValue: mockCompositeRegimeService },
        { provide: AlgorithmRegistry, useValue: mockAlgorithmRegistry }
      ]
    }).compile();

    service = module.get<RegimeFitnessService>(RegimeFitnessService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // snapshotRegime() — populates per-coin map and majority-vote universe regime
  // ---------------------------------------------------------------------------
  describe('snapshotRegime', () => {
    it('populates perCoin map and computes universe via majority vote', async () => {
      mockCompositeRegimeService.getCompositeRegimeForCoin.mockImplementation(async (sym: string) => {
        const upper = sym.toUpperCase();
        if (upper === 'BTC') return CompositeRegimeType.BULL;
        if (upper === 'ETH') return CompositeRegimeType.BULL;
        if (upper === 'PENGU') return CompositeRegimeType.NEUTRAL;
        return CompositeRegimeType.BULL;
      });
      mockCompositeRegimeService.getVolatilityRegimeForCoin.mockImplementation((sym: string) =>
        sym.toUpperCase() === 'PENGU' ? MarketRegimeType.LOW_VOLATILITY : MarketRegimeType.NORMAL
      );

      const snapshot = await service.snapshotRegime(['BTC', 'ETH', 'PENGU']);

      expect(snapshot.perCoin.size).toBe(3);
      expect(snapshot.perCoin.get('BTC')).toEqual({
        composite: CompositeRegimeType.BULL,
        volatility: MarketRegimeType.NORMAL
      });
      expect(snapshot.perCoin.get('PENGU')).toEqual({
        composite: CompositeRegimeType.NEUTRAL,
        volatility: MarketRegimeType.LOW_VOLATILITY
      });
      expect(snapshot.universeRegime).toBe(CompositeRegimeType.BULL);
      expect(snapshot.btcTrendAboveSma).toBe(true);
      expect(snapshot.status.stale).toBe(false);
    });

    it('falls back to BTC-global on tied majority vote', async () => {
      mockCompositeRegimeService.getCompositeRegimeForCoin.mockImplementation(async (sym: string) => {
        const upper = sym.toUpperCase();
        if (upper === 'BTC') return CompositeRegimeType.BULL;
        if (upper === 'PENGU') return CompositeRegimeType.NEUTRAL;
        return CompositeRegimeType.BULL;
      });
      mockCompositeRegimeService.getCompositeRegime.mockReturnValue(CompositeRegimeType.BEAR);

      // Two coins, one BULL one NEUTRAL — tie → fall back to BTC-global (BEAR)
      const snapshot = await service.snapshotRegime(['BTC', 'PENGU']);

      expect(snapshot.universeRegime).toBe(CompositeRegimeType.BEAR);
    });

    it('returns BTC-global universe for empty symbol set', async () => {
      mockCompositeRegimeService.getCompositeRegime.mockReturnValue(CompositeRegimeType.NEUTRAL);

      const snapshot = await service.snapshotRegime([]);

      expect(snapshot.perCoin.size).toBe(0);
      expect(snapshot.universeRegime).toBe(CompositeRegimeType.NEUTRAL);
    });

    it('uppercases symbols when storing in the perCoin map', async () => {
      const snapshot = await service.snapshotRegime(['btc', 'pengu']);

      expect(snapshot.perCoin.has('BTC')).toBe(true);
      expect(snapshot.perCoin.has('PENGU')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate() — every decision rule path
  // ---------------------------------------------------------------------------
  describe('evaluate', () => {
    beforeEach(() => {
      // Real strategies' tradingStyle is read from the registry. Stub the
      // strategies used in evaluate() tests; unknown IDs return undefined.
      stubRegistry({
        'rsi-momentum-001': TradingStyle.MEAN_REVERTING,
        'mean-reversion-001': TradingStyle.MEAN_REVERTING,
        'ema-crossover-001': TradingStyle.TREND_FOLLOWING,
        'bb-squeeze-001': TradingStyle.VOLATILITY_EXPANSION,
        'confluence-001': TradingStyle.MULTI_SIGNAL
      });
    });

    const makeSnapshot = (overrides: Partial<RegimeSnapshot> = {}): RegimeSnapshot => ({
      universeRegime: CompositeRegimeType.BULL,
      perCoin: new Map<string, PerCoinRegime>([
        ['BTC', { composite: CompositeRegimeType.BULL, volatility: MarketRegimeType.NORMAL }]
      ]),
      btcTrendAboveSma: true,
      status: { stale: false, ageMs: 1000 },
      ...overrides
    });

    const lowVolNeutral = makeSnapshot({
      universeRegime: CompositeRegimeType.NEUTRAL,
      perCoin: new Map([
        ['BTC', { composite: CompositeRegimeType.NEUTRAL, volatility: MarketRegimeType.LOW_VOLATILITY }]
      ])
    });

    it('returns ALLOW_OVERRIDE when override is active', () => {
      mockCompositeRegimeService.isOverrideActive.mockReturnValue(true);

      const result = service.evaluate('rsi-momentum-001', makeSnapshot());

      expect(result.decision).toBe('ALLOW_OVERRIDE');
    });

    it('returns ALLOW_STALE when cache is stale', () => {
      const result = service.evaluate(
        'rsi-momentum-001',
        makeSnapshot({ status: { stale: true, ageMs: 5 * 60 * 60 * 1000 } })
      );

      expect(result.decision).toBe('ALLOW_STALE');
      expect(result.reason).toContain('300min');
    });

    it('returns ALLOW_UNKNOWN_STYLE when the strategy is not in the registry', () => {
      const result = service.evaluate('unknown-strategy-001', makeSnapshot());

      expect(result.decision).toBe('ALLOW_UNKNOWN_STYLE');
      expect(result.reason).toContain('unknown-strategy-001');
      expect(result.reason).toContain('not registered');
    });

    describe('decision precedence', () => {
      it('ALLOW_OVERRIDE wins when override + stale + unknown-style + BLOCK conditions all true', () => {
        mockCompositeRegimeService.isOverrideActive.mockReturnValue(true);

        const result = service.evaluate(
          'unknown-strategy-001',
          makeSnapshot({
            universeRegime: CompositeRegimeType.NEUTRAL,
            perCoin: new Map([
              ['BTC', { composite: CompositeRegimeType.NEUTRAL, volatility: MarketRegimeType.LOW_VOLATILITY }]
            ]),
            status: { stale: true, ageMs: 999_999 }
          })
        );

        expect(result.decision).toBe('ALLOW_OVERRIDE');
      });

      it('ALLOW_STALE wins over unknown-style and BLOCK conditions when override is off', () => {
        const result = service.evaluate(
          'unknown-strategy-001',
          makeSnapshot({
            universeRegime: CompositeRegimeType.NEUTRAL,
            perCoin: new Map([
              ['BTC', { composite: CompositeRegimeType.NEUTRAL, volatility: MarketRegimeType.LOW_VOLATILITY }]
            ]),
            status: { stale: true, ageMs: 60_000 }
          })
        );

        expect(result.decision).toBe('ALLOW_STALE');
      });

      it('ALLOW_UNKNOWN_STYLE wins over BLOCK conditions when override + stale are off', () => {
        // Unknown strategy never reaches the style-based BLOCK rules, even with low-vol + NEUTRAL.
        const result = service.evaluate('unknown-strategy-001', lowVolNeutral);

        expect(result.decision).toBe('ALLOW_UNKNOWN_STYLE');
      });
    });

    describe('style + regime compatibility', () => {
      it('ALLOWs TREND_FOLLOWING in BULL universe', () => {
        const result = service.evaluate('ema-crossover-001', makeSnapshot());

        expect(result.decision).toBe('ALLOW');
        expect(result.style).toBe('TREND_FOLLOWING');
      });

      it('ALLOWs TREND_FOLLOWING in BEAR universe even with low-vol coin (BLOCK only triggers in NEUTRAL)', () => {
        const result = service.evaluate(
          'ema-crossover-001',
          makeSnapshot({
            universeRegime: CompositeRegimeType.BEAR,
            perCoin: new Map([
              ['BTC', { composite: CompositeRegimeType.BEAR, volatility: MarketRegimeType.LOW_VOLATILITY }]
            ])
          })
        );

        expect(result.decision).toBe('ALLOW');
        expect(result.style).toBe('TREND_FOLLOWING');
      });

      it('BLOCKs TREND_FOLLOWING when universe is NEUTRAL with low-vol coin', () => {
        const result = service.evaluate('ema-crossover-001', lowVolNeutral);

        expect(result.decision).toBe('BLOCK');
        expect(result.style).toBe('TREND_FOLLOWING');
      });

      it('does NOT block TREND_FOLLOWING in NEUTRAL universe without low-vol coins', () => {
        const result = service.evaluate(
          'ema-crossover-001',
          makeSnapshot({
            universeRegime: CompositeRegimeType.NEUTRAL,
            perCoin: new Map([
              ['BTC', { composite: CompositeRegimeType.NEUTRAL, volatility: MarketRegimeType.HIGH_VOLATILITY }]
            ])
          })
        );

        expect(result.decision).toBe('ALLOW');
      });

      it('BLOCKs VOLATILITY_EXPANSION when any coin has LOW_VOLATILITY', () => {
        const result = service.evaluate(
          'bb-squeeze-001',
          makeSnapshot({
            perCoin: new Map([
              ['BTC', { composite: CompositeRegimeType.BULL, volatility: MarketRegimeType.NORMAL }],
              ['JUP', { composite: CompositeRegimeType.BULL, volatility: MarketRegimeType.LOW_VOLATILITY }]
            ])
          })
        );

        expect(result.decision).toBe('BLOCK');
        expect(result.style).toBe('VOLATILITY_EXPANSION');
      });

      it('ALLOWs VOLATILITY_EXPANSION when no coin is low-vol', () => {
        const result = service.evaluate(
          'bb-squeeze-001',
          makeSnapshot({
            perCoin: new Map([
              ['BTC', { composite: CompositeRegimeType.BULL, volatility: MarketRegimeType.HIGH_VOLATILITY }]
            ])
          })
        );

        expect(result.decision).toBe('ALLOW');
      });

      it.each([
        ['rsi-momentum-001', 'MEAN_REVERTING'],
        ['confluence-001', 'MULTI_SIGNAL']
      ])('ALLOWs %s (%s) regardless of regime', (strategyId, expectedStyle) => {
        const result = service.evaluate(strategyId, lowVolNeutral);

        expect(result.decision).toBe('ALLOW');
        expect(result.style).toBe(expectedStyle);
      });
    });

    it('returns ALLOW_ERROR if evaluation throws', () => {
      mockCompositeRegimeService.isOverrideActive.mockImplementation(() => {
        throw new Error('Unexpected failure');
      });

      const result = service.evaluate('rsi-momentum-001', makeSnapshot());

      expect(result.decision).toBe('ALLOW_ERROR');
    });
  });
});
