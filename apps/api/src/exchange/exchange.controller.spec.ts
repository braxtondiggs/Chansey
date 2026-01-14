import { Test, TestingModule } from '@nestjs/testing';

import { ExchangeController } from './exchange.controller';
import { ExchangeService } from './exchange.service';

describe('ExchangeController', () => {
  let controller: ExchangeController;
  let exchangeService: {
    getExchanges: jest.Mock;
    getExchangeById: jest.Mock;
    getExchangeTickers: jest.Mock;
    createExchange: jest.Mock;
    updateExchange: jest.Mock;
    deleteExchange: jest.Mock;
  };

  beforeEach(async () => {
    exchangeService = {
      getExchanges: jest.fn(),
      getExchangeById: jest.fn(),
      getExchangeTickers: jest.fn(),
      createExchange: jest.fn(),
      updateExchange: jest.fn(),
      deleteExchange: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExchangeController],
      providers: [{ provide: ExchangeService, useValue: exchangeService }]
    }).compile();

    controller = module.get<ExchangeController>(ExchangeController);
  });

  describe('getExchanges', () => {
    it.each([
      ['true', true],
      ['false', false],
      [undefined, undefined],
      ['maybe', undefined]
    ])('passes supported=%s as %s', async (supported, expected) => {
      exchangeService.getExchanges.mockResolvedValueOnce([]);

      await controller.getExchanges(supported);

      expect(exchangeService.getExchanges).toHaveBeenCalledWith({ supported: expected });
    });
  });

  it('gets exchange by id', () => {
    const id = 'a3bb189e-8bf9-3888-9912-ace4e6543002';

    controller.getExchangeById(id);

    expect(exchangeService.getExchangeById).toHaveBeenCalledWith(id);
  });

  it('gets exchange tickers by id', () => {
    const id = 'a3bb189e-8bf9-3888-9912-ace4e6543002';

    controller.getExchangeTickers(id);

    expect(exchangeService.getExchangeTickers).toHaveBeenCalledWith(id);
  });

  it('creates exchange', async () => {
    const dto = { name: 'Binance', supported: true, url: 'https://binance.com' };

    await controller.createExchangeItem(dto);

    expect(exchangeService.createExchange).toHaveBeenCalledWith(dto);
  });

  it('updates exchange', async () => {
    const id = 'a3bb189e-8bf9-3888-9912-ace4e6543002';
    const dto = { name: 'Kraken', supported: false };

    await controller.updateExchangeItem(id, dto);

    expect(exchangeService.updateExchange).toHaveBeenCalledWith(id, dto);
  });

  it('deletes exchange', async () => {
    const id = 'a3bb189e-8bf9-3888-9912-ace4e6543002';

    await controller.deleteExchangeItem(id);

    expect(exchangeService.deleteExchange).toHaveBeenCalledWith(id);
  });
});
