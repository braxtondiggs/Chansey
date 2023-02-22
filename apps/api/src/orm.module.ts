import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { Coin } from './app/entities/coin.entity';

const logger = new Logger('MikroORM');
const entities = [Coin];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [async () => {
        const client_url = process.env.MONGO_URL;
        return { client_url };
      }],
    }),
    MikroOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        clientUrl: config.get('client_url'),
        dbName: 'Chansey',
        debug: !process.env.production,
        entities,
        logger: logger.log.bind(logger),
        type: 'mongo'
      }),
      inject: [ConfigService]
    }),
    MikroOrmModule.forFeature({ entities })
  ],
  exports: [MikroOrmModule]
})
export class OrmModule {
}
