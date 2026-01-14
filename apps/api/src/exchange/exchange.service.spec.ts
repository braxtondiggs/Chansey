import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { EXCHANGE_KEY_SERVICE } from './interfaces';

import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeNotFoundException } from '../common/exceptions/resource';

describe('ExchangeService', () => {
  let service: ExchangeService;
  let exchangeRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    insert: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let exchangeKeyService: {
    findByExchange: jest.Mock;
  };
  let tickerPairService: {
    getTickerPairsByExchange: jest.Mock;
  };

  beforeEach(async () => {
    exchangeRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      insert: jest.fn(),
      save: jest.fn(),
      delete: jest.fn()
    };
    exchangeKeyService = {
      findByExchange: jest.fn()
    };
    tickerPairService = {
      getTickerPairsByExchange: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeService,
        {
          provide: getRepositoryToken(Exchange),
          useValue: exchangeRepository
        },
        {
          provide: EXCHANGE_KEY_SERVICE,
          useValue: exchangeKeyService
        },
        {
          provide: TickerPairService,
          useValue: tickerPairService
        }
      ]
    }).compile();

    service = module.get<ExchangeService>(ExchangeService);
  });

  it('gets exchanges with supported filtering and removes nulls', async () => {
    exchangeRepository.find.mockResolvedValueOnce([
      { id: '1', name: 'Binance', supported: true, description: null } as Exchange
    ]);

    const result = await service.getExchanges({ supported: true });

    expect(exchangeRepository.find).toHaveBeenCalledWith({
      where: { supported: true },
      order: { name: 'ASC' }
    });
    expect(result[0]).not.toHaveProperty('description');
  });

  it('throws when exchange id is missing', async () => {
    exchangeRepository.findOne.mockResolvedValueOnce(null);

    await expect(service.getExchangeById('missing-id')).rejects.toBeInstanceOf(ExchangeNotFoundException);
  });

  describe('createExchange', () => {
    it('returns existing exchange when name already exists', async () => {
      const existing = { id: '1', name: 'Binance' } as Exchange;
      exchangeRepository.findOne.mockResolvedValueOnce(existing);

      const dto = { name: 'Binance', url: 'https://binance.com', supported: true };
      const result = await service.createExchange(dto);

      expect(exchangeRepository.insert).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('inserts and returns generated exchange when name is new', async () => {
      exchangeRepository.findOne.mockResolvedValueOnce(null);
      exchangeRepository.insert.mockResolvedValueOnce({ generatedMaps: [{ id: 'new-id' }] });

      const dto = { name: 'Kraken', url: 'https://kraken.com', supported: true };
      const result = await service.createExchange(dto);

      expect(exchangeRepository.insert).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'new-id' });
    });
  });

  describe('deleteExchange', () => {
    it('throws when delete affects no rows', async () => {
      exchangeRepository.delete.mockResolvedValueOnce({ affected: 0 });

      await expect(service.deleteExchange('missing-id')).rejects.toBeInstanceOf(ExchangeNotFoundException);
    });

    it('returns delete response when successful', async () => {
      const response = { affected: 1 };
      exchangeRepository.delete.mockResolvedValueOnce(response);

      const result = await service.deleteExchange('existing-id');

      expect(result).toBe(response);
    });
  });

  it('maps ticker pairs into response format', async () => {
    const exchangeId = 'exchange-1';
    const lastTraded = new Date('2024-01-01T00:00:00.000Z');
    const fetchAt = new Date('2024-01-02T00:00:00.000Z');

    jest.spyOn(service, 'getExchangeById').mockResolvedValueOnce({ id: exchangeId } as Exchange);
    tickerPairService.getTickerPairsByExchange.mockResolvedValueOnce([
      {
        baseAsset: null,
        baseAssetSymbol: 'USD',
        quoteAsset: {
          id: 'btc-id',
          name: 'Bitcoin',
          symbol: 'BTC',
          slug: 'bitcoin'
        },
        quoteAssetSymbol: 'BTC',
        volume: 10,
        tradeUrl: 'https://trade.example.com',
        spreadPercentage: 0.1,
        lastTraded,
        status: 'active',
        isSpotTradingAllowed: true,
        isMarginTradingAllowed: false,
        isFiatPair: true,
        fetchAt
      }
    ]);

    const result = await service.getExchangeTickers(exchangeId);

    expect(service.getExchangeById).toHaveBeenCalledWith(exchangeId);
    expect(tickerPairService.getTickerPairsByExchange).toHaveBeenCalledWith(exchangeId);
    expect(result).toEqual([
      {
        symbol: 'USD/BTC',
        base: 'USD',
        quote: 'BTC',
        baseAsset: {
          id: null,
          name: 'USD',
          symbol: 'USD',
          slug: 'USD'
        },
        quoteAsset: {
          id: 'btc-id',
          name: 'Bitcoin',
          symbol: 'BTC',
          slug: 'bitcoin'
        },
        volume: 10,
        tradeUrl: 'https://trade.example.com',
        spreadPercentage: 0.1,
        lastTraded,
        status: 'active',
        isSpotTradingAllowed: true,
        isMarginTradingAllowed: false,
        isFiatPair: true,
        fetchAt,
        currentPrice: null
      }
    ]);
  });

  it('filters exchanges to ones with active user keys', async () => {
    const exchanges = [{ id: 'one', supported: true } as Exchange, { id: 'two', supported: true } as Exchange];

    jest.spyOn(service, 'getExchanges').mockResolvedValueOnce(exchanges);
    exchangeKeyService.findByExchange.mockResolvedValueOnce([{ isActive: true }]);
    exchangeKeyService.findByExchange.mockResolvedValueOnce([{ isActive: false }]);

    const result = await service.findAllWithUserKeys('user-1');

    expect(exchangeKeyService.findByExchange).toHaveBeenCalledWith('one', 'user-1');
    expect(exchangeKeyService.findByExchange).toHaveBeenCalledWith('two', 'user-1');
    expect(result).toEqual([exchanges[0]]);
  });
});
