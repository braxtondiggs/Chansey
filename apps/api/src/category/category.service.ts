import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { Category } from './category.entity';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/';

@Injectable()
export class CategoryService {
  constructor(@InjectRepository(Category) private readonly category: Repository<Category>) {}

  async getCategories(): Promise<Category[]> {
    return await this.category.find();
  }

  async getCategoryById(categoryId: string): Promise<Category> {
    return await this.category.findOneBy({ id: categoryId });
  }

  async create(Category: CreateCategoryDto): Promise<Category> {
    const category = await this.category.findOne({ where: { name: ILike(`%${Category.name}%`) } });
    return category ?? ((await this.category.insert(Category)).generatedMaps[0] as Category);
  }

  async update(Category: UpdateCategoryDto) {
    return await this.category.save(Category);
  }

  async remove(categoryId: string) {
    return await this.category.delete(categoryId);
  }
}
