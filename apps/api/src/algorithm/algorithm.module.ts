import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlgorithmController } from './algorithm.controller';
import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import * as DynamicAlgorithmServices from './scripts';

@Module({
  imports: [TypeOrmModule.forFeature([Algorithm])],
  controllers: [AlgorithmController],
  providers: [AlgorithmService, ...Object.values(DynamicAlgorithmServices)]
})
export class AlgorithmModule implements OnApplicationBootstrap {
  constructor(private readonly algorithm: AlgorithmService, private readonly moduleRef: ModuleRef) {}

  async onApplicationBootstrap() {
    const algorithms = await this.algorithm.getAlgorithmsForTesting();
    for (const cls of Object.values(DynamicAlgorithmServices)) {
      const provider = this.moduleRef.get(cls, { strict: false });
      const algorithm = algorithms.find((algorithm) => algorithm.id === provider.id && algorithm.status);
      if (provider && algorithm) await provider.onInit(algorithm);
    }
  }
}
