import { Readable } from 'stream';

import { MarketDataReaderService } from './market-data-reader.service';

describe('MarketDataReaderService', () => {
  const createService = (storageOverrides: Record<string, jest.Mock> = {}) => {
    const storageService = {
      getFileStats: jest.fn(),
      getFileStream: jest.fn(),
      ...storageOverrides
    };
    return { service: new MarketDataReaderService(storageService as any), storageService };
  };

  /** Build a mock storage that returns a stream from the given CSV string */
  const mockStorageForCSV = (csv: string) => ({
    getFileStats: jest.fn().mockResolvedValue({ size: Buffer.byteLength(csv) }),
    getFileStream: jest.fn().mockResolvedValue(Readable.from([csv]))
  });

  /** Shorthand to call readMarketData with minimal dataset shape */
  const readCSV = (
    service: MarketDataReaderService,
    csv: { storageLocation: string; instrumentUniverse: string[] },
    startDate?: Date,
    endDate?: Date
  ) => service.readMarketData(csv as any, startDate, endDate);

  // ── Security: sanitizeObjectPath ──────────────────────────────────────

  describe('sanitizeObjectPath', () => {
    it('rejects path traversal segments', () => {
      const { service } = createService();
      const sanitize = (p: string) => (service as any).sanitizeObjectPath(p);

      expect(() => sanitize('../secrets.csv')).toThrow('path traversal not allowed');
      expect(() => sanitize('datasets/../secrets.csv')).toThrow('path traversal not allowed');
    });

    it('rejects absolute paths', () => {
      const { service } = createService();

      expect(() => (service as any).sanitizeObjectPath('/datasets/btc.csv')).toThrow('absolute paths not allowed');
    });

    it('rejects null bytes', () => {
      const { service } = createService();

      expect(() => (service as any).sanitizeObjectPath('datasets/btc\0.csv')).toThrow('null bytes not allowed');
    });

    it('rejects empty paths', () => {
      const { service } = createService();

      expect(() => (service as any).sanitizeObjectPath('')).toThrow('path cannot be empty');
    });
  });

  // ── Storage location parsing ──────────────────────────────────────────

  describe('parseStorageLocation', () => {
    it('parses s3:// URLs to object path', () => {
      const { service } = createService();
      const parse = (loc: string) => (service as any).parseStorageLocation(loc);

      expect(parse('s3://my-bucket/datasets/btc-hourly.csv')).toBe('datasets/btc-hourly.csv');
    });

    it('rejects s3:// URLs without path', () => {
      const { service } = createService();

      expect(() => (service as any).parseStorageLocation('s3://bucket-only')).toThrow('Invalid s3:// URL format');
    });

    it('parses http:// URLs stripping bucket prefix', () => {
      const { service } = createService();
      const parse = (loc: string) => (service as any).parseStorageLocation(loc);

      expect(parse('http://minio:9000/my-bucket/datasets/btc.csv')).toBe('datasets/btc.csv');
      expect(parse('https://storage.example.com/bucket/deep/path/file.csv')).toBe('deep/path/file.csv');
    });

    it('passes through direct paths', () => {
      const { service } = createService();

      expect((service as any).parseStorageLocation('datasets/btc-hourly.csv')).toBe('datasets/btc-hourly.csv');
    });
  });

  // ── readMarketData: pre-checks ────────────────────────────────────────

  describe('readMarketData pre-checks', () => {
    it('throws when dataset has no storage location', async () => {
      const { service } = createService();

      await expect(readCSV(service, { storageLocation: '', instrumentUniverse: ['BTC'] })).rejects.toThrow(
        'Dataset does not have a storage location configured'
      );
    });

    it('throws when file not found in storage', async () => {
      const { service } = createService({
        getFileStats: jest.fn().mockResolvedValue(null),
        getFileStream: jest.fn()
      });

      await expect(
        readCSV(service, { storageLocation: 'datasets/missing.csv', instrumentUniverse: ['BTC'] })
      ).rejects.toThrow('Market data file not found');
    });

    it('rejects file exceeding 500MB size limit', async () => {
      const { service } = createService({
        getFileStats: jest.fn().mockResolvedValue({ size: 501 * 1024 * 1024 }),
        getFileStream: jest.fn()
      });

      await expect(
        readCSV(service, { storageLocation: 'datasets/huge.csv', instrumentUniverse: ['BTC'] })
      ).rejects.toThrow('CSV file exceeds maximum size of 500MB');
    });
  });

  // ── readMarketData: stream parsing ────────────────────────────────────

  describe('readMarketData stream parsing', () => {
    it('parses CSV with all OHLCV columns', async () => {
      const csv = [
        'timestamp,open,high,low,close,volume,symbol',
        '2024-01-01T00:00:00Z,100,105,95,102,1000,BTC',
        '2024-01-01T01:00:00Z,102,110,101,108,1100,BTC'
      ].join('\n');

      const { service, storageService } = createService(mockStorageForCSV(csv));

      const result = await readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: ['BTC'] });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ open: 100, high: 105, low: 95, close: 102, volume: 1000, coinId: 'BTC' })
      );
      expect(result.source).toBe('storage');
      expect(result.recordCount).toBe(2);
      expect(storageService.getFileStream).toHaveBeenCalledWith('datasets/btc.csv');
    });

    it('handles quoted values with commas and defaults optional fields', async () => {
      const csv = ['Timestamp,Close,Symbol', '2024-01-01T00:00:00Z,100,"BTC,USD"', '2024-01-01T01:00:00Z,101,ETH'].join(
        '\n'
      );

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: [] });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].coinId).toBe('BTC,USD');
      // Defaults: open/high/low = close, volume = 0
      expect(result.data[0]).toEqual(expect.objectContaining({ open: 100, high: 100, low: 100, volume: 0 }));
    });

    it('resolves column name aliases (time, price, o, h, l, vol, ticker)', async () => {
      const csv = ['time,price,o,h,l,vol,ticker', '2024-01-01T00:00:00Z,100,99,105,95,500,ETH'].join('\n');

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(service, { storageLocation: 'datasets/eth.csv', instrumentUniverse: ['ETH'] });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ close: 100, open: 99, high: 105, low: 95, volume: 500, coinId: 'ETH' })
      );
    });

    it('filters by date range during streaming', async () => {
      const csv = [
        'timestamp,close',
        '2024-01-01T00:00:00Z,100',
        '2024-01-02T00:00:00Z,101',
        '2024-01-03T00:00:00Z,102',
        '2024-01-04T00:00:00Z,103'
      ].join('\n');

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(
        service,
        { storageLocation: 'datasets/btc.csv', instrumentUniverse: ['BTC'] },
        new Date('2024-01-02T00:00:00Z'),
        new Date('2024-01-03T00:00:00Z')
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0].close).toBe(101);
      expect(result.data[1].close).toBe(102);
    });

    it('sorts output by timestamp regardless of input order', async () => {
      const csv = [
        'timestamp,close',
        '2024-01-03T00:00:00Z,103',
        '2024-01-01T00:00:00Z,101',
        '2024-01-02T00:00:00Z,102'
      ].join('\n');

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: ['BTC'] });

      expect(result.data.map((d) => d.close)).toEqual([101, 102, 103]);
      expect(result.dateRange.start).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(result.dateRange.end).toEqual(new Date('2024-01-03T00:00:00Z'));
    });

    it('uses instrumentUniverse[0] as default coinId', async () => {
      const csv = ['timestamp,close', '2024-01-01T00:00:00Z,100'].join('\n');

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: ['SOL'] });

      expect(result.data[0].coinId).toBe('SOL');
    });

    it('falls back to UNKNOWN when instrumentUniverse is empty and no symbol column', async () => {
      const csv = ['timestamp,close', '2024-01-01T00:00:00Z,100'].join('\n');

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: [] });

      expect(result.data[0].coinId).toBe('UNKNOWN');
    });
  });

  // ── Timestamp parsing ─────────────────────────────────────────────────

  describe('timestamp formats', () => {
    it.each([
      ['ISO 8601', '2024-01-01T00:00:00Z', new Date('2024-01-01T00:00:00Z')],
      ['Unix seconds', '1704067200', new Date('2024-01-01T00:00:00Z')],
      ['Unix milliseconds', '1704067200000', new Date('2024-01-01T00:00:00Z')]
    ])('parses %s timestamps', async (_, timestampValue, expectedDate) => {
      const csv = ['timestamp,close', `${timestampValue},100`].join('\n');

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: ['BTC'] });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].timestamp).toEqual(expectedDate);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('skips invalid timestamps and keeps valid rows', async () => {
      const csv = ['timestamp,close', 'not-a-date,100', '2024-01-01T00:00:00Z,101'].join('\n');

      const { service } = createService(mockStorageForCSV(csv));
      const result = await readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: [] });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].close).toBe(101);
    });

    it('throws when all rows are invalid', async () => {
      const csv = ['timestamp,close', 'not-a-date,100', 'also-bad,101'].join('\n');

      const { service } = createService(mockStorageForCSV(csv));

      await expect(readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: [] })).rejects.toThrow(
        'the file contains no valid data rows'
      );
    });

    it('rejects CSV missing required timestamp column', async () => {
      const csv = ['price,volume', '100,1000'].join('\n');

      const { service } = createService(mockStorageForCSV(csv));

      await expect(
        readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: ['BTC'] })
      ).rejects.toThrow('timestamp column');
    });

    it('rejects CSV missing required close column', async () => {
      const csv = ['timestamp,volume', '2024-01-01T00:00:00Z,1000'].join('\n');

      const { service } = createService(mockStorageForCSV(csv));

      await expect(
        readCSV(service, { storageLocation: 'datasets/btc.csv', instrumentUniverse: ['BTC'] })
      ).rejects.toThrow('close/price column');
    });
  });
});
