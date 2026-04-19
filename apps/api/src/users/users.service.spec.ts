import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { User } from './users.entity';
import { UsersService } from './users.service';

import { ActivePositionGuardService } from '../active-position-guard';
import { CoinService } from '../coin/coin.service';
import { CoinSelectionService } from '../coin-selection/coin-selection.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { Risk } from '../risk/risk.entity';
import { RiskPoolMappingService } from '../strategy/risk-pool-mapping.service';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: { findOne: jest.Mock };
  let exchangeKeyService: { getSupportedExchangeKeys: jest.Mock };

  beforeEach(async () => {
    userRepository = { findOne: jest.fn() };
    exchangeKeyService = { getSupportedExchangeKeys: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Risk), useValue: { findOne: jest.fn() } },
        { provide: CoinSelectionService, useValue: {} },
        { provide: CoinService, useValue: {} },
        { provide: ExchangeKeyService, useValue: exchangeKeyService },
        { provide: RiskPoolMappingService, useValue: {} },
        { provide: ActivePositionGuardService, useValue: {} }
      ]
    }).compile();

    service = module.get(UsersService);
  });

  describe('getById', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getById('missing-id')).rejects.toThrow(NotFoundException);
      expect(exchangeKeyService.getSupportedExchangeKeys).not.toHaveBeenCalled();
    });

    it('returns the user merged with their supported exchanges when found', async () => {
      const user = { id: 'user-1', email: 'test@test.com' } as User;
      const exchanges = [{ id: 'key-1', exchangeId: 'ex-1', slug: 'binance_us', name: 'Binance US', isActive: true }];
      userRepository.findOne.mockResolvedValue(user);
      exchangeKeyService.getSupportedExchangeKeys.mockResolvedValue(exchanges);

      const result = await service.getById(user.id);

      expect(result).toEqual({ ...user, exchanges });
      expect(exchangeKeyService.getSupportedExchangeKeys).toHaveBeenCalledWith(user.id);
    });

    it('propagates errors from getSupportedExchangeKeys without masking them as NotFoundException', async () => {
      const user = { id: 'user-1' } as User;
      userRepository.findOne.mockResolvedValue(user);
      const dbError = new Error('connection terminated unexpectedly');
      exchangeKeyService.getSupportedExchangeKeys.mockRejectedValue(dbError);

      await expect(service.getById(user.id)).rejects.toBe(dbError);
    });
  });
});
