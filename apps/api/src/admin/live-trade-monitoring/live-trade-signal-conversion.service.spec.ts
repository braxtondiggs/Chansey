import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { LiveTradeSignalConversionService } from './live-trade-signal-conversion.service';

import { PaperTradingSignal } from '../../order/paper-trading/entities/paper-trading-signal.entity';
import { LiveTradingSignal } from '../../strategy/entities/live-trading-signal.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

type QbResults = {
  totals?: { totalSignals: string; placedSignals: string };
  reasons?: Array<{ reasonCode: string | null; count: string }>;
  perAlgorithm?: Array<{ algorithmId: string; totalSignals: string; placedSignals: string }>;
};

const emptyResults = (totalSignals = '0', placedSignals = '0'): QbResults[] => [
  { totals: { totalSignals, placedSignals } },
  { reasons: [] },
  { perAlgorithm: [] }
];

const createScriptedQueryBuilder = (sequence: QbResults[]) => {
  let callIndex = 0;
  const qb: Partial<SelectQueryBuilder<ObjectLiteral>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockImplementation(async () => sequence[callIndex++]?.totals ?? null),
    getRawMany: jest.fn().mockImplementation(async () => {
      const next = sequence[callIndex++];
      return next?.reasons ?? next?.perAlgorithm ?? [];
    })
  };
  return qb as SelectQueryBuilder<ObjectLiteral>;
};

