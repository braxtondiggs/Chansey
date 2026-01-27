import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

import { DatasetValidatorService } from './dataset-validator.service';
import { MarketDataSet } from './market-data-set.entity';

describe('DatasetValidatorService', () => {
  let service: DatasetValidatorService;

  const baseDataset = (overrides: Partial<MarketDataSet> = {}): MarketDataSet =>
    ({
      id: 'dataset-1',
      label: 'BTC Dataset',
      source: 'LOCAL',
      timeframe: 'HOUR',
      instrumentUniverse: ['BTCUSDT'],
      startAt: new Date('2024-01-01T00:00:00.000Z'),
      endAt: new Date('2024-01-10T00:00:00.000Z'),
      integrityScore: 90,
      checksum: 'abcd1234',
      storageLocation: '/tmp/dataset.csv',
      replayCapable: true,
      metadata: {},
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      ...overrides
    }) as MarketDataSet;

  const computeChecksum = (data: string) =>
    createHash('sha256').update(Buffer.from(data)).digest('hex').substring(0, 16);

  const createTempFile = async (filename: string, content: string) => {
    const filePath = path.join(tmpdir(), filename);
    await fs.writeFile(filePath, content);
    return filePath;
  };

  beforeEach(() => {
    service = new DatasetValidatorService();
    jest.clearAllMocks();
  });

  it('returns valid when checksum matches for local files', async () => {
    const content = 'test data';
    const filePath = await createTempFile('dataset-validator-match.csv', content);

    const result = await service.validateDataset(
      baseDataset({ checksum: computeChecksum(content), storageLocation: filePath }),
      {
        startDate: new Date('2024-01-02T00:00:00.000Z'),
        endDate: new Date('2024-01-03T00:00:00.000Z')
      }
    );

    await fs.unlink(filePath);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('adds checksum mismatch error for local files', async () => {
    const filePath = await createTempFile('dataset-validator-mismatch.csv', 'test data');

    const result = await service.validateDataset(
      baseDataset({ checksum: 'deadbeefdeadbeef', storageLocation: filePath }),
      {
        startDate: new Date('2024-01-02T00:00:00.000Z'),
        endDate: new Date('2024-01-03T00:00:00.000Z')
      }
    );

    await fs.unlink(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('CHECKSUM_MISMATCH');
  });

  it('skips checksum verification for remote storage', async () => {
    const result = await service.validateDataset(
      baseDataset({ storageLocation: 's3://bucket/data.csv', checksum: 'abcd' }),
      {
        startDate: new Date('2024-01-02T00:00:00.000Z'),
        endDate: new Date('2024-01-03T00:00:00.000Z')
      }
    );

    expect(result.valid).toBe(true);
  });

  it('returns valid when local checksum file read fails', async () => {
    const result = await service.validateDataset(baseDataset({ storageLocation: '/tmp/does-not-exist.csv' }), {
      startDate: new Date('2024-01-02T00:00:00.000Z'),
      endDate: new Date('2024-01-03T00:00:00.000Z')
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when backtest date range is invalid', async () => {
    const result = await service.validateDataset(baseDataset({ checksum: undefined as any }), {
      startDate: new Date('2024-01-03T00:00:00.000Z'),
      endDate: new Date('2024-01-02T00:00:00.000Z')
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('NO_DATE_OVERLAP');
  });

  it('returns error when no date overlap exists', async () => {
    const result = await service.validateDataset(baseDataset({ checksum: undefined as any }), {
      startDate: new Date('2024-02-01T00:00:00.000Z'),
      endDate: new Date('2024-02-02T00:00:00.000Z')
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('NO_DATE_OVERLAP');
  });

  it('returns overlap warning when dataset partially covers backtest range', async () => {
    const result = await service.validateDataset(baseDataset({ checksum: undefined as any }), {
      startDate: new Date('2024-01-05T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z')
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Backtest date range only'))).toBe(true);
  });

  it('warns when instrument coverage is low', async () => {
    const result = await service.validateDataset(baseDataset({ checksum: undefined as any }), {
      startDate: new Date('2024-01-02T00:00:00.000Z'),
      endDate: new Date('2024-01-03T00:00:00.000Z'),
      coinIds: ['BTC', 'ETH', 'SOL']
    });

    expect(result.warnings.some((w) => w.includes('Missing instruments in dataset'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Low instrument coverage'))).toBe(true);
  });

  it('warns when integrity score is very low', async () => {
    const result = await service.validateDataset(baseDataset({ integrityScore: 40, checksum: undefined as any }), {
      startDate: new Date('2024-01-02T00:00:00.000Z'),
      endDate: new Date('2024-01-03T00:00:00.000Z')
    });

    expect(result.warnings.some((w) => w.includes('very low'))).toBe(true);
  });

  it('warns when integrity score is below optimal', async () => {
    const result = await service.validateDataset(baseDataset({ integrityScore: 75, checksum: undefined as any }), {
      startDate: new Date('2024-01-02T00:00:00.000Z'),
      endDate: new Date('2024-01-03T00:00:00.000Z')
    });

    expect(result.warnings.some((w) => w.includes('below optimal'))).toBe(true);
  });
});
