import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [TypeOrmModule.forFeature([Portfolio])],
  controllers: [PortfolioController],
  providers: [PortfolioService]
})
export class PortfolioModule {}
