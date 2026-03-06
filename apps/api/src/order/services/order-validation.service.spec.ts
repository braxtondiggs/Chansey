import * as ccxt from 'ccxt';

import { OrderValidationService } from './order-validation.service';

import { OrderSizeException } from '../../common/exceptions';

describe('OrderValidationService', () => {
  let service: OrderValidationService;

  beforeEach(() => {
    service = new OrderValidationService();
  });

  describe('validateAlgorithmicOrderSize', () => {
    const buildMarket = (limits: Partial<ccxt.MarketInterface['limits']> = {}): ccxt.MarketInterface =>
      ({
        limits: {
          amount: { min: undefined, max: undefined, ...limits.amount },
          cost: { min: undefined, max: undefined, ...limits.cost },
          price: { min: undefined, max: undefined },
          leverage: { min: undefined, max: undefined }
        }
      }) as unknown as ccxt.MarketInterface;

    it('should throw when quantity is below minimum', () => {
      const market = buildMarket({ amount: { min: 0.01, max: undefined } });
      expect(() => service.validateAlgorithmicOrderSize(0.001, 100, market)).toThrow(OrderSizeException);
    });

    it('should throw when quantity exceeds maximum', () => {
      const market = buildMarket({ amount: { min: undefined, max: 1000 } });
      expect(() => service.validateAlgorithmicOrderSize(1500, 100, market)).toThrow(OrderSizeException);
    });

    it('should throw when notional value is below minimum cost', () => {
      const market = buildMarket({ cost: { min: 10, max: undefined } });
      // 0.05 * 100 = 5, which is below cost min of 10
      expect(() => service.validateAlgorithmicOrderSize(0.05, 100, market)).toThrow(OrderSizeException);
    });

    it('should pass when quantity is exactly at minimum', () => {
      const market = buildMarket({ amount: { min: 0.01, max: undefined } });
      expect(() => service.validateAlgorithmicOrderSize(0.01, 100, market)).not.toThrow();
    });

    it('should pass when quantity is exactly at maximum', () => {
      const market = buildMarket({ amount: { min: undefined, max: 1000 } });
      expect(() => service.validateAlgorithmicOrderSize(1000, 100, market)).not.toThrow();
    });

    it('should skip checks when limits are undefined', () => {
      const market = buildMarket({});
      expect(() => service.validateAlgorithmicOrderSize(0.0001, 0.01, market)).not.toThrow();
    });

    it('should skip checks when limits are 0', () => {
      const market = buildMarket({
        amount: { min: 0, max: 0 },
        cost: { min: 0, max: 0 }
      });
      expect(() => service.validateAlgorithmicOrderSize(0.0001, 0.01, market)).not.toThrow();
    });

    it('should pass for a valid order within all limits', () => {
      const market = buildMarket({
        amount: { min: 0.001, max: 10000 },
        cost: { min: 10, max: undefined }
      });
      // 1 * 50000 = 50000, well above cost min of 10
      expect(() => service.validateAlgorithmicOrderSize(1, 50000, market)).not.toThrow();
    });

    it('should check notional even when quantity limits pass', () => {
      const market = buildMarket({
        amount: { min: 0.0001, max: 10000 },
        cost: { min: 10, max: undefined }
      });
      // quantity 0.001 passes amount min, but 0.001 * 50 = 0.05 fails cost min
      expect(() => service.validateAlgorithmicOrderSize(0.001, 50, market)).toThrow(OrderSizeException);
    });
  });
});
