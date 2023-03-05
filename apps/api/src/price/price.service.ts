import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

import { CreatePriceDto } from './dto/create-price.dto';
import { Price } from './price.entity';

@Injectable()
export class PriceService {
  constructor(@InjectRepository(Price) private readonly price: EntityRepository<Price>) {}

  async create(dto: CreatePriceDto, flush = false): Promise<Price> {
    const price = this.price.create(dto);
    this.price.persist(price);
    if (flush) await this.price.flush();
    return price;
  }

  async createMany(dto: CreatePriceDto[]): Promise<Price[]> {
    const promise = dto.map((c) => this.create(c));
    const prices = await Promise.all(promise);
    await this.price.flush();
    return prices;
  }
}
