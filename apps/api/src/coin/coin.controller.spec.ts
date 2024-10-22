import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

describe('CoinController', () => {
  let controller: CoinController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoinController],
      providers: [
        CoinService,
        {
          provide: getRepositoryToken(Coin),
          useValue: {
            find: jest.fn(() => []),
            findOne: jest.fn(() => ({})),
            save: jest.fn(() => ({})),
            update: jest.fn(() => ({})),
            delete: jest.fn(() => ({}))
          }
        }
      ]
    }).compile();

    controller = module.get<CoinController>(CoinController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
