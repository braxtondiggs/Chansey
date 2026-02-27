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
        // With default config: min=3%, max=12%
        // allocation = 3% + 0.8 * 9% = 10.2%
        // 10.2% of 100000 = 10200 / 50000 = 0.204
        expect(result.quantity).toBeCloseTo(0.204, 2);
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
        // Default min allocation = 3%
        // 3% of 100000 = 3000 / 50000 = 0.06
        expect(result.quantity).toBe(0.06);
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

      // 50% confidence: allocation = 3% + 0.5 * 9% = 7.5%
      // 7.5% of 100000 = 7500 / 50000 = 0.15
      expect(quantity).toBeCloseTo(0.15, 3);
    });

    it('should calculate minimum size at 0 confidence', () => {
      const quantity = service.calculatePositionSize(100000, 0, 50000);

      // 0% confidence: allocation = 3% (min)
      expect(quantity).toBeCloseTo(0.06, 3);
    });

    it('should calculate maximum size at 1.0 confidence', () => {
      const quantity = service.calculatePositionSize(100000, 1.0, 50000);

      // 100% confidence: allocation = 12% (max)
      expect(quantity).toBeCloseTo(0.24, 3);
    });

    it('should clamp confidence to valid range', () => {
      const overConfidence = service.calculatePositionSize(100000, 1.5, 50000);
      const negativeConfidence = service.calculatePositionSize(100000, -0.5, 50000);

      // Should clamp to 1.0 and 0.0 respectively
      expect(overConfidence).toBeCloseTo(0.24, 3); // max allocation (12%)
      expect(negativeConfidence).toBeCloseTo(0.06, 3); // min allocation (3%)
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

  /* ================================================================
   * SHORT / LEVERAGE / FUTURES TESTS
   * ================================================================ */

  describe('openShort', () => {
    const baseInput = {
      coinId: 'bitcoin',
      price: 50000,
      availableCapital: 100000,
      portfolioValue: 100000
    };

    describe('sizing', () => {
      it('should open short with explicit quantity', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.5 }, undefined, 1);

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.5);
        expect(result.price).toBe(50000);
        // marginAmount = (0.5 * 50000) / 1 = 25000
        expect(result.marginAmount).toBe(25000);
        expect(result.totalValue).toBe(25000);
        expect(result.position?.side).toBe('short');
        expect(result.position?.quantity).toBe(0.5);
        expect(result.position?.averagePrice).toBe(50000);
      });

      it('should open short with percentage of portfolio', () => {
        const result = service.openShort(
          undefined,
          { ...baseInput, percentage: 0.1 }, // 10% of portfolio
          undefined,
          1
        );

        expect(result.success).toBe(true);
        // 10% of 100000 = 10000 / 50000 = 0.2
        expect(result.quantity).toBe(0.2);
        expect(result.marginAmount).toBe(10000); // (0.2 * 50000) / 1
      });

      it('should open short with confidence-based sizing', () => {
        const result = service.openShort(undefined, { ...baseInput, confidence: 0.8 }, undefined, 1);

        expect(result.success).toBe(true);
        // allocation = 3% + 0.8 * 9% = 10.2%
        // 10.2% of 100000 = 10200 / 50000 = 0.204
        expect(result.quantity).toBeCloseTo(0.204, 2);
        // marginAmount = (0.204 * 50000) / 1 ≈ 10200
        expect(result.marginAmount).toBeCloseTo(10200, 0);
      });
    });

    describe('margin calculation', () => {
      it('should calculate margin with 1x leverage (no leverage)', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 1 }, undefined, 1);

        expect(result.success).toBe(true);
        // marginAmount = (1 * 50000) / 1 = 50000
        expect(result.marginAmount).toBe(50000);
      });

      it('should calculate margin with 3x leverage', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 1 }, undefined, 3);

        expect(result.success).toBe(true);
        // marginAmount = (1 * 50000) / 3 ≈ 16666.67
        expect(result.marginAmount).toBeCloseTo(16666.67, 1);
      });

      it('should calculate margin with 10x leverage', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 1 }, undefined, 10);

        expect(result.success).toBe(true);
        // marginAmount = (1 * 50000) / 10 = 5000
        expect(result.marginAmount).toBe(5000);
      });
    });

    describe('liquidation price', () => {
      it('should calculate liquidation price for short with 1x leverage', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.1 }, undefined, 1);

        expect(result.success).toBe(true);
        // liquidationPrice = 50000 * (1 + 1/1 - 0.005) = 50000 * 1.995 = 99750
        expect(result.liquidationPrice).toBeCloseTo(99750, 0);
        expect(result.position?.liquidationPrice).toBeCloseTo(99750, 0);
      });

      it('should calculate liquidation price for short with 3x leverage', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.1 }, undefined, 3);

        expect(result.success).toBe(true);
        // liquidationPrice = 50000 * (1 + 1/3 - 0.005) = 50000 * 1.3283... = 66416.67
        expect(result.liquidationPrice).toBeCloseTo(66416.67, 0);
      });

      it('should calculate liquidation price for short with 10x leverage', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.1 }, undefined, 10);

        expect(result.success).toBe(true);
        // liquidationPrice = 50000 * (1 + 1/10 - 0.005) = 50000 * 1.095 = 54750
        expect(result.liquidationPrice).toBeCloseTo(54750, 2);
      });
    });

    describe('insufficient capital', () => {
      it('should fail when margin exceeds available capital', () => {
        const result = service.openShort(
          undefined,
          {
            ...baseInput,
            quantity: 10, // 10 * 50000 / 1 = 500000 margin needed
            availableCapital: 100000
          },
          undefined,
          1
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Insufficient capital');
      });

      it('should succeed when leverage makes margin affordable', () => {
        const result = service.openShort(
          undefined,
          {
            ...baseInput,
            quantity: 10, // 10 * 50000 / 10 = 50000 margin needed
            availableCapital: 100000
          },
          undefined,
          10
        );

        expect(result.success).toBe(true);
        expect(result.marginAmount).toBe(50000);
      });
    });

    describe('position fields', () => {
      it('should set side to short', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.1 }, undefined, 5);

        expect(result.position?.side).toBe('short');
      });

      it('should set leverage on position', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.1 }, undefined, 5);

        expect(result.position?.leverage).toBe(5);
      });

      it('should set marginAmount on position', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.1 }, undefined, 5);

        // marginAmount = (0.1 * 50000) / 5 = 1000
        expect(result.position?.marginAmount).toBe(1000);
      });

      it('should set totalValue to marginAmount', () => {
        const result = service.openShort(undefined, { ...baseInput, quantity: 0.1 }, undefined, 5);

        expect(result.position?.totalValue).toBe(result.position?.marginAmount);
      });
    });
  });

  describe('closeShort', () => {
    // Short position: entered at 50000, 1 BTC, 3x leverage
    // marginAmount = (1 * 50000) / 3 ≈ 16666.67
    const shortPosition: Position = {
      coinId: 'bitcoin',
      quantity: 1,
      averagePrice: 50000,
      totalValue: 16666.67,
      side: 'short',
      leverage: 3,
      marginAmount: 16666.67,
      liquidationPrice: 66416.67
    };

    describe('full close with profit (price dropped)', () => {
      it('should realize profit when price dropped', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 45000 // Price dropped from 50000 to 45000
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(1);
        // P&L = (50000 - 45000) * 1 = 5000 profit
        expect(result.realizedPnL).toBe(5000);
        // P&L percent = (50000 - 45000) / 50000 = 0.1
        expect(result.realizedPnLPercent).toBeCloseTo(0.1, 6);
        expect(result.costBasis).toBe(50000);
        // Full close: position should be undefined
        expect(result.position).toBeUndefined();
      });
    });

    describe('full close with loss (price rose)', () => {
      it('should realize loss when price rose', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 55000 // Price rose from 50000 to 55000
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(1);
        // Raw P&L = (50000 - 55000) * 1 = -5000
        // Margin = 16666.67, raw P&L = -5000, -5000 > -16666.67 so not capped
        expect(result.realizedPnL).toBeCloseTo(-5000, 0);
        // P&L percent = (50000 - 55000) / 50000 = -0.1
        expect(result.realizedPnLPercent).toBeCloseTo(-0.1, 6);
        expect(result.position).toBeUndefined();
      });
    });

    describe('partial close', () => {
      it('should close partial with explicit quantity', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 45000,
          quantity: 0.5
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.5);
        // P&L = (50000 - 45000) * 0.5 = 2500
        expect(result.realizedPnL).toBe(2500);
        // Remaining position
        expect(result.position?.quantity).toBe(0.5);
        expect(result.position?.averagePrice).toBe(50000);
        expect(result.position?.side).toBe('short');
      });

      it('should close partial with percentage', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 45000,
          percentage: 0.25 // 25%
        });

        expect(result.success).toBe(true);
        expect(result.quantity).toBe(0.25);
        expect(result.position?.quantity).toBe(0.75);
      });

      it('should close partial with confidence-based sizing', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 45000,
          confidence: 0.5
        });

        expect(result.success).toBe(true);
        // confidence 0.5: 25% + 0.5 * 75% = 62.5%
        expect(result.quantity).toBeCloseTo(0.625, 3);
        expect(result.position?.quantity).toBeCloseTo(0.375, 3);
      });

      it('should reduce margin proportionally on partial close', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 45000,
          quantity: 0.5
        });

        expect(result.success).toBe(true);
        // Returned margin = 16666.67 * (0.5 / 1) = 8333.335
        expect(result.marginAmount).toBeCloseTo(8333.335, 1);
        // Remaining margin on position
        expect(result.position?.marginAmount).toBeCloseTo(8333.335, 1);
      });
    });

    describe('loss capped at margin', () => {
      it('should cap loss at returned margin (underwater short)', () => {
        // Create a position that has gone deeply underwater
        const underwaterShort: Position = {
          coinId: 'bitcoin',
          quantity: 1,
          averagePrice: 50000,
          totalValue: 5000,
          side: 'short',
          leverage: 10,
          marginAmount: 5000, // (1 * 50000) / 10
          liquidationPrice: 54750
        };

        // Price rose to 60000 => raw P&L = (50000 - 60000) * 1 = -10000
        // But margin is only 5000, so loss is capped at -5000
        const result = service.closeShort(underwaterShort, {
          coinId: 'bitcoin',
          price: 60000
        });

        expect(result.success).toBe(true);
        // Raw P&L = -10000, returnedMargin = 5000
        // cappedPnL = max(-5000, -10000) = -5000
        expect(result.realizedPnL).toBe(-5000);
      });

      it('should not cap loss when within margin', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 52000 // Small loss
        });

        expect(result.success).toBe(true);
        // Raw P&L = (50000 - 52000) * 1 = -2000
        // Returned margin = 16666.67, -2000 > -16666.67, so not capped
        expect(result.realizedPnL).toBeCloseTo(-2000, 0);
      });
    });

    describe('remaining position tracking', () => {
      it('should preserve leverage and liquidationPrice on partial close', () => {
        const result = service.closeShort(shortPosition, {
          coinId: 'bitcoin',
          price: 48000,
          quantity: 0.3
        });

        expect(result.success).toBe(true);
        expect(result.position?.leverage).toBe(3);
        expect(result.position?.liquidationPrice).toBeCloseTo(66416.67, 0);
        expect(result.position?.side).toBe('short');
      });
    });

    describe('validation', () => {
      it('should reject closing non-existent position', () => {
        const emptyPosition: Position = {
          coinId: 'bitcoin',
          quantity: 0,
          averagePrice: 0,
          totalValue: 0,
          side: 'short'
        };

        const result = service.closeShort(emptyPosition, {
          coinId: 'bitcoin',
          price: 45000
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No position');
      });
    });
  });

  describe('isLiquidated', () => {
    describe('short position', () => {
      const shortPos: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 5000,
        side: 'short',
        leverage: 10,
        marginAmount: 5000,
        liquidationPrice: 54750 // 50000 * (1 + 1/10 - 0.005)
      };

      it('should be liquidated when price >= liquidation price', () => {
        expect(service.isLiquidated(shortPos, 55000)).toBe(true);
      });

      it('should be liquidated when price exactly at liquidation price', () => {
        expect(service.isLiquidated(shortPos, 54750)).toBe(true);
      });

      it('should not be liquidated when price below liquidation price', () => {
        expect(service.isLiquidated(shortPos, 54000)).toBe(false);
      });

      it('should not be liquidated when price dropped (profitable)', () => {
        expect(service.isLiquidated(shortPos, 40000)).toBe(false);
      });
    });

    describe('long position with leverage', () => {
      const longPos: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 5000,
        side: 'long',
        leverage: 10,
        marginAmount: 5000,
        liquidationPrice: 45250 // 50000 * (1 - 1/10 + 0.005)
      };

      it('should be liquidated when price <= liquidation price', () => {
        expect(service.isLiquidated(longPos, 45000)).toBe(true);
      });

      it('should be liquidated when price exactly at liquidation price', () => {
        expect(service.isLiquidated(longPos, 45250)).toBe(true);
      });

      it('should not be liquidated when price above liquidation price', () => {
        expect(service.isLiquidated(longPos, 46000)).toBe(false);
      });
    });

    describe('unleveraged positions', () => {
      it('should never liquidate a position with leverage=1', () => {
        const pos: Position = {
          coinId: 'bitcoin',
          quantity: 1,
          averagePrice: 50000,
          totalValue: 50000,
          leverage: 1,
          liquidationPrice: 100
        };

        // Even at a very low price, leverage=1 means no liquidation
        expect(service.isLiquidated(pos, 1)).toBe(false);
      });

      it('should never liquidate a position without leverage', () => {
        const pos: Position = {
          coinId: 'bitcoin',
          quantity: 1,
          averagePrice: 50000,
          totalValue: 50000
        };

        expect(service.isLiquidated(pos, 0)).toBe(false);
      });
    });

    describe('position without liquidationPrice', () => {
      it('should never liquidate when liquidationPrice is undefined', () => {
        const pos: Position = {
          coinId: 'bitcoin',
          quantity: 1,
          averagePrice: 50000,
          totalValue: 5000,
          side: 'short',
          leverage: 10,
          marginAmount: 5000
          // liquidationPrice not set
        };

        expect(service.isLiquidated(pos, 100000)).toBe(false);
      });
    });
  });

  describe('calculateLiquidationPrice', () => {
    describe('long positions', () => {
      it('should calculate liquidation price for 2x long', () => {
        // long: entryPrice * (1 - 1/leverage + 0.005)
        // 50000 * (1 - 1/2 + 0.005) = 50000 * 0.505 = 25250
        const liqPrice = service.calculateLiquidationPrice(50000, 2, 'long');
        expect(liqPrice).toBeCloseTo(25250, 2);
      });

      it('should calculate liquidation price for 5x long', () => {
        // 50000 * (1 - 1/5 + 0.005) = 50000 * 0.805 = 40250
        const liqPrice = service.calculateLiquidationPrice(50000, 5, 'long');
        expect(liqPrice).toBeCloseTo(40250, 2);
      });

      it('should calculate liquidation price for 10x long', () => {
        // 50000 * (1 - 1/10 + 0.005) = 50000 * 0.905 = 45250
        const liqPrice = service.calculateLiquidationPrice(50000, 10, 'long');
        expect(liqPrice).toBeCloseTo(45250, 2);
      });

      it('should produce liquidation price below entry price for long', () => {
        const liqPrice = service.calculateLiquidationPrice(50000, 5, 'long');
        expect(liqPrice).toBeLessThan(50000);
      });
    });

    describe('short positions', () => {
      it('should calculate liquidation price for 2x short', () => {
        // short: entryPrice * (1 + 1/leverage - 0.005)
        // 50000 * (1 + 1/2 - 0.005) = 50000 * 1.495 = 74750
        const liqPrice = service.calculateLiquidationPrice(50000, 2, 'short');
        expect(liqPrice).toBeCloseTo(74750, 2);
      });

      it('should calculate liquidation price for 5x short', () => {
        // 50000 * (1 + 1/5 - 0.005) = 50000 * 1.195 = 59750
        const liqPrice = service.calculateLiquidationPrice(50000, 5, 'short');
        expect(liqPrice).toBeCloseTo(59750, 2);
      });

      it('should calculate liquidation price for 10x short', () => {
        // 50000 * (1 + 1/10 - 0.005) = 50000 * 1.095 = 54750
        const liqPrice = service.calculateLiquidationPrice(50000, 10, 'short');
        expect(liqPrice).toBeCloseTo(54750, 2);
      });

      it('should produce liquidation price above entry price for short', () => {
        const liqPrice = service.calculateLiquidationPrice(50000, 5, 'short');
        expect(liqPrice).toBeGreaterThan(50000);
      });
    });

    describe('symmetry', () => {
      it('long liquidation price should be lower than short liquidation price for same entry', () => {
        const longLiq = service.calculateLiquidationPrice(50000, 5, 'long');
        const shortLiq = service.calculateLiquidationPrice(50000, 5, 'short');

        expect(longLiq).toBeLessThan(shortLiq);
      });

      it('higher leverage should bring liquidation price closer to entry', () => {
        const liq5x = service.calculateLiquidationPrice(50000, 5, 'long');
        const liq10x = service.calculateLiquidationPrice(50000, 10, 'long');

        // 10x long liquidation should be closer to entry (higher) than 5x
        expect(liq10x).toBeGreaterThan(liq5x);
      });
    });
  });

  describe('updatePositionValue with short positions', () => {
    it('should value short position as margin + unrealized P&L (profitable)', () => {
      const shortPos: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 10000,
        side: 'short',
        leverage: 5,
        marginAmount: 10000 // (1 * 50000) / 5
      };

      // Price dropped to 45000 (profitable for short)
      const updated = service.updatePositionValue(shortPos, 45000);

      // value = max(0, 10000 + (50000 - 45000) * 1) = max(0, 15000) = 15000
      expect(updated.totalValue).toBe(15000);
    });

    it('should value short position as margin + unrealized P&L (losing)', () => {
      const shortPos: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 10000,
        side: 'short',
        leverage: 5,
        marginAmount: 10000
      };

      // Price rose to 55000 (losing for short)
      const updated = service.updatePositionValue(shortPos, 55000);

      // value = max(0, 10000 + (50000 - 55000) * 1) = max(0, 5000) = 5000
      expect(updated.totalValue).toBe(5000);
    });

    it('should clamp short position value to 0 when underwater', () => {
      const shortPos: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 10000,
        side: 'short',
        leverage: 5,
        marginAmount: 10000
      };

      // Price rose to 65000 => unrealized loss exceeds margin
      const updated = service.updatePositionValue(shortPos, 65000);

      // value = max(0, 10000 + (50000 - 65000) * 1) = max(0, -5000) = 0
      expect(updated.totalValue).toBe(0);
    });

    it('should not mutate original short position', () => {
      const shortPos: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 10000,
        side: 'short',
        leverage: 5,
        marginAmount: 10000
      };

      const updated = service.updatePositionValue(shortPos, 45000);

      expect(updated).not.toBe(shortPos);
      expect(shortPos.totalValue).toBe(10000);
    });

    it('should preserve all short-specific fields', () => {
      const shortPos: Position = {
        coinId: 'bitcoin',
        quantity: 1,
        averagePrice: 50000,
        totalValue: 10000,
        side: 'short',
        leverage: 5,
        marginAmount: 10000,
        liquidationPrice: 59750
      };

      const updated = service.updatePositionValue(shortPos, 48000);

      expect(updated.side).toBe('short');
      expect(updated.leverage).toBe(5);
      expect(updated.marginAmount).toBe(10000);
      expect(updated.liquidationPrice).toBe(59750);
    });
  });
});
