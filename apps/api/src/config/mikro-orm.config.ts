import { LoadStrategy } from '@mikro-orm/core';
import { EntityGenerator } from '@mikro-orm/entity-generator';
import { Migrator } from '@mikro-orm/migrations-mongodb';
import { MongoHighlighter } from '@mikro-orm/mongo-highlighter';
import { Options } from '@mikro-orm/mongodb';
import { SeedManager } from '@mikro-orm/seeder';
import { Logger } from '@nestjs/common';
const logger = new Logger('MikroORM');

const MikroOrmConfig = {
  autoLoadEntities: true,
  clientUrl: process.env.MONGO_URL,
  dbName: 'Chansey',
  debug: !process.env.production,
  extensions: [Migrator, EntityGenerator, SeedManager],
  highlighter: new MongoHighlighter(),
  loadStrategy: LoadStrategy.JOINED,
  logger: logger.log.bind(logger),
  type: 'mongo',
} as Options;

export default MikroOrmConfig;