describe('LiveTradeSignalConversionService', () => {
  let service: LiveTradeSignalConversionService;
  let liveRepo: MockRepo<LiveTradingSignal>;
  let paperRepo: MockRepo<PaperTradingSignal>;
  let liveQb: SelectQueryBuilder<ObjectLiteral>;
  let paperQb: SelectQueryBuilder<ObjectLiteral>;

  const buildModule = async (liveSequence: QbResults[], paperSequence: QbResults[]): Promise<TestingModule> => {
    liveQb = createScriptedQueryBuilder(liveSequence);
    paperQb = createScriptedQueryBuilder(paperSequence);

    liveRepo = { createQueryBuilder: jest.fn().mockReturnValue(liveQb) };
    paperRepo = { createQueryBuilder: jest.fn().mockReturnValue(paperQb) };

    return Test.createTestingModule({
      providers: [
        LiveTradeSignalConversionService,
        { provide: getRepositoryToken(LiveTradingSignal), useValue: liveRepo },
        { provide: getRepositoryToken(PaperTradingSignal), useValue: paperRepo }
      ]
    }).compile();
  };

  afterEach(() => jest.clearAllMocks());

  describe('getConversionMetrics', () => {
    it('aggregates totals and computes conversion percentage from live + paper signals', async () => {
      const paperSequence: QbResults[] = [
        { totals: { totalSignals: '190502', placedSignals: '568' } },
        {
          reasons: [
            { reasonCode: 'SIGNAL_THROTTLED', count: '180133' },
            { reasonCode: null, count: '9784' },
            { reasonCode: 'SYMBOL_RESOLUTION_FAILED', count: '10' },
            { reasonCode: 'TRADE_COOLDOWN', count: '6' }
          ]
        },
        {
          perAlgorithm: [{ algorithmId: 'algo-1', totalSignals: '190502', placedSignals: '568' }]
        }
      ];

      const module = await buildModule(emptyResults(), paperSequence);
      service = module.get(LiveTradeSignalConversionService);

      const metrics = await service.getConversionMetrics({}, {});

      expect(metrics.totalSignals).toBe(190502);
      expect(metrics.placedSignals).toBe(568);
      expect(metrics.rejectedSignals).toBe(189934);
      expect(metrics.conversionPct).toBeCloseTo((568 / 190502) * 100, 4);
      expect(metrics.topRejectionReasons[0]).toMatchObject({
        reasonCode: 'SIGNAL_THROTTLED',
        count: 180133
      });
      expect(metrics.topRejectionReasons[0].pct).toBeCloseTo((180133 / 190502) * 100, 4);
    });

    it('orders rejection reasons by count descending and limits to top 5', async () => {
      const liveSequence: QbResults[] = [
        { totals: { totalSignals: '100', placedSignals: '0' } },
        {
          reasons: [
            { reasonCode: 'SIGNAL_THROTTLED', count: '60' },
            { reasonCode: 'TRADE_COOLDOWN', count: '15' }
          ]
        },
        { perAlgorithm: [] }
      ];
      const paperSequence: QbResults[] = [
        { totals: { totalSignals: '100', placedSignals: '0' } },
        {
          reasons: [
            { reasonCode: 'SIGNAL_THROTTLED', count: '20' },
            { reasonCode: 'INSUFFICIENT_FUNDS', count: '40' },
            { reasonCode: 'REGIME_GATE', count: '30' },
            { reasonCode: 'DAILY_LOSS_LIMIT', count: '8' },
            { reasonCode: 'CONCENTRATION_LIMIT', count: '20' },
            { reasonCode: 'DRAWDOWN_GATE', count: '7' }
          ]
        },
        { perAlgorithm: [] }
      ];

      const module = await buildModule(liveSequence, paperSequence);
      service = module.get(LiveTradeSignalConversionService);

      const metrics = await service.getConversionMetrics({}, {});

      expect(metrics.topRejectionReasons).toHaveLength(5);
      expect(metrics.topRejectionReasons[0]).toMatchObject({ reasonCode: 'SIGNAL_THROTTLED', count: 80 });
      expect(metrics.topRejectionReasons[1]).toMatchObject({ reasonCode: 'INSUFFICIENT_FUNDS', count: 40 });
      const top5Codes = metrics.topRejectionReasons.map((r) => r.reasonCode);
      expect(top5Codes).not.toContain('DRAWDOWN_GATE');
      expect(top5Codes).not.toContain('DAILY_LOSS_LIMIT');
    });

    it('substitutes UNKNOWN for null reason codes', async () => {
      const liveSequence: QbResults[] = [
        { totals: { totalSignals: '50', placedSignals: '0' } },
        { reasons: [{ reasonCode: null, count: '50' }] },
        { perAlgorithm: [] }
      ];

      const module = await buildModule(liveSequence, emptyResults());
      service = module.get(LiveTradeSignalConversionService);

      const metrics = await service.getConversionMetrics({}, {});

      expect(metrics.topRejectionReasons[0].reasonCode).toBe('UNKNOWN');
      expect(metrics.topRejectionReasons[0].count).toBe(50);
    });

    it('returns zero conversion when no signals exist', async () => {
      const module = await buildModule(emptyResults(), emptyResults());
      service = module.get(LiveTradeSignalConversionService);

      const metrics = await service.getConversionMetrics({}, {});

      expect(metrics.totalSignals).toBe(0);
      expect(metrics.placedSignals).toBe(0);
      expect(metrics.rejectedSignals).toBe(0);
      expect(metrics.conversionPct).toBe(0);
      expect(metrics.topRejectionReasons).toEqual([]);
      expect(metrics.perAlgorithm).toEqual([]);
    });

    it('merges per-algorithm rows from live and paper with combined totals', async () => {
      const liveSequence: QbResults[] = [
        { totals: { totalSignals: '0', placedSignals: '0' } },
        { reasons: [] },
        {
          perAlgorithm: [{ algorithmId: 'algo-1', totalSignals: '20', placedSignals: '5' }]
        }
      ];
      const paperSequence: QbResults[] = [
        { totals: { totalSignals: '100', placedSignals: '5' } },
        { reasons: [] },
        {
          perAlgorithm: [
            { algorithmId: 'algo-1', totalSignals: '80', placedSignals: '0' },
            { algorithmId: 'algo-2', totalSignals: '20', placedSignals: '5' }
          ]
        }
      ];

      const module = await buildModule(liveSequence, paperSequence);
      service = module.get(LiveTradeSignalConversionService);

      const metrics = await service.getConversionMetrics({}, {});

      const algo1 = metrics.perAlgorithm.find((r) => r.algorithmId === 'algo-1');
      const algo2 = metrics.perAlgorithm.find((r) => r.algorithmId === 'algo-2');

      expect(algo1).toMatchObject({ algorithmId: 'algo-1', totalSignals: 100, placedSignals: 5 });
      expect(algo1?.conversionPct).toBeCloseTo(5, 4);
      expect(algo2).toMatchObject({ algorithmId: 'algo-2', totalSignals: 20, placedSignals: 5 });
      expect(algo2?.conversionPct).toBeCloseTo(25, 4);
    });

    it('skips per-algorithm rows with falsy algorithmId', async () => {
      const paperSequence: QbResults[] = [
        { totals: { totalSignals: '30', placedSignals: '0' } },
        { reasons: [] },
        {
          perAlgorithm: [
            { algorithmId: '', totalSignals: '10', placedSignals: '0' },
            { algorithmId: 'algo-1', totalSignals: '20', placedSignals: '0' }
          ]
        }
      ];

      const module = await buildModule(emptyResults(), paperSequence);
      service = module.get(LiveTradeSignalConversionService);

      const metrics = await service.getConversionMetrics({}, {});

      expect(metrics.perAlgorithm).toHaveLength(1);
      expect(metrics.perAlgorithm[0].algorithmId).toBe('algo-1');
    });

    it('applies algorithmId, userId and date filters to both live and paper queries', async () => {
      const module = await buildModule(emptyResults(), emptyResults());
      service = module.get(LiveTradeSignalConversionService);

      const startDate = new Date('2026-04-01T00:00:00.000Z');
      const endDate = new Date('2026-04-27T00:00:00.000Z');
      await service.getConversionMetrics({ algorithmId: 'algo-1', userId: 'user-1' }, { startDate, endDate });

      const liveAndWhereCalls = (liveQb.andWhere as jest.Mock).mock.calls;
      expect(liveAndWhereCalls).toEqual(
        expect.arrayContaining([
          ['aa.algorithmId = :algorithmId', { algorithmId: 'algo-1' }],
          ['ls.userId = :userId', { userId: 'user-1' }],
          ['ls.createdAt >= :startDate', { startDate }],
          ['ls.createdAt <= :endDate', { endDate }]
        ])
      );

      const paperAndWhereCalls = (paperQb.andWhere as jest.Mock).mock.calls;
      expect(paperAndWhereCalls).toEqual(
        expect.arrayContaining([
          ['sess.algorithmId = :algorithmId', { algorithmId: 'algo-1' }],
          ['sess.userId = :userId', { userId: 'user-1' }],
          ['ps.createdAt >= :startDate', { startDate }],
          ['ps.createdAt <= :endDate', { endDate }]
        ])
      );
    });
  });
});
