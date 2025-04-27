import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RiskController } from './risk.controller';
import { Risk } from './risk.entity';
import { RiskService } from './risk.service';

@Module({
  imports: [TypeOrmModule.forFeature([Risk])],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService]
})
export class RiskModule {}
