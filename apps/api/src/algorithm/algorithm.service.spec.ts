import { Test, TestingModule } from '@nestjs/testing';

import { AlgorithmService } from './algorithm.service';

describe('AlgorithmService', () => {
  let service: AlgorithmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlgorithmService]
    }).compile();

    service = module.get<AlgorithmService>(AlgorithmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
