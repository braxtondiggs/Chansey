import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditQueryService } from './audit-query.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

import { CryptoService } from '../common/crypto.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService, AuditQueryService, CryptoService],
  controllers: [AuditController],
  exports: [AuditService, AuditQueryService, CryptoService]
})
export class AuditModule {}
