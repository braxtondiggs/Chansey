import { Test, type TestingModule } from '@nestjs/testing';

import { type WindowMetrics } from '@chansey/api-interfaces';

import { DegradationCalculator, type DegradationAnalysis } from './degradation.calculator';
import { type WalkForwardWindowConfig } from './walk-forward.service';
import { WindowProcessor, type WindowProcessingResult } from './window-processor';

describe('WindowProcessor', () => {
  let processor: WindowProcessor;
  let degradationCalculator: jest.Mocked<DegradationCalculator>;

  const makeMetrics = (overrides: Partial<WindowMetrics> = {}): WindowMetrics => ({
    totalReturn: 0.15,
    sharpeRatio: 1.5,
    maxDrawdown: 0.1,
    winRate: 0.6,
    tradeCount: 50,
    profitFactor: 1.8,
    volatility: 0.2,
    ...overrides
  });

  const makeWindow = (index = 0): WalkForwardWindowConfig => ({
    windowIndex: index,
    trainStartDate: new Date('2023-01-01'),
    trainEndDate: new Date('2023-06-30'),
    testStartDate: new Date('2023-07-01'),
    testEndDate: new Date('2023-09-30')
  });

  const makeResult = (overrides: Partial<WindowProcessingResult> = {}): WindowProcessingResult => ({
    windowIndex: 0,
    trainMetrics: makeMetrics(),
    testMetrics: makeMetrics(),
    degradation: 15,
    overfittingDetected: false,
    ...overrides
  });

  const defaultAnalysis: DegradationAnalysis = {
    overallDegradation: 15,
    metricDegradations: {
      sharpeRatio: 20,
      totalReturn: 10,
      maxDrawdown: 5,
      winRate: 8,
      profitFactor: 12,
      volatility: 3
    },
    severity: 'good',
    recommendation: 'Acceptable for deployment.'
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WindowProcessor,
        {
          provide: DegradationCalculator,
          useValue: {
            calculate: jest.fn().mockReturnValue(defaultAnalysis)
          }
        }
      ]
    }).compile();

    processor = module.get(WindowProcessor);
    degradationCalculator = module.get(DegradationCalculator);
  });

  describe('calculateDegradation', () => {
    it('delegates to DegradationCalculator and returns overallDegradation', () => {
      const train = makeMetrics();
      const test = makeMetrics({ sharpeRatio: 1.0 });

      const result = processor.calculateDegradation(train, test);

      expect(degradationCalculator.calculate).toHaveBeenCalledWith(train, test);
      expect(result).toBe(15);
    });
  });

  describe('processWindow', () => {
    it('returns correct shape with degradation and overfitting flag', () => {
      const result = processor.processWindow(makeWindow(2), makeMetrics(), makeMetrics({ sharpeRatio: 1.0 }));

      expect(result).toEqual({
        windowIndex: 2,
        degradation: 15,
        overfittingDetected: false,
        trainMetrics: expect.any(Object),
        testMetrics: expect.any(Object)
      });
    });

    it('sets overfittingDetected when degradation exceeds 30%', () => {
      degradationCalculator.calculate.mockReturnValue({
        ...defaultAnalysis,
        overallDegradation: 35,
        severity: 'warning'
      });

      const result = processor.processWindow(makeWindow(), makeMetrics(), makeMetrics());
      expect(result.overfittingDetected).toBe(true);
    });
  });

  describe('detectOverfitting', () => {
    it.each([
      ['degradation > 30', 31, makeMetrics(), makeMetrics(), true],
      ['degradation === 30 (boundary)', 30, makeMetrics(), makeMetrics(), false],
      ['degradation well below threshold', 10, makeMetrics(), makeMetrics(), false],
      [
        'Sharpe drops from >1.0 to <0.5',
        10,
        makeMetrics({ sharpeRatio: 1.5 }),
        makeMetrics({ sharpeRatio: 0.3 }),
        true
      ],
      [
        'Sharpe at boundary (1.0 train, 0.5 test) — no overfitting',
        10,
        makeMetrics({ sharpeRatio: 1.0 }),
        makeMetrics({ sharpeRatio: 0.5 }),
        false
      ],
      [
        'positive train returns flip to negative test (below -0.05)',
        10,
        makeMetrics({ totalReturn: 0.1 }),
        makeMetrics({ totalReturn: -0.1 }),
        true
      ],
      [
        'test return at -0.05 boundary — no overfitting',
        10,
        makeMetrics({ totalReturn: 0.1 }),
        makeMetrics({ totalReturn: -0.05 }),
        false
      ],
      ['win rate drops more than 20pp', 10, makeMetrics({ winRate: 0.7 }), makeMetrics({ winRate: 0.45 }), true],
      [
        'win rate drops exactly 20pp (boundary) — no overfitting',
        10,
        makeMetrics({ winRate: 0.7 }),
        makeMetrics({ winRate: 0.5 }),
        false
      ],
      [
        'minor declines across all metrics — no overfitting',
        20,
        makeMetrics({ sharpeRatio: 1.5, totalReturn: 0.15, winRate: 0.6 }),
        makeMetrics({ sharpeRatio: 1.2, totalReturn: 0.1, winRate: 0.55 }),
        false
      ]
    ])('%s → %s', (_label, degradation, train, test, expected) => {
      expect(processor.detectOverfitting(degradation as number, train as WindowMetrics, test as WindowMetrics)).toBe(
        expected
      );
    });
  });

  describe('aggregateWindowResults', () => {
    it('returns zeros for empty array', () => {
      const result = processor.aggregateWindowResults([]);
      expect(result).toEqual({
        avgDegradation: 0,
        maxDegradation: 0,
        minDegradation: 0,
        overfittingCount: 0,
        consistencyScore: 0
      });
    });

    it('calculates correct avg/max/min degradation and overfitting count', () => {
      const windows = [
        makeResult({ windowIndex: 0, degradation: 10 }),
        makeResult({ windowIndex: 1, degradation: 20 }),
        makeResult({ windowIndex: 2, degradation: 30, overfittingDetected: true })
      ];

      const result = processor.aggregateWindowResults(windows);
      expect(result.avgDegradation).toBe(20);
      expect(result.maxDegradation).toBe(30);
      expect(result.minDegradation).toBe(10);
      expect(result.overfittingCount).toBe(1);
    });

    it('produces consistency score of 100 when degradations are uniform', () => {
      const windows = [makeResult({ degradation: 15 }), makeResult({ windowIndex: 1, degradation: 15 })];

      expect(processor.aggregateWindowResults(windows).consistencyScore).toBe(100);
    });

    it('produces lower consistency score when degradations vary widely', () => {
      const windows = [
        makeResult({ degradation: 5 }),
        makeResult({ windowIndex: 1, degradation: 50 }),
        makeResult({ windowIndex: 2, degradation: 80 })
      ];

      const result = processor.aggregateWindowResults(windows);
      expect(result.consistencyScore).toBeLessThan(50);
    });

    it('handles single window (stddev=0, consistency=100)', () => {
      const windows = [makeResult({ degradation: 25 })];

      const result = processor.aggregateWindowResults(windows);
      expect(result.avgDegradation).toBe(25);
      expect(result.maxDegradation).toBe(25);
      expect(result.minDegradation).toBe(25);
      expect(result.consistencyScore).toBe(100);
    });
  });

  describe('generateDegradationReport', () => {
    it('generates report string with correct stats', () => {
      const windows = [
        makeResult({ degradation: 10 }),
        makeResult({ windowIndex: 1, degradation: 20, overfittingDetected: true })
      ];

      const report = processor.generateDegradationReport(windows);

      expect(report).toContain('Total Windows: 2');
      expect(report).toContain('Average Degradation: 15.00%');
      expect(report).toContain('Max Degradation: 20.00%');
      expect(report).toContain('Min Degradation: 10.00%');
      expect(report).toContain('Overfitting Detected: 1 windows');
    });

    it('handles empty windows array', () => {
      const report = processor.generateDegradationReport([]);

      expect(report).toContain('Total Windows: 0');
      expect(report).toContain('Average Degradation: 0.00%');
    });
  });
});
