import { Test, TestingModule } from '@nestjs/testing';
import { TestnetService } from './testnet.service';

describe('TestnetService', () => {
  let service: TestnetService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TestnetService]
    }).compile();

    service = module.get<TestnetService>(TestnetService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
