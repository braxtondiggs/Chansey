import { getQueueToken } from '@nestjs/bullmq';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ExchangeKey } from './exchange-key.entity';
import { ExchangeKeyService } from './exchange-key.service';

import { User } from '../../users/users.entity';
import { ExchangeManagerService } from '../exchange-manager.service';
import { ExchangeService } from '../exchange.service';

describe('ExchangeKeyService', () => {
  let service: ExchangeKeyService;
  let exchangeKeyRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    remove: jest.Mock;
  };
  let userRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let exchangeService: {
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    exchangeKeyRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      remove: jest.fn()
    };
    userRepository = {
      findOne: jest.fn(),
      save: jest.fn()
    };
    exchangeService = {
      findOne: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeKeyService,
        { provide: getRepositoryToken(ExchangeKey), useValue: exchangeKeyRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: ExchangeService, useValue: exchangeService },
        { provide: ExchangeManagerService, useValue: { getExchangeService: jest.fn() } },
        { provide: getQueueToken('order-queue'), useValue: { add: jest.fn() } }
      ]
    }).compile();

    service = module.get(ExchangeKeyService);
  });

  describe('create', () => {
    it('auto-enables algo trading when a valid key is created', async () => {
      const userId = 'user-1';
      const dto = { exchangeId: 'exchange-1', apiKey: 'api', secretKey: 'secret' } as any;
      const createdKey = { id: 'key-1', exchangeId: dto.exchangeId, userId } as ExchangeKey;
      const savedKey = { ...createdKey, isActive: true } as ExchangeKey;

      exchangeService.findOne.mockResolvedValue({ id: dto.exchangeId, name: 'Binance', slug: 'binance' });
      jest.spyOn(service, 'findOneByExchangeId').mockResolvedValue(null);
      jest.spyOn(service, 'validateExchangeKeys').mockResolvedValue(true);
      exchangeKeyRepository.create.mockReturnValue(createdKey);
      exchangeKeyRepository.save.mockResolvedValue(savedKey);
      const autoEnableSpy = jest.spyOn(service as any, 'autoEnableAlgoTrading').mockResolvedValue(undefined);

      const result = await service.create(userId, dto);

      expect(exchangeService.findOne).toHaveBeenCalledWith(dto.exchangeId);
      expect(exchangeKeyRepository.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
      expect(autoEnableSpy).toHaveBeenCalledWith(userId);
      expect(result).toBe(savedKey);
    });

    it('does not auto-enable algo trading when validation fails', async () => {
      const userId = 'user-1';
      const dto = { exchangeId: 'exchange-1', apiKey: 'api', secretKey: 'secret' } as any;
      const createdKey = { id: 'key-1', exchangeId: dto.exchangeId, userId } as ExchangeKey;
      const savedKey = { ...createdKey, isActive: false } as ExchangeKey;

      exchangeService.findOne.mockResolvedValue({ id: dto.exchangeId, name: 'Binance', slug: 'binance' });
      jest.spyOn(service, 'findOneByExchangeId').mockResolvedValue(null);
      jest.spyOn(service, 'validateExchangeKeys').mockResolvedValue(false);
      exchangeKeyRepository.create.mockReturnValue(createdKey);
      exchangeKeyRepository.save.mockResolvedValue(savedKey);
      const autoEnableSpy = jest.spyOn(service as any, 'autoEnableAlgoTrading').mockResolvedValue(undefined);

      const result = await service.create(userId, dto);

      expect(exchangeKeyRepository.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
      expect(autoEnableSpy).not.toHaveBeenCalled();
      expect(result).toBe(savedKey);
    });

    it('throws when key already exists for exchange', async () => {
      const userId = 'user-1';
      const dto = { exchangeId: 'exchange-1', apiKey: 'api', secretKey: 'secret' } as any;

      exchangeService.findOne.mockResolvedValue({ id: dto.exchangeId, name: 'Binance', slug: 'binance' });
      jest.spyOn(service, 'findOneByExchangeId').mockResolvedValue({ id: 'existing-key' } as ExchangeKey);

      await expect(service.create(userId, dto)).rejects.toBeInstanceOf(ConflictException);
      expect(exchangeKeyRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('auto-disables algo trading when last key is removed', async () => {
      const userId = 'user-1';
      const exchangeKey = { id: 'key-1' } as ExchangeKey;

      jest.spyOn(service, 'findOne').mockResolvedValue(exchangeKey);
      exchangeKeyRepository.count.mockResolvedValue(1);
      exchangeKeyRepository.remove.mockResolvedValue(exchangeKey);
      const autoDisableSpy = jest.spyOn(service as any, 'autoDisableAlgoTrading').mockResolvedValue(undefined);

      const result = await service.remove(exchangeKey.id, userId);

      expect(exchangeKeyRepository.count).toHaveBeenCalledWith({ where: { userId } });
      expect(autoDisableSpy).toHaveBeenCalledWith(userId);
      expect(result).toBe(exchangeKey);
    });

    it('does not auto-disable algo trading when more keys remain', async () => {
      const userId = 'user-1';
      const exchangeKey = { id: 'key-1' } as ExchangeKey;

      jest.spyOn(service, 'findOne').mockResolvedValue(exchangeKey);
      exchangeKeyRepository.count.mockResolvedValue(2);
      exchangeKeyRepository.remove.mockResolvedValue(exchangeKey);
      const autoDisableSpy = jest.spyOn(service as any, 'autoDisableAlgoTrading').mockResolvedValue(undefined);

      await service.remove(exchangeKey.id, userId);

      expect(autoDisableSpy).not.toHaveBeenCalled();
    });
  });
});
