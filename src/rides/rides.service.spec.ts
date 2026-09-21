import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  RideApprovalStatus,
  RideStatus,
  RideType,
} from '../database/schemas/rides.schema';
import { PaymentMethod } from '../database/schemas/trips.schema';
import {
  RentalBillingType,
  RentalStatus,
} from '../database/schemas/rentals.schema';
import { GeolocationService } from './geolocation.service';
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

    await expect(service.cancelRiderRental(user, rentalId)).resolves.toBe(
      cancelled,
    );
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

describe('RidesService Play reviewer sandbox', () => {
  const riderReviewer = {
    email: 'rider-review@ritzurbanluxury.com',
    id: riderId,
  } as never;
  const driverReviewer = {
    email: 'driver-review@ritzurbanluxury.com',
    id: ownerId,
  } as never;
  const syntheticRide = {
    approvalStatus: RideApprovalStatus.Approved,
    driver: driverReviewer,
    id: rideId,
    specs: { synthetic: true },
    status: RideStatus.Offline,
    type: RideType.Classic,
  };
  let service: RidesService;
  let cache: any;
  let db: any;
  let paymentService: any;
  let push: any;
  let websocket: any;

  beforeEach(() => {
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_REVIEW_OTP = '1847';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_OTP = '6305';

    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    db = {
      driverOnlineSessions: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      rentals: {
        create: jest.fn(),
        exists: jest.fn().mockResolvedValue(false),
      },
      rides: {
        find: jest.fn(),
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateMany: jest.fn(),
      },
      trips: {
        create: jest.fn(),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };
    paymentService = { chargeUser: jest.fn() };
    push = { sendToUser: jest.fn() };
    websocket = { emitToUser: jest.fn() };

    service = Object.create(RidesService.prototype);
    Object.assign(service as any, {
      cache,
      db,
      finance: { canDriverReceiveRides: jest.fn().mockResolvedValue(true) },
      paymentService,
      push,
      websocket,
    });
  });

  afterEach(() => {
    delete process.env.PLAY_RIDER_REVIEW_EMAIL;
    delete process.env.PLAY_RIDER_REVIEW_OTP;
    delete process.env.PLAY_DRIVER_REVIEW_EMAIL;
    delete process.env.PLAY_DRIVER_REVIEW_OTP;
    jest.restoreAllMocks();
  });

  it('allows the approved synthetic driver vehicle to go online', async () => {
    db.rides.findOne.mockResolvedValue(syntheticRide);
    db.rides.findOneAndUpdate.mockResolvedValue({
      ...syntheticRide,
      status: RideStatus.Online,
    });

    await expect(
      service.setRideAvailability(driverReviewer, RideStatus.Online, rideId),
    ).resolves.toMatchObject({ status: RideStatus.Online });

    expect(db.rides.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: rideId },
      {
        $set: {
          'specs.synthetic': true,
          status: RideStatus.Online,
        },
      },
      { new: true },
    );
    expect(db.driverOnlineSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ driver: ownerId, ride: rideId }),
    );
  });

  it('excludes synthetic vehicles from the public availability query', async () => {
    const sort = jest.fn().mockResolvedValue([]);
    const populate = jest.fn().mockReturnValue({ sort });
    db.rides.find.mockReturnValue({ populate });

    await service.getAvailableRides({ lat: 9.0765, lon: 7.3986 });

    expect(db.rides.find).toHaveBeenCalledWith(
      expect.objectContaining({
        'specs.synthetic': { $ne: true },
      }),
    );
  });

  it('creates an isolated zero-charge trip for the rider reviewer', async () => {
    jest.spyOn(GeolocationService, 'getDistance').mockResolvedValue(3000);
    db.rides.findOne.mockReturnValue(populatedQuery(syntheticRide));
    const trip = {
      id: 'synthetic-trip-id',
      toObject: () => ({ id: 'synthetic-trip-id', status: 'Started' }),
    };
    db.trips.create.mockResolvedValue(trip);

    const result = await service.requestRide(riderReviewer, {
      fromAddress: 'Review pickup',
      fromLat: 9.0765,
      fromLon: 7.3986,
      paymentMethod: PaymentMethod.Card,
      stops: [],
      toAddress: 'Review destination',
      toLat: 9.082,
      toLon: 7.402,
      type: RideType.Classic,
    });

    expect(db.trips.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 0,
        meta: expect.objectContaining({ playReviewSynthetic: true }),
        paymentMethod: PaymentMethod.Card,
      }),
    );
    expect(result).toMatchObject({
      trackingId: 'synthetic-trip-id',
      trip: { id: 'synthetic-trip-id' },
    });
    expect(paymentService.chargeUser).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(websocket.emitToUser).toHaveBeenCalledWith(
      riderReviewer,
      'TripStarted',
      expect.objectContaining({ id: 'synthetic-trip-id' }),
    );
  });

  it('creates a zero-charge synthetic hire without notifying the real owner', async () => {
    jest.spyOn(service, 'getOngoingRental').mockResolvedValue(null);
    const hireRide = {
      dailyRate: 50000,
      driver: ownerId,
      hourlyRate: 8000,
      id: rideId,
      insuranceFee: 500,
      specs: {},
      type: RideType.Hire,
    };
    db.rides.findOne.mockResolvedValue(hireRide);
    db.rentals.create.mockImplementation(async (payload) => ({
      ...payload,
      id: rentalId,
    }));

    const result = await service.hireARide(riderReviewer, {
      billingType: RentalBillingType.Daily,
      checkInAt: new Date('2026-10-01T09:00:00.000Z'),
      checkOutAt: new Date('2026-10-02T09:00:00.000Z'),
      from: {
        address: 'Review pickup',
        coordinates: [9.0765, 7.3986],
        heading: 0,
        type: 'Point',
      },
      paymentMethod: PaymentMethod.Card,
      ride: rideId,
    });

    expect(result).toMatchObject({
      id: rentalId,
      meta: expect.objectContaining({ playReviewSynthetic: true }),
      price: 0,
    });
    expect(db.rentals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cautionAmount: 0,
        driver: riderId,
        hireFee: 0,
        insuranceFee: 0,
        price: 0,
      }),
    );
    expect(paymentService.chargeUser).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
  });
});

