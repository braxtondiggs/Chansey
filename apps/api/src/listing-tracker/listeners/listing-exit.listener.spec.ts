import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ListingExitListener } from './listing-exit.listener';

import { PositionExitStatus } from '../../order/interfaces/exit-config.interface';
import { type PositionExitFilledPayload } from '../../order/interfaces/order-events.interface';
import { Order } from '../../order/order.entity';
import { User } from '../../users/users.entity';
import { ListingPositionStatus, ListingTradePosition } from '../entities/listing-trade-position.entity';
import { ListingHedgeService } from '../services/listing-hedge.service';

describe('ListingExitListener', () => {
  let listener: ListingExitListener;

  const mockPositionRepo = {
    findOne: jest.fn(),
    save: jest.fn().mockImplementation((x) => Promise.resolve(x))
  };
  const mockOrderRepo = { findOne: jest.fn() };
  const mockUserRepo = { findOne: jest.fn() };
  const mockHedgeService = { closeShort: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListingExitListener,
        { provide: getRepositoryToken(ListingTradePosition), useValue: mockPositionRepo },
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: ListingHedgeService, useValue: mockHedgeService }
      ]
    }).compile();

    listener = module.get<ListingExitListener>(ListingExitListener);
    jest.clearAllMocks();
  });

  function payload(status: PositionExitStatus): PositionExitFilledPayload {
    return {
      positionExitId: 'pe-1',
      entryOrderId: 'order-1',
      userId: 'user-1',
      status,
      exitPrice: 100,
      realizedPnL: 25
    };
  }

  it('returns quietly when no listing position matches the entry order', async () => {
    mockPositionRepo.findOne.mockResolvedValue(null);

    await listener.handlePositionExitFilled(payload(PositionExitStatus.STOP_LOSS_TRIGGERED));

    expect(mockPositionRepo.save).not.toHaveBeenCalled();
    expect(mockHedgeService.closeShort).not.toHaveBeenCalled();
  });

  it('maps STOP_LOSS_TRIGGERED to EXITED_SL', async () => {
    mockPositionRepo.findOne.mockResolvedValue({
      id: 'pos-1',
      orderId: 'order-1',
      hedgeOrderId: null,
      status: ListingPositionStatus.OPEN
    });

    await listener.handlePositionExitFilled(payload(PositionExitStatus.STOP_LOSS_TRIGGERED));

    expect(mockPositionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ListingPositionStatus.EXITED_SL })
    );
  });

  it('maps TAKE_PROFIT_TRIGGERED to EXITED_TP', async () => {
    mockPositionRepo.findOne.mockResolvedValue({
      id: 'pos-1',
      orderId: 'order-1',
      hedgeOrderId: null,
      status: ListingPositionStatus.OPEN
    });

    await listener.handlePositionExitFilled(payload(PositionExitStatus.TAKE_PROFIT_TRIGGERED));

    expect(mockPositionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ListingPositionStatus.EXITED_TP })
    );
  });

  it('maps TRAILING_TRIGGERED to EXITED_TP', async () => {
    mockPositionRepo.findOne.mockResolvedValue({
      id: 'pos-1',
      orderId: 'order-1',
      hedgeOrderId: null,
      status: ListingPositionStatus.OPEN
    });

    await listener.handlePositionExitFilled(payload(PositionExitStatus.TRAILING_TRIGGERED));

    expect(mockPositionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ListingPositionStatus.EXITED_TP })
    );
  });

  it('closes the hedge when one is present', async () => {
    mockPositionRepo.findOne.mockResolvedValue({
      id: 'pos-1',
      orderId: 'order-1',
      hedgeOrderId: 'hedge-1',
      status: ListingPositionStatus.OPEN
    });
    const hedgeOrder = { id: 'hedge-1' } as Order;
    const user = { id: 'user-1' } as User;
    mockOrderRepo.findOne.mockResolvedValue(hedgeOrder);
    mockUserRepo.findOne.mockResolvedValue(user);

    await listener.handlePositionExitFilled(payload(PositionExitStatus.STOP_LOSS_TRIGGERED));

    expect(mockHedgeService.closeShort).toHaveBeenCalledWith(user, hedgeOrder);
  });

  it('does not close the hedge when hedgeOrderId is absent', async () => {
    mockPositionRepo.findOne.mockResolvedValue({
      id: 'pos-1',
      orderId: 'order-1',
      hedgeOrderId: null,
      status: ListingPositionStatus.OPEN
    });

    await listener.handlePositionExitFilled(payload(PositionExitStatus.STOP_LOSS_TRIGGERED));

    expect(mockHedgeService.closeShort).not.toHaveBeenCalled();
  });

  it('skips unknown/cancelled statuses without updating the position', async () => {
    mockPositionRepo.findOne.mockResolvedValue({
      id: 'pos-1',
      orderId: 'order-1',
      hedgeOrderId: null,
      status: ListingPositionStatus.OPEN
    });

    await listener.handlePositionExitFilled(payload(PositionExitStatus.CANCELLED));

    expect(mockPositionRepo.save).not.toHaveBeenCalled();
    expect(mockHedgeService.closeShort).not.toHaveBeenCalled();
  });

  it('swallows errors so the listener never crashes the emitter', async () => {
    mockPositionRepo.findOne.mockRejectedValue(new Error('db down'));

    await expect(
      listener.handlePositionExitFilled(payload(PositionExitStatus.STOP_LOSS_TRIGGERED))
    ).resolves.toBeUndefined();
  });
});
