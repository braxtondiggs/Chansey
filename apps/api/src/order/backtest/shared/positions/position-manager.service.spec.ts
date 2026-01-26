import { Test, TestingModule } from '@nestjs/testing';

import { Position, PositionSizingConfig } from './position-manager.interface';
import { PositionManagerService } from './position-manager.service';

describe('PositionManagerService', () => {
  let service: PositionManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PositionManagerService]
    }).compile();

    service = module.get<PositionManagerService>(PositionManagerService);
  });

  describe('openPosition', () => {
    const baseInput = {
      coinId: 'bitcoin',
      price: 50000,
      availableCapital: 100000,
      portfolioValue: 100000
    };

    describe('new position', () => {
      it('should open position with explicit quantity', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          quantity: 0.5
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.5);
        expect(result.price).toBe(50000);
        expect(result.totalValue).toBe(25000);
        expect(result.position?.quantity).toBe(0.5);
        expect(result.position?.averagePrice).toBe(50000);
      });

      it('should open position with percentage', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          percentage: 0.1 // 10% of portfolio
        });

        expect(result.success).toBe(true);
        // 10% of 100000 = 10000 / 50000 price = 0.2 quantity
        expect(result.quantity).toBe(0.2);
        expect(result.totalValue).toBe(10000);
      });

      it('should open position with confidence-based sizing', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          confidence: 0.8
        });

        expect(result.success).toBe(true);
        // With default config: min=5%, max=20%
        // allocation = 5% + 0.8 * 15% = 17%
        // 17% of 100000 = 17000 / 50000 = 0.34
        expect(result.quantity).toBeCloseTo(0.34, 2);
      });

      it('should prioritize explicit quantity over percentage/confidence', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          quantity: 0.1,
          percentage: 0.5,
          confidence: 1
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.1);
        expect(result.totalValue).toBe(5000);
      });

      it('should use minimum allocation when no sizing provided', () => {
        const result = service.openPosition(undefined, baseInput);

        expect(result.success).toBe(true);
        // Default min allocation = 5%
        // 5% of 100000 = 5000 / 50000 = 0.1
        expect(result.quantity).toBe(0.1);
      });

      it('should fail when insufficient capital', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          quantity: 10, // $500,000 worth
          availableCapital: 10000
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Insufficient capital');
      });
    });

    describe('increase existing position', () => {
      const existingPosition: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 45000,
        totalValue: 50000
      };

      it('should increase position and calculate new average price', () => {
        const result = service.openPosition(existingPosition, {
          ...baseInput,
          quantity: 0.5
        });

        expect(result.success).toBe(true);
        expect(result.position?.quantity).toBe(1.5);
        // New avg: (45000 * 1 + 50000 * 0.5) / 1.5 = 70000 / 1.5 = 46666.67
        expect(result.position?.averagePrice).toBeCloseTo(46666.67, 0);
      });

      it('should handle adding to zero-quantity position', () => {
        const emptyPosition: Position = {
          coinId: 'bitcoin',
          quantity: 0,
          averagePrice: 0,
          totalValue: 0
        };

        const result = service.openPosition(emptyPosition, {
          ...baseInput,
          quantity: 0.5
        });

        expect(result.success).toBe(true);
        expect(result.position?.quantity).toBe(0.5);
        expect(result.position?.averagePrice).toBe(50000);
      });

      it('should preserve coinId when increasing position', () => {
        const result = service.openPosition(existingPosition, {
          ...baseInput,
          quantity: 0.25
        });

        expect(result.position?.coinId).toBe('bitcoin');
      });
    });

    describe('validation', () => {
      it('should reject zero quantity', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          quantity: 0
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('greater than zero');
      });

      it('should reject negative quantity', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          quantity: -1
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('negative');
      });

      it('should reject zero price', () => {
        const result = service.openPosition(undefined, {
          ...baseInput,
          price: 0,
          quantity: 1
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Price');
      });
    });
  });

  describe('closePosition', () => {
    const existingPosition: Position = {
      coinId: 'bitcoin',
      quantity: 1,
      averagePrice: 45000,
      totalValue: 50000
    };

    describe('full close', () => {
      it('should close entire position with profit', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(1);
        expect(result.price).toBe(55000);
        expect(result.totalValue).toBe(55000);
        expect(result.realizedPnL).toBe(10000); // (55000 - 45000) * 1
        expect(result.realizedPnLPercent).toBeCloseTo(0.2222, 3); // 10000/45000
        expect(result.costBasis).toBe(45000);
        expect(result.position).toBeUndefined();
      });

      it('should close entire position with loss', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 40000
        });

        expect(result.success).toBe(true);
        expect(result.realizedPnL).toBe(-5000); // (40000 - 45000) * 1
        expect(result.realizedPnLPercent).toBeCloseTo(-0.1111, 3);
      });
    });

    describe('partial close', () => {
      it('should close partial position with explicit quantity', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000,
          quantity: 0.5
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.5);
        expect(result.realizedPnL).toBe(5000); // (55000 - 45000) * 0.5
        expect(result.position?.quantity).toBe(0.5);
        expect(result.position?.averagePrice).toBe(45000); // Unchanged
      });

      it('should close partial position with percentage', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000,
          percentage: 0.25 // 25%
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.25);
        expect(result.position?.quantity).toBe(0.75);
      });

      it('should close with confidence-based sizing', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000,
          confidence: 0.5
        });

        expect(result.success).toBe(true);
        // confidence 0.5: 25% + 0.5 * 75% = 62.5%
        expect(result.quantity).toBeCloseTo(0.625, 3);
      });

      it('should prioritize explicit quantity over percentage/confidence on close', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000,
          quantity: 0.2,
          percentage: 0.9,
          confidence: 1
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.2);
      });

      it('should not sell more than available', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000,
          quantity: 10 // More than we have
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(1); // Capped to available
      });
    });

    describe('validation', () => {
      it('should reject zero price when closing position', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 0,
          quantity: 0.1
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Price');
      });

      it('should reject closing non-existent position', () => {
        const result = service.closePosition(
          { coinId: 'bitcoin', quantity: 0, averagePrice: 0, totalValue: 0 },
          { coinId: 'bitcoin', price: 55000 }
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('No position');
      });

      it('should reject zero quantity', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000,
          quantity: 0
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('greater than zero');
      });

      it('should reject negative quantity', () => {
        const result = service.closePosition(existingPosition, {
          coinId: 'bitcoin',
          price: 55000,
          quantity: -1
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('negative');
      });
    });
  });

  describe('calculatePositionSize', () => {
    it('should calculate size with default config', () => {
      const quantity = service.calculatePositionSize(100000, 0.5, 50000);

      // 50% confidence: allocation = 5% + 0.5 * 15% = 12.5%
      // 12.5% of 100000 = 12500 / 50000 = 0.25
      expect(quantity).toBeCloseTo(0.25, 3);
    });

    it('should calculate minimum size at 0 confidence', () => {
      const quantity = service.calculatePositionSize(100000, 0, 50000);

      // 0% confidence: allocation = 5% (min)
      expect(quantity).toBeCloseTo(0.1, 3);
    });

    it('should calculate maximum size at 1.0 confidence', () => {
      const quantity = service.calculatePositionSize(100000, 1.0, 50000);

      // 100% confidence: allocation = 20% (max)
      expect(quantity).toBeCloseTo(0.4, 3);
    });

    it('should clamp confidence to valid range', () => {
      const overConfidence = service.calculatePositionSize(100000, 1.5, 50000);
      const negativeConfidence = service.calculatePositionSize(100000, -0.5, 50000);

      // Should clamp to 1.0 and 0.0 respectively
      expect(overConfidence).toBeCloseTo(0.4, 3); // max allocation
      expect(negativeConfidence).toBeCloseTo(0.1, 3); // min allocation
    });

    it('should use custom config', () => {
      const config: PositionSizingConfig = {
        minAllocation: 0.1,
        maxAllocation: 0.5
      };

      const quantity = service.calculatePositionSize(100000, 0.5, 50000, config);

      // 50% confidence: allocation = 10% + 0.5 * 40% = 30%
      // 30% of 100000 = 30000 / 50000 = 0.6
      expect(quantity).toBeCloseTo(0.6, 3);
    });

    it('should handle minAllocation equal to maxAllocation', () => {
      const config: PositionSizingConfig = {
        minAllocation: 0.2,
        maxAllocation: 0.2
      };

      const quantity = service.calculatePositionSize(100000, 0.9, 50000, config);

      // Allocation fixed at 20%
      expect(quantity).toBeCloseTo(0.4, 3);
    });
  });

  describe('validatePosition', () => {
    const baseOpenInput = {
      coinId: 'bitcoin',
      price: 50000,
      availableCapital: 100000,
      portfolioValue: 100000
    };

    it('should return undefined for valid open', () => {
      const error = service.validatePosition('open', undefined, { ...baseOpenInput, quantity: 1 }, 0);
      expect(error).toBeUndefined();
    });

    it('should return undefined for valid close', () => {
      const position: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 50000
      };

      const error = service.validatePosition('close', position, { coinId: 'bitcoin', price: 55000 }, 1);
      expect(error).toBeUndefined();
    });

    it('should detect zero quantity', () => {
      const error = service.validatePosition('open', undefined, { ...baseOpenInput, quantity: 0 }, 0);

      expect(error).toBeDefined();
      expect(error?.code).toBe('ZERO_QUANTITY');
    });

    it('should detect negative quantity', () => {
      const error = service.validatePosition('open', undefined, { ...baseOpenInput, quantity: -1 }, 0);

      expect(error).toBeDefined();
      expect(error?.code).toBe('NEGATIVE_QUANTITY');
    });

    it('should detect invalid price', () => {
      const error = service.validatePosition('open', undefined, { ...baseOpenInput, price: 0, quantity: 1 }, 0);

      expect(error).toBeDefined();
      expect(error?.code).toBe('INVALID_PRICE');
    });

    it('should allow close with percentage over 1 (clamped by closePosition)', () => {
      const position: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 50000
      };

      const error = service.validatePosition('close', position, { coinId: 'bitcoin', price: 55000, percentage: 2 }, 0);

      expect(error).toBeUndefined();
    });

    it('should detect max positions reached', () => {
      const config: PositionSizingConfig = { maxPositions: 5 };

      const error = service.validatePosition('open', undefined, { ...baseOpenInput, quantity: 1 }, 5, config);

      expect(error).toBeDefined();
      expect(error?.code).toBe('MAX_POSITIONS');
    });

    it('should allow increase when at max positions', () => {
      const config: PositionSizingConfig = { maxPositions: 5 };
      const existingPosition: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 50000
      };

      const error = service.validatePosition('open', existingPosition, { ...baseOpenInput, quantity: 1 }, 5, config);

      expect(error).toBeUndefined(); // Increasing existing is OK
    });

    it('should detect no position to close', () => {
      const error = service.validatePosition('close', undefined, { coinId: 'bitcoin', price: 55000 }, 0);

      expect(error).toBeDefined();
      expect(error?.code).toBe('NO_POSITION');
    });
  });

  describe('updatePositionValue', () => {
    it('should update total value with new price', () => {
      const position: Position = {
        coinId: 'bitcoin',
        quantity: 2,
        averagePrice: 45000,
        totalValue: 90000
      };

      const updated = service.updatePositionValue(position, 55000);

      expect(updated.quantity).toBe(2);
      expect(updated.averagePrice).toBe(45000); // Unchanged
      expect(updated.totalValue).toBe(110000); // 2 * 55000
    });

    it('should handle zero price', () => {
      const position: Position = {
        coinId: 'bitcoin',
        quantity: 2,
        averagePrice: 45000,
        totalValue: 90000
      };

      const updated = service.updatePositionValue(position, 0);

      expect(updated.totalValue).toBe(0);
    });

    it('should not mutate original position', () => {
      const position: Position = {
        coinId: 'bitcoin',
        quantity: 2,
        averagePrice: 45000,
        totalValue: 90000
      };

      const updated = service.updatePositionValue(position, 50000);

      expect(updated).not.toBe(position);
      expect(position.totalValue).toBe(90000);
    });
  });
});
