import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CoinListingEvent, CoinListingEventType } from './coin-listing-event.entity';
import { CoinListingEventService } from './coin-listing-event.service';

function makeEvent(coinId: string, eventType: CoinListingEventType, eventDate: Date): CoinListingEvent {
  return { coinId, eventType, eventDate } as CoinListingEvent;
}

describe('CoinListingEventService', () => {
  let service: CoinListingEventService;
  const mockRepo = {
    find: jest.fn(),
    create: jest.fn((data: Partial<CoinListingEvent>) => data as CoinListingEvent),
    save: jest.fn((entity: CoinListingEvent) => Promise.resolve({ ...entity, id: 'generated-id' })),
    insert: jest.fn().mockResolvedValue(undefined)
  };

  const endDate = new Date('2025-06-01');

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CoinListingEventService, { provide: getRepositoryToken(CoinListingEvent), useValue: mockRepo }]
    }).compile();

    service = module.get(CoinListingEventService);
    jest.clearAllMocks();
  });

  describe('recordEvent', () => {
    it('should create and save event with default options', async () => {
      const result = await service.recordEvent('coin-a', CoinListingEventType.DELISTED);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coinId: 'coin-a',
          eventType: CoinListingEventType.DELISTED,
          exchangeId: null,
          source: 'coin_sync',
          metadata: null
        })
      );
      expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ coinId: 'coin-a' }));
      expect(result).toEqual(expect.objectContaining({ id: 'generated-id', coinId: 'coin-a' }));
    });

    it('should pass through all provided options', async () => {
      const metadata = { reason: 'low volume' };
      await service.recordEvent('coin-b', CoinListingEventType.LISTED, {
        exchangeId: 'ex-1',
        source: 'manual',
        metadata
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coinId: 'coin-b',
          exchangeId: 'ex-1',
          source: 'manual',
          metadata
        })
      );
    });
  });

  describe.each([
    ['recordBulkDelistings', CoinListingEventType.DELISTED],
    ['recordBulkListings', CoinListingEventType.LISTED],
    ['recordBulkRelistings', CoinListingEventType.RELISTED]
  ] as const)('%s', (method, expectedType) => {
    it('should skip insert for empty array', async () => {
      await (service as any)[method]([]);

      expect(mockRepo.insert).not.toHaveBeenCalled();
    });

    it('should insert events with correct type and default source', async () => {
      await (service as any)[method](['coin-a', 'coin-b']);

      expect(mockRepo.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ coinId: 'coin-a', eventType: expectedType, source: 'coin_sync' }),
          expect.objectContaining({ coinId: 'coin-b', eventType: expectedType, source: 'coin_sync' })
        ])
      );
    });

    it('should use custom source when provided', async () => {
      await (service as any)[method](['coin-a'], 'manual_override');

      expect(mockRepo.insert).toHaveBeenCalledWith([expect.objectContaining({ source: 'manual_override' })]);
    });
  });

  describe('getEventsByCoin', () => {
    it('should query by coinId with DESC ordering', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.getEventsByCoin('coin-a');

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { coinId: 'coin-a' },
        order: { eventDate: 'DESC' }
      });
    });
  });

  describe('getActiveDelistingsAsOf', () => {
    it('should return empty map for empty coinIds', async () => {
      const result = await service.getActiveDelistingsAsOf([], endDate);

      expect(result.size).toBe(0);
      expect(mockRepo.find).not.toHaveBeenCalled();
    });

    it('should return delisted coin within range', async () => {
      const delistDate = new Date('2025-03-15');
      mockRepo.find.mockResolvedValue([makeEvent('coin-a', CoinListingEventType.DELISTED, delistDate)]);

      const result = await service.getActiveDelistingsAsOf(['coin-a'], endDate);

      expect(result.size).toBe(1);
      expect(result.get('coin-a')).toEqual(delistDate);
    });

    it('should exclude coin that was relisted after delisting', async () => {
      mockRepo.find.mockResolvedValue([
        makeEvent('coin-a', CoinListingEventType.DELISTED, new Date('2025-02-01')),
        makeEvent('coin-a', CoinListingEventType.RELISTED, new Date('2025-04-01'))
      ]);

      const result = await service.getActiveDelistingsAsOf(['coin-a'], endDate);

      expect(result.size).toBe(0);
    });

    it('should return coin delisted before startDate when no relisting occurred', async () => {
      const delistDate = new Date('2024-06-01');
      mockRepo.find.mockResolvedValue([makeEvent('coin-a', CoinListingEventType.DELISTED, delistDate)]);

      const result = await service.getActiveDelistingsAsOf(['coin-a'], endDate);

      expect(result.size).toBe(1);
      expect(result.get('coin-a')).toEqual(delistDate);
    });

    it('should return latest delisting when multiple delistings exist', async () => {
      const earlierDelist = new Date('2025-01-15');
      const laterDelist = new Date('2025-04-01');
      mockRepo.find.mockResolvedValue([
        makeEvent('coin-a', CoinListingEventType.DELISTED, earlierDelist),
        makeEvent('coin-a', CoinListingEventType.RELISTED, new Date('2025-02-01')),
        makeEvent('coin-a', CoinListingEventType.DELISTED, laterDelist)
      ]);

      const result = await service.getActiveDelistingsAsOf(['coin-a'], endDate);

      expect(result.size).toBe(1);
      expect(result.get('coin-a')).toEqual(laterDelist);
    });

    it('should return empty map when no events exist', async () => {
      mockRepo.find.mockResolvedValue([]);

      const result = await service.getActiveDelistingsAsOf(['coin-a', 'coin-b'], endDate);

      expect(result.size).toBe(0);
    });

    it('should handle multiple coins independently', async () => {
      mockRepo.find.mockResolvedValue([
        makeEvent('coin-a', CoinListingEventType.DELISTED, new Date('2025-03-01')),
        makeEvent('coin-b', CoinListingEventType.DELISTED, new Date('2025-02-01')),
        makeEvent('coin-b', CoinListingEventType.RELISTED, new Date('2025-04-01'))
      ]);

      const result = await service.getActiveDelistingsAsOf(['coin-a', 'coin-b'], endDate);

      expect(result.size).toBe(1);
      expect(result.has('coin-a')).toBe(true);
      expect(result.has('coin-b')).toBe(false);
    });

    it('should keep coin as delisted when relisting occurs after endDate', async () => {
      const delistDate = new Date('2025-03-01');
      // RELISTED event after endDate is now filtered out at DB level (eventDate <= endDate)
      mockRepo.find.mockResolvedValue([makeEvent('coin-a', CoinListingEventType.DELISTED, delistDate)]);

      const result = await service.getActiveDelistingsAsOf(['coin-a'], endDate);

      expect(result.size).toBe(1);
      expect(result.get('coin-a')).toEqual(delistDate);
    });

    it('should include delisting at exact endDate boundary', async () => {
      mockRepo.find.mockResolvedValue([makeEvent('coin-a', CoinListingEventType.DELISTED, endDate)]);

      const result = await service.getActiveDelistingsAsOf(['coin-a'], endDate);

      expect(result.size).toBe(1);
      expect(result.get('coin-a')).toEqual(endDate);
    });
  });
});
