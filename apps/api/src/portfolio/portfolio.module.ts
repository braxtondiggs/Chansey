import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PortfolioCoinsController } from './portfolio.coins.controller';
import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [TypeOrmModule.forFeature([Portfolio])],
  controllers: [PortfolioController, PortfolioCoinsController],
  providers: [PortfolioService],
  exports: [PortfolioService]
})
export class PortfolioModule {}