describe('RidesService notification sounds', () => {
  const rider = { id: riderId } as never;
  const driver = { id: ownerId } as never;
  const trip = { driver, id: rentalId, user: rider } as never;
  let service: RidesService;
  let cache: {
    del: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
  };
  let db: {
    findAndUpdateOrFail: jest.Mock;
    findOrFail: jest.Mock;
    messages: { create: jest.Mock };
    rides: { updateOne: jest.Mock };
    trips: { create: jest.Mock };
  };
  let push: { sendToUser: jest.Mock };
  let websocket: { emitToUser: jest.Mock };

  beforeEach(() => {
    cache = {
      del: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    };
    db = {
      findAndUpdateOrFail: jest.fn(),
      findOrFail: jest.fn(),
      messages: { create: jest.fn() },
      rides: { updateOne: jest.fn() },
      trips: { create: jest.fn() },
    };
    push = { sendToUser: jest.fn() };
    websocket = { emitToUser: jest.fn() };

    service = Object.create(RidesService.prototype);
    Object.assign(service, {
      WAIT_TIME: 0,
      cache,
      db,
      finance: { canDriverReceiveRides: jest.fn().mockResolvedValue(true) },
      push,
      websocket,
    });
  });

  it('uses the ride-request and booking-accepted sounds', async () => {
    const ride = { driver, id: rideId } as never;
    cache.get.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    db.trips.create.mockResolvedValue(trip);
    const internals = service as unknown as {
      closeOnlineSession: () => Promise<void>;
      recordRideOffer: () => Promise<void>;
      resolveRideOffer: () => Promise<void>;
    };
    jest.spyOn(internals, 'recordRideOffer').mockResolvedValue(undefined);
    jest.spyOn(internals, 'resolveRideOffer').mockResolvedValue(undefined);
    jest.spyOn(internals, 'closeOnlineSession').mockResolvedValue(undefined);

    await service.connectToDriver(rider, [ride], 'connection-id', {
      amount: 5000,
      distance: 3,
      fromAddress: 'Pickup',
      fromLat: 9.1,
      fromLon: 7.1,
      paymentMethod: PaymentMethod.Cash,
      stops: [],
      toAddress: 'Destination',
      toLat: 9.2,
      toLon: 7.2,
      type: RideType.Classic,
    });

    expect(push.sendToUser).toHaveBeenCalledWith(
      driver,
      expect.objectContaining({
        channelId: 'driver-ride-requests-v1',
        sound: 'new_ride_request.wav',
      }),
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      rider,
      expect.objectContaining({
        channelId: 'rider-booking-updates-v1',
        sound: 'booking_accepted.wav',
      }),
    );
  });

  it('uses the chat sound only for the message recipient', async () => {
    db.findOrFail.mockResolvedValue(trip);
    db.messages.create.mockResolvedValue({ id: 'message-id', text: 'Hello' });

    await service.sendMessage(rider, rentalId, { text: 'Hello' });

    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser).toHaveBeenCalledWith(
      driver,
      expect.objectContaining({
        app: 'driver',
        channelId: 'trip-messages-v1',
        sound: 'chat_message.wav',
      }),
    );
  });

  it('uses the driver-arrival sound for the rider', async () => {
    db.findAndUpdateOrFail.mockResolvedValue(trip);

    await service.annouceArrival(driver, rentalId);

    expect(push.sendToUser).toHaveBeenCalledWith(
      rider,
      expect.objectContaining({
        app: 'rider',
        channelId: 'rider-driver-arrival-v1',
        sound: 'driver_arrived.wav',
      }),
    );
  });
});
