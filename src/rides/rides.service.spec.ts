import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '../database/schemas/trips.schema';
import { RentalStatus } from '../database/schemas/rentals.schema';
import { RidesService } from './rides.service';

const riderId = '64a000000000000000000001';
const ownerId = '64a000000000000000000002';
const rentalId = '64a000000000000000000003';
const rideId = '64a000000000000000000004';

const populatedQuery = <T>(value: T) => ({
  populate: jest.fn().mockResolvedValue(value),
});

describe('RidesService.cancelRiderRental', () => {
  const user = { id: riderId } as never;
  let service: RidesService;
  let db: any;
  let paymentService: any;
  let websocket: any;
  let push: any;

  beforeEach(() => {
    db = {
      rentals: {
        exists: jest.fn().mockResolvedValue(false),
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
      },
      rides: {
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
      users: {
        findById: jest.fn().mockResolvedValue(user),
      },
    };
    paymentService = {
      refundCharge: jest.fn().mockResolvedValue({
        amount: 12000,
        provider: PaymentMethod.RULBalance,
        status: 'processed',
      }),
    };
    websocket = {
      emitToUser: jest.fn().mockResolvedValue(undefined),
    };
    push = {
      sendToUser: jest.fn(),
    };

    service = Object.create(RidesService.prototype);
    Object.assign(service as any, { db, paymentService, push, websocket });
  });

  it('atomically cancels a pending rider rental and refunds the full payment', async () => {
    const existing = {
      driver: ownerId,
      id: rentalId,
      meta: { paymentResponse: { amount: 12000 } },
      paymentMethod: PaymentMethod.RULBalance,
      price: 12000,
      refundedAmount: 0,
      ride: rideId,
      status: RentalStatus.Pending,
      user: riderId,
    };
    const cancelled = { ...existing, status: RentalStatus.Cancelled };
    const refunded = {
      ...cancelled,
      meta: {
        ...cancelled.meta,
        refundResponse: {
          amount: 12000,
          provider: PaymentMethod.RULBalance,
          status: 'processed',
        },
      },
      refundedAmount: 12000,
    };

    db.rentals.findOne.mockReturnValue(populatedQuery(existing));
    db.rentals.findOneAndUpdate
      .mockReturnValueOnce(populatedQuery(cancelled))
      .mockReturnValueOnce(populatedQuery(refunded));

    const result = await service.cancelRiderRental(
      user,
      rentalId,
      'Changed plans',
    );

    expect(db.rentals.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _id: rentalId,
        status: RentalStatus.Pending,
        user: riderId,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          cancellationReason: 'Changed plans',
          status: RentalStatus.Cancelled,
        }),
      }),
      { new: true },
    );
    expect(paymentService.refundCharge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 12000 }),
    );
    expect(result).toBe(refunded);
    expect(websocket.emitToUser).toHaveBeenCalled();
  });

  it('does not initiate another refund for an already cancelled rental', async () => {
    const cancelled = {
      driver: ownerId,
      id: rentalId,
      paymentMethod: PaymentMethod.RULBalance,
      price: 12000,
      ride: rideId,
      status: RentalStatus.Cancelled,
      user: riderId,
    };
    db.rentals.findOne.mockReturnValue(populatedQuery(cancelled));

    await expect(
      service.cancelRiderRental(user, rentalId),
    ).resolves.toBe(cancelled);
    expect(paymentService.refundCharge).not.toHaveBeenCalled();
    expect(db.rentals.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects cancellation after owner approval', async () => {
    db.rentals.findOne.mockReturnValue(
      populatedQuery({
        id: rentalId,
        status: RentalStatus.Accepted,
        user: riderId,
      }),
    );

    await expect(service.cancelRiderRental(user, rentalId)).rejects.toThrow(
      BadRequestException,
    );
    expect(paymentService.refundCharge).not.toHaveBeenCalled();
  });

  it('does not expose rentals belonging to another rider', async () => {
    db.rentals.findOne.mockReturnValue(populatedQuery(null));

    await expect(service.cancelRiderRental(user, rentalId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
