import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [MikroOrmModule.forFeature({ entities: [Portfolio] })],
  controllers: [PortfolioController],
  providers: [PortfolioService]
})
export class PortfolioModule {}
