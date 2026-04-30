import { type WalkForwardConfig } from '@chansey/api-interfaces';

import { MIN_TEST_WINDOW_DAYS, WalkForwardService } from './walk-forward.service';

// Mirror the service's local-time setDate-based addDays so tests don't drift across DST.
const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const daysBetween = (date1: Date, date2: Date): number => {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date2.getTime() - date1.getTime()) / oneDay));
};

describe('WalkForwardService', () => {
  let service: WalkForwardService;

  beforeEach(() => {
    service = new WalkForwardService();
  });

  describe('generateWindows', () => {
    it('produces equal-length windows when no usable tail remains past the last full window', () => {
      // stepDays equals trainDays + testDays + 1 so back-to-back windows fully consume
      // the range with no overlap and no leftover tail to clamp.
      const startDate = new Date(2025, 0, 1);
      const endDate = addDays(startDate, 102); // exactly window 1's testEnd

      const windows = service.generateWindows({
        startDate,
        endDate,
        trainDays: 30,
        testDays: 20,
        stepDays: 51
      });

      expect(windows.length).toBe(2);
      for (const w of windows) {
        expect(daysBetween(w.trainStartDate, w.trainEndDate)).toBe(30);
        expect(daysBetween(w.testStartDate, w.testEndDate)).toBe(20);
      }
    });

    it('clamps the final test window to endDate when remainder >= MIN_TEST_WINDOW_DAYS', () => {
      const startDate = new Date(2025, 0, 1);
      // window0 fits cleanly; window1 testStart = day 52, would-be testEnd = day 72.
      // endDate = day 70 → remainder 18 days ≥ 14, so the final window is clamped.
      const endDate = addDays(startDate, 70);

      const windows = service.generateWindows({
        startDate,
        endDate,
        trainDays: 30,
        testDays: 20,
        stepDays: 21
      });

      expect(windows.length).toBe(2);
      const last = windows[windows.length - 1];
      expect(last.testEndDate.getTime()).toBe(endDate.getTime());
      expect(daysBetween(last.testStartDate, last.testEndDate)).toBeGreaterThanOrEqual(MIN_TEST_WINDOW_DAYS);
    });

    it('skips the final window when remainder < MIN_TEST_WINDOW_DAYS', () => {
      const startDate = new Date(2025, 0, 1);
      // Same config as above but endDate = day 60 → window1 remainder = 8 days, must be skipped.
      const endDate = addDays(startDate, 60);

      const windows = service.generateWindows({
        startDate,
        endDate,
        trainDays: 30,
        testDays: 20,
        stepDays: 21
      });

      expect(windows.length).toBe(1);
      expect(windows[0].testEndDate.getTime()).toBeLessThanOrEqual(endDate.getTime());
    });

    it('clamps a 14-day tail in the production blind-spot scenario (trainDays=120, testDays=30, stepDays=21)', () => {
      const startDate = new Date(2025, 0, 1);
      // window0: train[0..120], test[121..151]; window1 would-be test[142..172].
      // endDate = day 156 → remainder 14 days, exactly at the floor, so the window is clamped.
      const endDate = addDays(startDate, 156);

      const windows = service.generateWindows({
        startDate,
        endDate,
        trainDays: 120,
        testDays: 30,
        stepDays: 21
      });

      expect(windows.length).toBe(2);
      expect(windows[1].testEndDate.getTime()).toBe(endDate.getTime());
    });

    it('inserts a 1-day gap between trainEndDate and testStartDate', () => {
      const startDate = new Date(2025, 0, 1);
      const windows = service.generateWindows({
        startDate,
        endDate: addDays(startDate, 102),
        trainDays: 30,
        testDays: 20,
        stepDays: 51
      });

      for (const w of windows) {
        expect(daysBetween(w.trainEndDate, w.testStartDate)).toBe(1);
      }
    });

    it('returns an empty array when the range cannot fit a single train window', () => {
      const startDate = new Date(2025, 0, 1);
      const windows = service.generateWindows({
        startDate,
        endDate: addDays(startDate, 20), // shorter than trainDays
        trainDays: 30,
        testDays: 10,
        stepDays: 10
      });

      expect(windows).toEqual([]);
    });

    it("throws when called with method: 'anchored' (not yet implemented)", () => {
      expect(() =>
        service.generateWindows({
          startDate: new Date(2025, 0, 1),
          endDate: addDays(new Date(2025, 0, 1), 102),
          trainDays: 30,
          testDays: 20,
          stepDays: 21,
          method: 'anchored'
        })
      ).toThrow(/anchored/i);
    });

    it.each([
      ['trainDays', { trainDays: 0, testDays: 10, stepDays: 10 }],
      ['testDays', { trainDays: 10, testDays: 0, stepDays: 10 }],
      ['stepDays', { trainDays: 10, testDays: 10, stepDays: 0 }],
      ['negative trainDays', { trainDays: -1, testDays: 10, stepDays: 10 }]
    ])('throws when %s is not positive', (_label, days) => {
      const startDate = new Date(2025, 0, 1);
      expect(() =>
        service.generateWindows({
          startDate,
          endDate: addDays(startDate, 100),
          ...days
        })
      ).toThrow(/must be positive/);
    });

    it('throws when startDate is not before endDate', () => {
      const startDate = new Date(2025, 0, 1);
      expect(() =>
        service.generateWindows({
          startDate,
          endDate: startDate,
          trainDays: 10,
          testDays: 10,
          stepDays: 10
        })
      ).toThrow(/startDate must be before endDate/);
    });
  });

  describe('validateConfig', () => {
    const baseConfig: WalkForwardConfig = {
      trainDays: 180,
      testDays: 90,
      stepDays: 30,
      method: 'rolling'
    };

    it('accepts a config that meets all rules', () => {
      expect(service.validateConfig(baseConfig)).toEqual({ valid: true, errors: [] });
    });

    it.each<[string, Partial<WalkForwardConfig>, RegExp]>([
      ['non-positive trainDays', { trainDays: 0 }, /trainDays must be positive/],
      ['non-positive testDays', { testDays: 0 }, /testDays must be positive/],
      ['non-positive stepDays', { stepDays: 0 }, /stepDays must be positive/],
      ['trainDays below statistical-significance floor', { trainDays: 29 }, /trainDays should be at least 30/],
      ['testDays below MIN_TEST_WINDOW_DAYS', { testDays: 13 }, /testDays should be at least 14/],
      ['stepDays exceeding trainDays', { stepDays: 200 }, /stepDays should not exceed trainDays/]
    ])('flags %s', (_label, override, errorRegex) => {
      const result = service.validateConfig({ ...baseConfig, ...override });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => errorRegex.test(e))).toBe(true);
    });
  });

  describe('calculateRequiredDays', () => {
    it('uses rolling formula: trainDays + 1 + testDays + (numWindows - 1) * stepDays', () => {
      const config: WalkForwardConfig = { trainDays: 180, testDays: 90, stepDays: 30, method: 'rolling' };
      // 180 + 1 + 90 + (5-1)*30 = 391
      expect(service.calculateRequiredDays(config, 5)).toBe(391);
    });

    it('uses anchored formula: trainDays + 1 + numWindows * testDays', () => {
      const config: WalkForwardConfig = { trainDays: 180, testDays: 90, stepDays: 30, method: 'anchored' };
      // 180 + 1 + 5*90 = 631
      expect(service.calculateRequiredDays(config, 5)).toBe(631);
    });
  });

  describe('estimateWindowCount', () => {
    const config: WalkForwardConfig = { trainDays: 30, testDays: 10, stepDays: 20, method: 'rolling' };

    it('returns 0 when the range is shorter than a single train+test window', () => {
      // windowSize = 30 + 1 + 10 = 41; range of 30 days is too short
      const startDate = new Date(2025, 0, 1);
      expect(service.estimateWindowCount(startDate, addDays(startDate, 30), config)).toBe(0);
    });

    it('returns floor((totalDays - windowSize) / stepDays) + 1 when range fits', () => {
      // totalDays = 121, windowSize = 41 → floor((121-41)/20) + 1 = 5
      const startDate = new Date(2025, 0, 1);
      expect(service.estimateWindowCount(startDate, addDays(startDate, 121), config)).toBe(5);
    });
  });

  describe('calculateOverlapPercentage', () => {
    it('returns 0 for anchored method (no overlap concept)', () => {
      expect(
        service.calculateOverlapPercentage({ trainDays: 180, testDays: 90, stepDays: 30, method: 'anchored' })
      ).toBe(0);
    });

    it('returns (trainDays - stepDays) / trainDays * 100 for rolling method', () => {
      // (180 - 30) / 180 * 100 = 83.333...
      expect(
        service.calculateOverlapPercentage({ trainDays: 180, testDays: 90, stepDays: 30, method: 'rolling' })
      ).toBeCloseTo(83.333, 2);
    });
  });
});
