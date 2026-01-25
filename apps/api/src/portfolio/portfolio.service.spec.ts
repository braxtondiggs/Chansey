import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PortfolioType } from './portfolio-type.enum';
import { Portfolio, PortfolioRelations } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { PortfolioNotFoundException } from '../common/exceptions';
import { OHLCService } from '../ohlc/ohlc.service';

describe('PortfolioService', () => {
  let service: PortfolioService;
  let portfolioRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let historicalPriceTask: { addHistoricalPriceJob: jest.Mock };
  let ohlcService: { getCandleCount: jest.Mock };

  const mockUser = { id: 'user-123' };

  beforeEach(async () => {
    portfolioRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn()
    };
    historicalPriceTask = { addHistoricalPriceJob: jest.fn() };
    ohlcService = { getCandleCount: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: getRepositoryToken(Portfolio), useValue: portfolioRepo },
        { provide: PortfolioHistoricalPriceTask, useValue: historicalPriceTask },
        { provide: OHLCService, useValue: ohlcService }
      ]
    }).compile();

    service = module.get(PortfolioService);
  });

  describe('getPortfolioCoins', () => {
    it('returns unique coins from the portfolio list', async () => {
      portfolioRepo.find.mockResolvedValue([
        { id: 'p1', coin: { id: 'btc', symbol: 'BTC' } },
        { id: 'p2', coin: { id: 'eth', symbol: 'ETH' } },
        { id: 'p3', coin: { id: 'btc', symbol: 'BTC' } }
      ]);

      const result = await service.getPortfolioCoins();

      expect(result).toEqual([
        { id: 'btc', symbol: 'BTC' },
        { id: 'eth', symbol: 'ETH' }
      ]);
      expect(portfolioRepo.find).toHaveBeenCalledWith({ relations: ['coin'] });
    });
  });

  describe('getPortfolioById', () => {
    it('throws when portfolio does not exist', async () => {
      portfolioRepo.findOne.mockResolvedValue(null);

      await expect(service.getPortfolioById('portfolio-1', mockUser.id)).rejects.toBeInstanceOf(
        PortfolioNotFoundException
      );
    });

    it('returns portfolio when found', async () => {
      portfolioRepo.findOne.mockResolvedValue({ id: 'portfolio-1' });

      const result = await service.getPortfolioById('portfolio-1', mockUser.id);

      expect(result).toEqual({ id: 'portfolio-1' });
      expect(portfolioRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'portfolio-1', user: { id: mockUser.id } },
        relations: ['coin']
      });
    });
  });

  describe('getPortfolioByUser', () => {
    it('adds type filter when provided', async () => {
      portfolioRepo.find.mockResolvedValue([{ id: 'portfolio-1' }]);

      const result = await service.getPortfolioByUser(mockUser as any, [PortfolioRelations.COIN], PortfolioType.MANUAL);

      expect(result).toEqual([{ id: 'portfolio-1' }]);
      expect(portfolioRepo.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id }, type: PortfolioType.MANUAL },
        relations: ['coin']
      });
    });
  });

  describe('createPortfolioItem', () => {
    it('returns existing portfolio when already present', async () => {
      const existing = { id: 'portfolio-1' };
      portfolioRepo.findOne.mockResolvedValue(existing);

      const result = await service.createPortfolioItem(
        { coinId: 'btc', type: PortfolioType.MANUAL } as any,
        mockUser as any
      );

      expect(result).toBe(existing);
      expect(portfolioRepo.create).not.toHaveBeenCalled();
      expect(portfolioRepo.save).not.toHaveBeenCalled();
    });

    it('queues historical job when enough candles exist', async () => {
      portfolioRepo.findOne.mockResolvedValue(null);
      portfolioRepo.create.mockReturnValue({ id: 'portfolio-1' });
      portfolioRepo.save.mockResolvedValue({ id: 'portfolio-1' });
      ohlcService.getCandleCount.mockResolvedValue(120);

      const result = await service.createPortfolioItem(
        { coinId: 'btc', type: PortfolioType.MANUAL } as any,
        mockUser as any
      );

      expect(result).toEqual({ id: 'portfolio-1' });
      expect(historicalPriceTask.addHistoricalPriceJob).toHaveBeenCalledWith('btc');
    });

    it('does not queue job when not enough candles exist', async () => {
      portfolioRepo.findOne.mockResolvedValue(null);
      portfolioRepo.create.mockReturnValue({ id: 'portfolio-1' });
      portfolioRepo.save.mockResolvedValue({ id: 'portfolio-1' });
      ohlcService.getCandleCount.mockResolvedValue(10);

      await service.createPortfolioItem({ coinId: 'btc', type: PortfolioType.MANUAL } as any, mockUser as any);

      expect(historicalPriceTask.addHistoricalPriceJob).not.toHaveBeenCalled();
    });

    it('does not fail when OHLC lookup throws', async () => {
      portfolioRepo.findOne.mockResolvedValue(null);
      portfolioRepo.create.mockReturnValue({ id: 'portfolio-1' });
      portfolioRepo.save.mockResolvedValue({ id: 'portfolio-1' });
      ohlcService.getCandleCount.mockRejectedValue(new Error('ohlc failed'));

      await expect(
        service.createPortfolioItem({ coinId: 'btc', type: PortfolioType.MANUAL } as any, mockUser as any)
      ).resolves.toEqual({ id: 'portfolio-1' });
    });
  });

  describe('updatePortfolioItem', () => {
    it('updates portfolio item and saves merged data', async () => {
      portfolioRepo.findOne.mockResolvedValue({ id: 'portfolio-1', type: PortfolioType.MANUAL });
      portfolioRepo.save.mockResolvedValue({ id: 'portfolio-1', label: 'Updated' });

      const result = await service.updatePortfolioItem('portfolio-1', mockUser.id, { label: 'Updated' } as any);

      expect(result).toEqual({ id: 'portfolio-1', label: 'Updated' });
      expect(portfolioRepo.save).toHaveBeenCalledWith(expect.objectContaining({ label: 'Updated' }));
    });
  });

  describe('deletePortfolioItem', () => {
    it('throws when delete affects no rows', async () => {
      portfolioRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(service.deletePortfolioItem('portfolio-1', mockUser.id)).rejects.toBeInstanceOf(
        PortfolioNotFoundException
      );
    });

    it('returns delete result when successful', async () => {
      portfolioRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deletePortfolioItem('portfolio-1', mockUser.id);

      expect(result).toEqual({ affected: 1 });
      expect(portfolioRepo.delete).toHaveBeenCalledWith({ id: 'portfolio-1', user: { id: mockUser.id } });
    });
  });
});
