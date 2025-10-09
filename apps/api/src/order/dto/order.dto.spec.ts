import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';

import { OrderDto } from './order.dto';

import { OrderSide, OrderType } from '../order.entity';

describe('OrderDto', () => {
  describe('validation', () => {
    it('should validate a valid market buy order', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(0);
    });

    it('should validate a valid limit order with price', async () => {
      const orderData = {
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quoteCoinId: '1e8a03ab-07fe-4c8a-9b5a-50fdfeb9828f',
        quantity: '0.5',
        price: '50000.00'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(0);
    });

    it('should fail validation for missing side', async () => {
      const orderData = {
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('side');
      expect(errors[0].constraints).toHaveProperty('isNotEmpty');
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('should fail validation for invalid side', async () => {
      const orderData = {
        side: 'INVALID_SIDE',
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('side');
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('should fail validation for missing type', async () => {
      const orderData = {
        side: OrderSide.BUY,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('type');
      expect(errors[0].constraints).toHaveProperty('isNotEmpty');
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('should fail validation for invalid type', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: 'INVALID_TYPE',
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('type');
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('should fail validation for missing baseCoinId', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('baseCoinId');
      expect(errors[0].constraints).toHaveProperty('isNotEmpty');
      expect(errors[0].constraints).toHaveProperty('isUuid');
    });

    it('should fail validation for invalid baseCoinId UUID', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'invalid-uuid',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('baseCoinId');
      expect(errors[0].constraints).toHaveProperty('isUuid');
    });

    it('should fail validation for invalid quoteCoinId UUID', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quoteCoinId: 'invalid-uuid',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('quoteCoinId');
      expect(errors[0].constraints).toHaveProperty('isUuid');
    });

    it('should fail validation for missing exchangeId', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('exchangeId');
      expect(errors[0].constraints).toHaveProperty('isNotEmpty');
      expect(errors[0].constraints).toHaveProperty('isString');
    });

    it('should fail validation for missing quantity', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('quantity');
      expect(errors[0].constraints).toHaveProperty('isNotEmpty');
      expect(errors[0].constraints).toHaveProperty('isNumberString');
    });

    it('should fail validation for quantity below minimum', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.000001' // Below minimum of 0.00001
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('quantity');
      expect(errors[0].constraints).toHaveProperty('minStringNumber');
    });

    it('should fail validation for non-numeric quantity', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: 'not-a-number'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('quantity');
      expect(errors[0].constraints).toHaveProperty('isNumberString');
    });

    it('should require price for LIMIT orders', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
        // Missing price for LIMIT order
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('price');
      expect(errors[0].constraints).toHaveProperty('isNotEmpty');
    });

    it('should fail validation for non-numeric price', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1',
        price: 'not-a-number'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('price');
      expect(errors[0].constraints).toHaveProperty('isNumberString');
    });

    it('should allow MARKET orders without price', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.1'
        // No price needed for MARKET order
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(0);
    });

    it('should accept valid quoteCoinId', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quoteCoinId: '1e8a03ab-07fe-4c8a-9b5a-50fdfeb9828f',
        quantity: '0.1'
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(0);
    });

    it('should accept minimum valid quantity', async () => {
      const orderData = {
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        exchangeId: 'binance_us',
        baseCoinId: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
        quantity: '0.00001' // Minimum allowed
      };

      const orderDto = plainToClass(OrderDto, orderData);
      const errors = await validate(orderDto);

      expect(errors).toHaveLength(0);
    });
  });
});
