import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { ILike, In, Repository } from 'typeorm';

import { Category } from './category.entity';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/';

import { NotFoundCustomException } from '../utils/filters/not-found.exception';

@Injectable()
export class CategoryService {
  constructor(@InjectRepository(Category) private readonly category: Repository<Category>) {}

  async getCategories(): Promise<Category[]> {
    return await this.category.find();
  }

  async getCategoryById(categoryId: string): Promise<Category> {
    const category = await this.category.findOneBy({ id: categoryId });
    if (!category) throw new NotFoundCustomException('Category', { id: categoryId });
    return category;
  }

  async create(Category: CreateCategoryDto): Promise<Category> {
    const category = await this.category.findOne({ where: { name: ILike(`%${Category.name}%`) } });
    return category ?? ((await this.category.insert(Category)).generatedMaps[0] as Category);
  }

  async createMany(categories: CreateCategoryDto[]): Promise<Category[]> {
    const existingCategories = await this.category.find({
      where: categories.map((cat) => ({ slug: cat.slug }))
    });

    const newCategories = categories.filter(
      (cat) => !existingCategories.find((existing) => existing.slug === cat.slug)
    );

    if (newCategories.length === 0) return [];

    const result = await this.category.insert(newCategories);
    return result.generatedMaps as Category[];
  }

  async update(categoryId: string, category: UpdateCategoryDto) {
    const data = await this.getCategoryById(categoryId);
    if (!data) throw new NotFoundCustomException('Category', { id: categoryId });
    return await this.category.save(new Category({ ...data, ...category }));
  }

  async remove(categoryId: string) {
    const response = await this.category.delete(categoryId);
    if (!response.affected) throw new NotFoundCustomException('Category', { id: categoryId });
    return response;
  }

  async removeMany(categoryIds: string[]): Promise<void> {
    await this.category.delete({ id: In(categoryIds) });
  }
}
