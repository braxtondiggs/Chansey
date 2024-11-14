import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';

import { CategoryService } from '../category/category.service';

@Injectable()
export class CategoryTask {
  private readonly logger = new Logger(CategoryTask.name);

  constructor(private readonly category: CategoryService, private readonly http: HttpService) {}

  @Cron(CronExpression.EVERY_WEEK)
  async syncCategories() {
    try {
      this.logger.log('Starting Category Sync');
      const [{ data: apiCategories }, existingCategories] = await Promise.all([
        firstValueFrom(this.http.get('https://api.coingecko.com/api/v3/coins/categories/list')) as Promise<any>,
        this.category.getCategories()
      ]);

      const newCategories = apiCategories
        .map((c) => ({ slug: c.category_id, name: c.name }))
        .filter((category) => !existingCategories.find((existing) => existing.slug === category.slug));

      const missingCategories = existingCategories
        .filter((existing) => !apiCategories.find((api) => api.category_id === existing.slug))
        .map((category) => category.id);

      if (newCategories.length > 0) {
        await this.category.createMany(newCategories);
        this.logger.log(`Added categories: ${newCategories.map(({ name }) => name).join(', ')}`);
      }

      if (missingCategories.length > 0) {
        await this.category.removeMany(missingCategories);
        this.logger.log(`Removed ${missingCategories.length} obsolete categories`);
      }
    } catch (e) {
      this.logger.error('Category sync failed:', e);
    } finally {
      this.logger.log('Category Sync Complete');
    }
  }
}
