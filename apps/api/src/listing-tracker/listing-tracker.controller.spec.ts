import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ListingTrackerController } from './listing-tracker.controller';

describe('ListingTrackerController retry endpoint', () => {
  let announcementRepo: any;
  let candidateRepo: any;
  let positionRepo: any;
  let coinRepo: any;
  let tracker: any;
  let scoreTask: any;
  let controller: ListingTrackerController;

  beforeEach(() => {
    announcementRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((x) => Promise.resolve(x)),
      createQueryBuilder: jest.fn()
    };
    candidateRepo = { find: jest.fn(), findOne: jest.fn() };
    positionRepo = { find: jest.fn() };
    coinRepo = { findOne: jest.fn() };
    tracker = { handleNewAnnouncement: jest.fn().mockResolvedValue(undefined) };
    scoreTask = { runNow: jest.fn().mockResolvedValue(undefined) };

    controller = new ListingTrackerController(
      announcementRepo,
      candidateRepo,
      positionRepo,
      coinRepo,
      tracker,
      scoreTask
    );
  });

  it('throws NotFoundException when the announcement does not exist', async () => {
    announcementRepo.findOne.mockResolvedValue(null);
    await expect(controller.retryAnnouncement('missing-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns skipped with no-coin-mapping when no coinId is present and none is provided', async () => {
    announcementRepo.findOne.mockResolvedValue({ id: 'a1', coinId: null });

    const result = await controller.retryAnnouncement('a1');

    expect(result).toEqual({ status: 'skipped', reason: 'no-coin-mapping' });
    expect(tracker.handleNewAnnouncement).not.toHaveBeenCalled();
  });

  it('accepts a manual coinId and dispatches the announcement', async () => {
    const announcement = { id: 'a1', coinId: null as string | null };
    announcementRepo.findOne.mockResolvedValue(announcement);
    coinRepo.findOne
      .mockResolvedValueOnce({ id: 'override-coin' }) // override lookup
      .mockResolvedValueOnce({ id: 'override-coin' }); // dispatch lookup

    const result = await controller.retryAnnouncement('a1', 'override-coin');

    expect(announcementRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', coinId: 'override-coin' }));
    expect(tracker.handleNewAnnouncement).toHaveBeenCalled();
    expect(result).toEqual({ status: 'queued' });
  });

  it('accepts a manual coinId via body param', async () => {
    const announcement = { id: 'a1', coinId: null as string | null };
    announcementRepo.findOne.mockResolvedValue(announcement);
    coinRepo.findOne.mockResolvedValue({ id: 'body-coin' });

    const result = await controller.retryAnnouncement('a1', undefined, { coinId: 'body-coin' });

    expect(announcementRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', coinId: 'body-coin' }));
    expect(result).toEqual({ status: 'queued' });
  });

  it('returns skipped with coin-missing when the mapped coin no longer exists', async () => {
    announcementRepo.findOne.mockResolvedValue({ id: 'a1', coinId: 'stale-coin' });
    coinRepo.findOne.mockResolvedValue(null);

    const result = await controller.retryAnnouncement('a1');

    expect(result).toEqual({ status: 'skipped', reason: 'coin-missing' });
    expect(tracker.handleNewAnnouncement).not.toHaveBeenCalled();
    expect(announcementRepo.save).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when the manual coinId does not match any coin', async () => {
    announcementRepo.findOne.mockResolvedValue({ id: 'a1', coinId: null });
    coinRepo.findOne.mockResolvedValue(null);

    await expect(controller.retryAnnouncement('a1', 'nonexistent')).rejects.toBeInstanceOf(BadRequestException);
    expect(announcementRepo.save).not.toHaveBeenCalled();
  });

  it('ignores the override when announcement already has a coinId', async () => {
    announcementRepo.findOne.mockResolvedValue({ id: 'a1', coinId: 'existing' });
    coinRepo.findOne.mockResolvedValue({ id: 'existing' });

    const result = await controller.retryAnnouncement('a1', 'would-be-ignored');

    expect(announcementRepo.save).not.toHaveBeenCalled();
    expect(tracker.handleNewAnnouncement).toHaveBeenCalled();
    expect(result).toEqual({ status: 'queued' });
  });
});
