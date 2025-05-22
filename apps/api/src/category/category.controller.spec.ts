import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CategoryController } from './category.controller';
import { Category } from './category.entity';
import { CategoryService } from './category.service';

describe('CategoryController', () => {
  let controller: CategoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [
        CategoryService,
        {
          provide: getRepositoryToken(Category),
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            remove: jest.fn().mockResolvedValue({})
          }
        },
        {
          provide: 'BullQueue_category-queue',
          useValue: {
            add: jest.fn(),
            getRepeatableJobs: jest.fn()
            // Add other methods as needed for your tests
          }
        }
      ]
    }).compile();

    controller = module.get<CategoryController>(CategoryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
