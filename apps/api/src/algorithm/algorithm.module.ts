import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlgorithmController } from './algorithm.controller';
import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';

@Module({
  imports: [TypeOrmModule.forFeature([Algorithm])],
  controllers: [AlgorithmController],
  providers: [AlgorithmService]
})
export class AlgorithmModule {}
