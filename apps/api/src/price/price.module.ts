import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppModule } from '../app.module';
import { Price } from './price.entity';
import { PriceService } from './price.service';
import { PriceTaskService } from './price.task';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { HealthCheckHelper } from '../utils/health-check.helper';

@Module({
  imports: [forwardRef(() => AppModule), TypeOrmModule.forFeature([Price, Portfolio])],
  providers: [HealthCheckHelper, PriceService, PriceTaskService, PortfolioService],
  exports: [PriceService]
})
export class PriceModule {}
