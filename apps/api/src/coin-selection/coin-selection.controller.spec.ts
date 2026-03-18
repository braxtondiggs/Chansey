import { Test, TestingModule } from '@nestjs/testing';

import { CoinSelectionType } from './coin-selection-type.enum';
import { CoinSelectionController } from './coin-selection.controller';
import { CoinSelectionRelations } from './coin-selection.entity';
import { CoinSelectionService } from './coin-selection.service';

describe('CoinSelectionController', () => {
  let controller: CoinSelectionController;
  let service: jest.Mocked<CoinSelectionService>;

  const mockUser = { id: 'user-123', email: 'test@example.com' } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoinSelectionController],
      providers: [
        {
          provide: CoinSelectionService,
          useValue: {
            getCoinSelectionsByUser: jest.fn(),
            getCoinSelectionById: jest.fn(),
            createCoinSelectionItem: jest.fn(),
            updateCoinSelectionItem: jest.fn(),
            deleteCoinSelectionItem: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get<CoinSelectionController>(CoinSelectionController);
    service = module.get(CoinSelectionService) as jest.Mocked<CoinSelectionService>;
  });

  describe('getCoinSelections', () => {
    it('passes type filter and undefined coinId to service', async () => {
      service.getCoinSelectionsByUser.mockResolvedValue([{ id: 's-1' }] as any);

      const result = await controller.getCoinSelections(mockUser, CoinSelectionType.MANUAL);

      expect(result).toEqual([{ id: 's-1' }]);
      expect(service.getCoinSelectionsByUser).toHaveBeenCalledWith(
        mockUser,
        [CoinSelectionRelations.COIN],
        CoinSelectionType.MANUAL
      );
    });

    it('passes undefined type when no filter provided', async () => {
      service.getCoinSelectionsByUser.mockResolvedValue([]);

      await controller.getCoinSelections(mockUser);

      expect(service.getCoinSelectionsByUser).toHaveBeenCalledWith(mockUser, [CoinSelectionRelations.COIN], undefined);
    });
  });

  describe('getCoinSelectionById', () => {
    it('extracts user.id for service call', async () => {
      service.getCoinSelectionById.mockResolvedValue({ id: 's-1' } as any);

      const result = await controller.getCoinSelectionById('s-1', mockUser);

      expect(result).toEqual({ id: 's-1' });
      expect(service.getCoinSelectionById).toHaveBeenCalledWith('s-1', 'user-123');
    });
  });

  describe('createCoinSelectionItem', () => {
    it('passes dto and full user object to service', async () => {
      const dto = { label: 'My Coins' } as any;
      service.createCoinSelectionItem.mockResolvedValue({ id: 's-1' } as any);

      const result = await controller.createCoinSelectionItem(dto, mockUser);

      expect(result).toEqual({ id: 's-1' });
      expect(service.createCoinSelectionItem).toHaveBeenCalledWith(dto, mockUser);
    });
  });

  describe('updateCoinSelectionItem', () => {
    it('passes id, user.id, and dto to service', async () => {
      const dto = { label: 'Updated' } as any;
      service.updateCoinSelectionItem.mockResolvedValue({ id: 's-1', label: 'Updated' } as any);

      const result = await controller.updateCoinSelectionItem('s-1', dto, mockUser);

      expect(result).toEqual({ id: 's-1', label: 'Updated' });
      expect(service.updateCoinSelectionItem).toHaveBeenCalledWith('s-1', 'user-123', dto);
    });
  });

  describe('deleteCoinSelectionItem', () => {
    it('passes id and user.id to service', async () => {
      service.deleteCoinSelectionItem.mockResolvedValue({ success: true } as any);

      const result = await controller.deleteCoinSelectionItem('s-1', mockUser);

      expect(result).toEqual({ success: true });
      expect(service.deleteCoinSelectionItem).toHaveBeenCalledWith('s-1', 'user-123');
    });
  });
});
