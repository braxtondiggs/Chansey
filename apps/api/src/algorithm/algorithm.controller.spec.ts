import { Test, TestingModule } from '@nestjs/testing';

import { AlgorithmController } from './algorithm.controller';

describe('AlgorithmController', () => {
  let controller: AlgorithmController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlgorithmController]
    }).compile();

    controller = module.get<AlgorithmController>(AlgorithmController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
