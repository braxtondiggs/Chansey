import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreatePriceDto } from './dto/create-price.dto';
import { Price } from './price.entity';

@Injectable()
export class PriceService {
  constructor(@InjectRepository(Price) private readonly price: Repository<Price>) {}

  async create(Price: CreatePriceDto): Promise<Price> {
    return (await this.price.insert(Price)).generatedMaps[0] as Price;
  }
}
