import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DataSource } from 'typeorm';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppModule } from '../../../app.module';
import { MarketDataSet, MarketDataSource, MarketDataTimeframe } from '../market-data-set.entity';

interface ImportDefinition {
  label: string;
  source: MarketDataSource;
  instrumentUniverse: string[];
  timeframe: MarketDataTimeframe;
  startAt: string;
  endAt: string;
  integrityScore?: number;
  checksum?: string;
  storageLocation: string;
  replayCapable?: boolean;
  metadata?: Record<string, unknown>;
  dataFile?: string;
}

const logger = new Logger('MarketDataImport');

function parseArgs(): Record<string, string> {
  return process.argv.slice(2).reduce<Record<string, string>>((acc, arg) => {
    const [key, value] = arg.split('=');
    if (key.startsWith('--') && value) {
      acc[key.replace(/^--/, '')] = value;
    }
    return acc;
  }, {});
}

function ensureChecksum(definition: ImportDefinition): string {
  if (definition.checksum) {
    return definition.checksum;
  }

  if (!definition.dataFile) {
    throw new Error(`Dataset "${definition.label}" missing checksum and dataFile reference`);
  }

  const absolute = resolve(definition.dataFile);
  if (!existsSync(absolute)) {
    throw new Error(`Unable to locate dataset file at ${absolute}`);
  }

  const contents = readFileSync(absolute);
  return createHash('sha256').update(contents).digest('hex');
}

async function bootstrap(): Promise<void> {
  const args = parseArgs();
  const filePath = args.file;

  if (!filePath) {
    throw new Error('Usage: nx run api:seed-backtest-datasets --file=path/to/datasets.json');
  }

  const absolute = resolve(filePath);
  if (!existsSync(absolute)) {
    throw new Error(`Dataset definition file not found at ${absolute}`);
  }

  const payload = JSON.parse(readFileSync(absolute, 'utf-8')) as ImportDefinition[] | { datasets: ImportDefinition[] };
  const definitions = Array.isArray(payload) ? payload : payload.datasets;

  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error('Dataset definition file must contain a non-empty array');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);
  const repository = dataSource.getRepository(MarketDataSet);

  let created = 0;
  let skipped = 0;

  for (const definition of definitions) {
    const checksum = ensureChecksum(definition);

    const existing = await repository.findOne({ where: { checksum } });
    if (existing) {
      logger.log(`Skipping dataset "${definition.label}" (checksum already present)`);
      skipped += 1;
      continue;
    }

    const entity = repository.create({
      label: definition.label,
      source: definition.source,
      instrumentUniverse: definition.instrumentUniverse,
      timeframe: definition.timeframe,
      startAt: new Date(definition.startAt),
      endAt: new Date(definition.endAt),
      integrityScore: definition.integrityScore ?? 100,
      checksum,
      storageLocation: definition.storageLocation,
      replayCapable: definition.replayCapable ?? false,
      metadata: definition.metadata ?? {}
    });

    await repository.save(entity);
    logger.log(`Imported dataset "${definition.label}" (${entity.id})`);
    created += 1;
  }

  logger.log(`Market data import complete. created=${created}, skipped=${skipped}`);
  await app.close();
}

bootstrap()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(error?.message ?? error);
    process.exit(1);
  });
