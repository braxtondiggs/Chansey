import {
  ABSOLUTE_MAX_ALLOCATION_CAP,
  AllocationLimits,
  getAllocationLimits,
  STAGE_RISK_ALLOCATION_MATRIX
} from './allocation-limits';
import { PipelineStage } from './pipeline.interface';

describe('AllocationLimits', () => {
  describe('STAGE_RISK_ALLOCATION_MATRIX', () => {
    it('should have entries for all tradeable stages', () => {
      const stages = [
        PipelineStage.OPTIMIZE,
        PipelineStage.HISTORICAL,
        PipelineStage.LIVE_REPLAY,
        PipelineStage.PAPER_TRADE
      ];
      for (const stage of stages) {
        expect(STAGE_RISK_ALLOCATION_MATRIX[stage]).toBeDefined();
        expect(STAGE_RISK_ALLOCATION_MATRIX[stage]).toHaveLength(5);
      }
    });

    it('should not have an entry for COMPLETED stage', () => {
      expect(STAGE_RISK_ALLOCATION_MATRIX[PipelineStage.COMPLETED]).toBeUndefined();
    });

    it('should have values where max >= min for every cell', () => {
      for (const [stage, rows] of Object.entries(STAGE_RISK_ALLOCATION_MATRIX)) {
        for (let i = 0; i < rows.length; i++) {
          expect(rows[i].maxAllocation).toBeGreaterThanOrEqual(rows[i].minAllocation);
        }
      }
    });

    it('should never exceed ABSOLUTE_MAX_ALLOCATION_CAP', () => {
      for (const rows of Object.values(STAGE_RISK_ALLOCATION_MATRIX)) {
        for (const row of rows) {
          expect(row.maxAllocation).toBeLessThanOrEqual(ABSOLUTE_MAX_ALLOCATION_CAP);
        }
      }
    });
  });

  describe('getAllocationLimits', () => {
    it('should return HISTORICAL risk-3 defaults when called with no arguments', () => {
      const limits = getAllocationLimits();
      expect(limits.maxAllocation).toBe(0.12);
      expect(limits.minAllocation).toBe(0.03);
    });

    it('should return correct values for each stage × risk combination', () => {
      const expected: Record<string, AllocationLimits[]> = {
        [PipelineStage.OPTIMIZE]: [
          { maxAllocation: 0.06, minAllocation: 0.02 },
          { maxAllocation: 0.07, minAllocation: 0.02 },
          { maxAllocation: 0.08, minAllocation: 0.02 },
          { maxAllocation: 0.09, minAllocation: 0.02 },
          { maxAllocation: 0.1, minAllocation: 0.02 }
        ],
        [PipelineStage.HISTORICAL]: [
          { maxAllocation: 0.08, minAllocation: 0.02 },
          { maxAllocation: 0.1, minAllocation: 0.02 },
          { maxAllocation: 0.12, minAllocation: 0.03 },
          { maxAllocation: 0.13, minAllocation: 0.03 },
          { maxAllocation: 0.15, minAllocation: 0.03 }
        ],
        [PipelineStage.LIVE_REPLAY]: [
          { maxAllocation: 0.07, minAllocation: 0.02 },
          { maxAllocation: 0.09, minAllocation: 0.02 },
          { maxAllocation: 0.1, minAllocation: 0.02 },
          { maxAllocation: 0.11, minAllocation: 0.03 },
          { maxAllocation: 0.12, minAllocation: 0.03 }
        ],
        [PipelineStage.PAPER_TRADE]: [
          { maxAllocation: 0.06, minAllocation: 0.02 },
          { maxAllocation: 0.07, minAllocation: 0.02 },
          { maxAllocation: 0.08, minAllocation: 0.02 },
          { maxAllocation: 0.09, minAllocation: 0.02 },
          { maxAllocation: 0.1, minAllocation: 0.03 }
        ]
      };

      for (const [stage, rows] of Object.entries(expected)) {
        for (let risk = 1; risk <= 5; risk++) {
          const limits = getAllocationLimits(stage, risk);
          expect(limits).toEqual(rows[risk - 1]);
        }
      }
    });

    it('should clamp risk level below 1 to 1', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 0);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.HISTORICAL, 1));
    });

    it('should clamp risk level above 5 to 5', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 10);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.HISTORICAL, 5));
    });

    it('should fall back to HISTORICAL risk-3 for unknown stage', () => {
      const limits = getAllocationLimits(PipelineStage.COMPLETED, 3);
      expect(limits.maxAllocation).toBe(0.12);
      expect(limits.minAllocation).toBe(0.03);
    });

    it('should apply maxAllocation override', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 3, { maxAllocation: 0.05 });
      expect(limits.maxAllocation).toBe(0.05);
      // minAllocation should be clamped to not exceed maxAllocation
      expect(limits.minAllocation).toBe(0.03);
    });

    it('should apply minAllocation override', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 3, { minAllocation: 0.01 });
      expect(limits.minAllocation).toBe(0.01);
      expect(limits.maxAllocation).toBe(0.12);
    });

    it('should clamp minAllocation to not exceed maxAllocation when overridden', () => {
      const limits = getAllocationLimits(PipelineStage.OPTIMIZE, 1, { minAllocation: 0.1 });
      // maxAllocation for OPTIMIZE risk-1 is 0.06, so minAllocation gets clamped to 0.06
      expect(limits.minAllocation).toBe(0.06);
    });

    it('should enforce ABSOLUTE_MAX_ALLOCATION_CAP on overrides', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 5, { maxAllocation: 0.5 });
      expect(limits.maxAllocation).toBe(ABSOLUTE_MAX_ALLOCATION_CAP);
    });

    it('should default riskLevel to 3 when undefined', () => {
      const limits = getAllocationLimits(PipelineStage.PAPER_TRADE, undefined);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.PAPER_TRADE, 3));
    });

    it('should round fractional riskLevel 2.5 to 3', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 2.5);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.HISTORICAL, 3));
    });

    it('should round fractional riskLevel 2.4 to 2', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 2.4);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.HISTORICAL, 2));
    });

    it('should round fractional riskLevel 4.7 to 5', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 4.7);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.HISTORICAL, 5));
    });

    it('should round fractional riskLevel 1.1 to 1', () => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, 1.1);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.HISTORICAL, 1));
    });
  });
});
