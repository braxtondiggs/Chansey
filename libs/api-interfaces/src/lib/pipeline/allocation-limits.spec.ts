import { ABSOLUTE_MAX_ALLOCATION_CAP, getAllocationLimits } from './allocation-limits';
import { PipelineStage } from './pipeline.interface';

describe('AllocationLimits', () => {
  describe('STAGE_RISK_ALLOCATION_MATRIX invariants', () => {
    it('should have max >= min for every cell and never exceed ABSOLUTE_MAX_ALLOCATION_CAP', () => {
      // Import here so the matrix type is available
      const { STAGE_RISK_ALLOCATION_MATRIX } = require('./allocation-limits');
      for (const rows of Object.values(STAGE_RISK_ALLOCATION_MATRIX) as Array<
        Array<{ maxAllocation: number; minAllocation: number }>
      >) {
        expect(rows).toHaveLength(5);
        for (const row of rows) {
          expect(row.maxAllocation).toBeGreaterThanOrEqual(row.minAllocation);
          expect(row.maxAllocation).toBeLessThanOrEqual(ABSOLUTE_MAX_ALLOCATION_CAP);
        }
      }
    });
  });

  describe('getAllocationLimits', () => {
    it('should return HISTORICAL risk-3 defaults when called with no arguments', () => {
      const limits = getAllocationLimits();
      expect(limits).toEqual({ maxAllocation: 0.08, minAllocation: 0.03 });
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
      expect(limits).toEqual({ maxAllocation: 0.08, minAllocation: 0.03 });
    });

    it.each([
      [2.5, 3],
      [2.4, 2],
      [4.7, 5],
      [1.1, 1]
    ])('should round fractional riskLevel %s to %i', (input, expected) => {
      const limits = getAllocationLimits(PipelineStage.HISTORICAL, input);
      expect(limits).toEqual(getAllocationLimits(PipelineStage.HISTORICAL, expected));
    });

    describe('overrides', () => {
      it('should apply maxAllocation override', () => {
        const limits = getAllocationLimits(PipelineStage.HISTORICAL, 3, { maxAllocation: 0.05 });
        expect(limits.maxAllocation).toBe(0.05);
        expect(limits.minAllocation).toBe(0.03);
      });

      it('should apply minAllocation override', () => {
        const limits = getAllocationLimits(PipelineStage.HISTORICAL, 3, { minAllocation: 0.01 });
        expect(limits.minAllocation).toBe(0.01);
        expect(limits.maxAllocation).toBe(0.08);
      });

      it('should clamp minAllocation to not exceed maxAllocation when overridden', () => {
        const limits = getAllocationLimits(PipelineStage.OPTIMIZE, 1, { minAllocation: 0.1 });
        expect(limits.minAllocation).toBe(0.04);
      });

      it('should enforce ABSOLUTE_MAX_ALLOCATION_CAP on overrides', () => {
        const limits = getAllocationLimits(PipelineStage.HISTORICAL, 5, { maxAllocation: 0.5 });
        expect(limits.maxAllocation).toBe(ABSOLUTE_MAX_ALLOCATION_CAP);
      });

      it('should clamp min to max when both overrides conflict', () => {
        const limits = getAllocationLimits(PipelineStage.HISTORICAL, 3, {
          maxAllocation: 0.04,
          minAllocation: 0.07
        });
        expect(limits.maxAllocation).toBe(0.04);
        expect(limits.minAllocation).toBe(0.04);
      });
    });
  });
});
