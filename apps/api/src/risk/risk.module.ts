import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RiskController } from './risk.controller';
import { Risk } from './risk.entity';
import { RiskService } from './risk.service';

import { SharedCacheModule } from '../shared-cache.module';

@Module({
  imports: [TypeOrmModule.forFeature([Risk]), SharedCacheModule],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService]
})
export class RiskModule {}
