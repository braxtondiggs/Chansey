import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CoinSelectionType } from './coin-selection-type.enum';
import { CoinSelection, CoinSelectionRelations } from './coin-selection.entity';
import { CoinSelectionService } from './coin-selection.service';
import { CoinSelectionHistoricalPriceTask } from './tasks/coin-selection-historical-price.task';

import { CoinSelectionNotFoundException } from '../common/exceptions';
import { OHLCService } from '../ohlc/ohlc.service';

describe('CoinSelectionService', () => {
  let service: CoinSelectionService;
  let selectionRepo: {
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
    selectionRepo = {
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
        CoinSelectionService,
        { provide: getRepositoryToken(CoinSelection), useValue: selectionRepo },
        { provide: CoinSelectionHistoricalPriceTask, useValue: historicalPriceTask },
        { provide: OHLCService, useValue: ohlcService }
      ]
    }).compile();

    service = module.get(CoinSelectionService);
  });

  describe('getCoinSelectionCoins', () => {
    it('returns unique coins from the selection list', async () => {
      selectionRepo.find.mockResolvedValue([
        { id: 'p1', coin: { id: 'btc', symbol: 'BTC' } },
        { id: 'p2', coin: { id: 'eth', symbol: 'ETH' } },
        { id: 'p3', coin: { id: 'btc', symbol: 'BTC' } }
      ]);

      const result = await service.getCoinSelectionCoins();

      expect(result).toEqual([
        { id: 'btc', symbol: 'BTC' },
        { id: 'eth', symbol: 'ETH' }
      ]);
      expect(selectionRepo.find).toHaveBeenCalledWith({ relations: ['coin'] });
    });
  });

  describe('getCoinSelectionById', () => {
    it('throws when selection does not exist', async () => {
      selectionRepo.findOne.mockResolvedValue(null);

      await expect(service.getCoinSelectionById('selection-1', mockUser.id)).rejects.toBeInstanceOf(
        CoinSelectionNotFoundException
      );
    });

    it('returns selection when found', async () => {
      selectionRepo.findOne.mockResolvedValue({ id: 'selection-1' });

      const result = await service.getCoinSelectionById('selection-1', mockUser.id);

      expect(result).toEqual({ id: 'selection-1' });
      expect(selectionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'selection-1', user: { id: mockUser.id } },
        relations: ['coin']
      });
    });
  });

  describe('getCoinSelectionsByUser', () => {
    it('adds type filter when provided', async () => {
      selectionRepo.find.mockResolvedValue([{ id: 'selection-1' }]);

      const result = await service.getCoinSelectionsByUser(
        mockUser as any,
        [CoinSelectionRelations.COIN],
        CoinSelectionType.MANUAL
      );

      expect(result).toEqual([{ id: 'selection-1' }]);
      expect(selectionRepo.find).toHaveBeenCalledWith({
        where: { user: { id: mockUser.id }, type: CoinSelectionType.MANUAL },
        relations: ['coin'],
        order: { coin: { name: 'ASC' } }
      });
    });
  });

  describe('createCoinSelectionItem', () => {
    it('returns existing selection when already present', async () => {
      const existing = { id: 'selection-1' };
      selectionRepo.findOne.mockResolvedValue(existing);

      const result = await service.createCoinSelectionItem(
        { coinId: 'btc', type: CoinSelectionType.MANUAL } as any,
        mockUser as any
      );

      expect(result).toBe(existing);
      expect(selectionRepo.create).not.toHaveBeenCalled();
      expect(selectionRepo.save).not.toHaveBeenCalled();
    });

    it('queues historical job when enough candles exist', async () => {
      selectionRepo.findOne.mockResolvedValue(null);
      selectionRepo.create.mockReturnValue({ id: 'selection-1' });
      selectionRepo.save.mockResolvedValue({ id: 'selection-1' });
      ohlcService.getCandleCount.mockResolvedValue(120);

      const result = await service.createCoinSelectionItem(
        { coinId: 'btc', type: CoinSelectionType.MANUAL } as any,
        mockUser as any
      );

      expect(result).toEqual({ id: 'selection-1' });
      expect(historicalPriceTask.addHistoricalPriceJob).toHaveBeenCalledWith('btc');
    });

    it('does not queue job when not enough candles exist', async () => {
      selectionRepo.findOne.mockResolvedValue(null);
      selectionRepo.create.mockReturnValue({ id: 'selection-1' });
      selectionRepo.save.mockResolvedValue({ id: 'selection-1' });
      ohlcService.getCandleCount.mockResolvedValue(10);

      await service.createCoinSelectionItem({ coinId: 'btc', type: CoinSelectionType.MANUAL } as any, mockUser as any);

      expect(historicalPriceTask.addHistoricalPriceJob).not.toHaveBeenCalled();
    });

    it('does not fail when OHLC lookup throws', async () => {
      selectionRepo.findOne.mockResolvedValue(null);
      selectionRepo.create.mockReturnValue({ id: 'selection-1' });
      selectionRepo.save.mockResolvedValue({ id: 'selection-1' });
      ohlcService.getCandleCount.mockRejectedValue(new Error('ohlc failed'));

      await expect(
        service.createCoinSelectionItem({ coinId: 'btc', type: CoinSelectionType.MANUAL } as any, mockUser as any)
      ).resolves.toEqual({ id: 'selection-1' });
    });
  });

  describe('updateCoinSelectionItem', () => {
    it('updates selection item and saves merged data', async () => {
      selectionRepo.findOne.mockResolvedValue({ id: 'selection-1', type: CoinSelectionType.MANUAL });
      selectionRepo.save.mockResolvedValue({ id: 'selection-1', label: 'Updated' });

      const result = await service.updateCoinSelectionItem('selection-1', mockUser.id, { label: 'Updated' } as any);

      expect(result).toEqual({ id: 'selection-1', label: 'Updated' });
      expect(selectionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ label: 'Updated' }));
    });
  });

  describe('deleteCoinSelectionItem', () => {
    it('throws when delete affects no rows', async () => {
      selectionRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(service.deleteCoinSelectionItem('selection-1', mockUser.id)).rejects.toBeInstanceOf(
        CoinSelectionNotFoundException
      );
    });

    it('returns delete result when successful', async () => {
      selectionRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteCoinSelectionItem('selection-1', mockUser.id);

      expect(result).toEqual({ affected: 1 });
      expect(selectionRepo.delete).toHaveBeenCalledWith({ id: 'selection-1', user: { id: mockUser.id } });
    });
  });
});
