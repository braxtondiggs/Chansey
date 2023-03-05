import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

import { Category } from './category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoryService {
  constructor(@InjectRepository(Category) private readonly category: EntityRepository<Category>) {}

  async getCategories(): Promise<Category[]> {
    return await this.category.findAll();
  }

  async getCategoryById(id: string): Promise<Category> {
    return await this.category.findOne({ id });
  }

  async create(dto: CreateCategoryDto, flush = false): Promise<Category> {
    const category = this.category.create(dto);
    this.category.persist(category);
    if (flush) await this.category.flush();
    return category;
  }

  async createMany(dto: CreateCategoryDto[]): Promise<Category[]> {
    const promise = dto.map((c) => this.create(c));
    const categories = await Promise.all(promise);
    await this.category.flush();
    return categories;
  }
}
