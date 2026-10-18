import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  RideApprovalStatus,
  RideStatus,
  RideType,
  VehicleCategory,
} from '../database/schemas/rides.schema';
import {
  PaymentMethod,
  TripStatus,
  TripStopStatus,
} from '../database/schemas/trips.schema';
import { UserReportReason } from '../database/schemas/user-report.schema';
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

describe('GeolocationService waypoint routes', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sums pickup-to-stop and stop-to-destination route totals', async () => {
    jest
      .spyOn(GeolocationService, 'getRouteSummary')
      .mockResolvedValueOnce({ distance: 4000, duration: 600 })
      .mockResolvedValueOnce({ distance: 7000, duration: 900 });

    await expect(
      GeolocationService.getRouteSummaryWithStops(
        [9.0, 7.3],
        [9.2, 7.5],
        [[9.1, 7.4]],
      ),
    ).resolves.toEqual({ distance: 11000, duration: 1500 });

    expect(GeolocationService.getRouteSummary).toHaveBeenNthCalledWith(
      1,
      [9.0, 7.3],
      [9.1, 7.4],
    );
    expect(GeolocationService.getRouteSummary).toHaveBeenNthCalledWith(
      2,
      [9.1, 7.4],
      [9.2, 7.5],
    );
  });
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
    phoneNumber: '2347064192718',
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
    process.env.PLAY_REVIEW_OTP = '1847';
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';

    cache = {
      del: jest.fn(),
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
        findOne: jest.fn(),
      },
      rides: {
        find: jest.fn(),
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn(),
        updateMany: jest.fn(),
      },
      driverRideOffers: { updateOne: jest.fn() },
      trips: {
        create: jest.fn(),
        findOne: jest.fn().mockResolvedValue(null),
      },
      userBlocks: {
        exists: jest.fn().mockResolvedValue(false),
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue([]),
        }),
      },
      users: { findOne: jest.fn() },
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
      pricing: {
        quote: jest.fn().mockResolvedValue({ classic: 700, luxury: 800 }),
      },
      push,
      websocket,
    });
  });

  it('enables the rider demo only for the canonical reusable phone account', () => {
    expect(service.getReviewMode(riderReviewer)).toMatchObject({
      canDeleteAccount: false,
      canGenerateDemoRide: false,
      canUseRiderDemo: true,
    });

    expect(
      service.getReviewMode({
        email: 'rider-review@ritzurbanluxury.com',
        id: riderId,
        phoneNumber: '2347000000000',
      } as never),
    ).toMatchObject({ canUseRiderDemo: false });
  });

  afterEach(() => {
    delete process.env.PLAY_REVIEW_OTP;
    delete process.env.PLAY_RIDER_REVIEW_EMAIL;
    delete process.env.PLAY_DRIVER_REVIEW_EMAIL;
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

  it('automatically uses an approved trip vehicle when no ride id is sent', async () => {
    db.rides.findOne.mockResolvedValue(syntheticRide);
    db.rides.findOneAndUpdate.mockResolvedValue({
      ...syntheticRide,
      status: RideStatus.Online,
    });

    await expect(
      service.setRideAvailability(driverReviewer, RideStatus.Online),
    ).resolves.toMatchObject({ status: RideStatus.Online });

    expect(db.rides.findOne).toHaveBeenCalledWith({
      approvalStatus: RideApprovalStatus.Approved,
      deleted: { $ne: true },
      driver: ownerId,
      status: { $in: [RideStatus.Online, RideStatus.Offline] },
      type: { $ne: RideType.Hire },
    });
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
  });

  it('automatically takes the currently online trip vehicle offline', async () => {
    db.rides.findOne.mockResolvedValue({
      ...syntheticRide,
      status: RideStatus.Online,
    });
    db.rides.findOneAndUpdate.mockResolvedValue({
      ...syntheticRide,
      status: RideStatus.Offline,
    });

    await expect(
      service.setRideAvailability(driverReviewer, RideStatus.Offline),
    ).resolves.toMatchObject({ status: RideStatus.Offline });

    expect(db.rides.findOne).toHaveBeenCalledWith({
      approvalStatus: RideApprovalStatus.Approved,
      deleted: { $ne: true },
      driver: ownerId,
      status: RideStatus.Online,
      type: { $ne: RideType.Hire },
    });
    expect(db.driverOnlineSessions.updateMany).toHaveBeenCalledWith(
      { driver: ownerId, endedAt: { $exists: false } },
      { $set: { endedAt: expect.any(Date) } },
    );
  });

  it('rejects automatic availability changes without an approved trip vehicle', async () => {
    db.rides.findOne.mockResolvedValue(null);

    await expect(
      service.setRideAvailability(driverReviewer, RideStatus.Online),
    ).rejects.toThrow('No approved trip vehicle found');

    expect(db.rides.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('generates a real socket offer only for the reusable review driver', async () => {
    db.rides.findOne.mockResolvedValue({
      ...syntheticRide,
      status: RideStatus.Online,
    });
    db.users.findOne.mockResolvedValue(riderReviewer);

    const result = await service.createReviewDemoOffer(driverReviewer);

    expect(result.trackingId).toMatch(/^review-/);
    expect(websocket.emitToUser).toHaveBeenCalledWith(
      driverReviewer,
      'RideRequest',
      expect.objectContaining({
        payload: expect.objectContaining({ amount: 0 }),
        user: riderReviewer,
      }),
    );
    expect(db.driverRideOffers.updateOne).toHaveBeenCalled();
  });

  it('accepts a generated offer as a zero-charge synthetic trip', async () => {
    const trackingId = 'review-offer-id';
    cache.get.mockImplementation((key: string) =>
      key === `review-offer:${trackingId}`
        ? Promise.resolve({
            driverId: ownerId,
            riderId,
            rideId,
            payload: {
              amount: 0,
              distance: 3200,
              fromAddress: 'Review pickup',
              fromLat: 9.0747,
              fromLon: 7.4951,
              paymentMethod: PaymentMethod.Cash,
              stops: [],
              toAddress: 'Review destination',
              toLat: 9.0667,
              toLon: 7.5008,
              type: RideType.Classic,
            },
          })
        : Promise.resolve(undefined),
    );
    db.users.findOne.mockResolvedValue(riderReviewer);
    db.rides.findOne.mockResolvedValue(syntheticRide);
    db.trips.create.mockResolvedValue({
      id: 'review-trip-id',
      toObject: () => ({ id: 'review-trip-id', status: 'Started' }),
    });

    const trip = await service.acceptRide(driverReviewer, { trackingId });

    expect(db.trips.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 0,
        meta: { playReviewSynthetic: true },
      }),
    );
    expect(trip).toMatchObject({ id: 'review-trip-id' });
    expect(
      (service as any).finance.canDriverReceiveRides,
    ).not.toHaveBeenCalled();
  });

  it('excludes synthetic vehicles from the public availability query', async () => {
    const sort = jest.fn().mockResolvedValue([]);
    const populate = jest.fn().mockReturnValue({ sort });
    db.rides.find.mockReturnValue({ populate });

    await service.getAvailableRides(riderReviewer, {
      lat: 9.0765,
      lon: 7.3986,
    });

    expect(db.rides.find).toHaveBeenCalledWith(
      expect.objectContaining({
        'specs.synthetic': { $ne: true },
      }),
    );
  });

  it('lists only approved vehicles in the requested category', async () => {
    db.rides.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    });

    await service.getAvailableRides(riderReviewer, {
      lat: 9.0765,
      lon: 7.3986,
      type: RideType.Luxury,
    });

    expect(db.rides.find).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalStatus: RideApprovalStatus.Approved,
        type: { $in: [RideType.Luxury] },
        $or: expect.arrayContaining([
          { vehicleCategory: { $in: [RideType.Luxury] } },
        ]),
      }),
    );
  });

  it('returns only synthetic hire vehicles to the reusable rider reviewer', async () => {
    db.rides.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    });

    await service.getAvailableRides(riderReviewer, {
      lat: 9.0765,
      lon: 7.3986,
      type: RideType.Hire,
    });

    expect(db.rides.find).toHaveBeenCalledWith(
      expect.objectContaining({
        'specs.synthetic': true,
        type: { $in: [RideType.Hire] },
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
      type: VehicleCategory.Classic,
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

  it('advances only the rider synthetic trip through the review lifecycle', async () => {
    const syntheticTrip = {
      driver: driverReviewer,
      id: 'synthetic-trip-id',
      meta: { playReviewSynthetic: true },
      status: 'Started',
      user: riderId,
    };
    db.trips.findOne.mockReturnValue(populatedQuery(syntheticTrip));
    const announceArrival = jest
      .spyOn(service, 'annouceArrival')
      .mockResolvedValue({
        ...syntheticTrip,
        status: 'DriverArrived',
      } as never);

    await expect(
      service.advancePlayReviewTrip(riderReviewer, syntheticTrip.id),
    ).resolves.toMatchObject({ status: 'DriverArrived' });
    expect(announceArrival).toHaveBeenCalledWith(
      driverReviewer,
      syntheticTrip.id,
    );
  });

  it('returns the latest review trip when a duplicate advance loses the status race', async () => {
    const startedTrip = {
      driver: driverReviewer,
      id: 'synthetic-trip-id',
      meta: { playReviewSynthetic: true },
      status: TripStatus.Started,
      user: riderId,
    };
    const arrivedTrip = {
      ...startedTrip,
      status: TripStatus.DriverArrived,
    };
    db.trips.findOne
      .mockReturnValueOnce(populatedQuery(startedTrip))
      .mockReturnValueOnce(populatedQuery(arrivedTrip));
    jest
      .spyOn(service, 'annouceArrival')
      .mockRejectedValue(new NotFoundException('trip not found'));

    await expect(
      service.advancePlayReviewTrip(riderReviewer, startedTrip.id),
    ).resolves.toMatchObject({ status: TripStatus.DriverArrived });
  });

  it('advances the complete rider demo lifecycle and leaves completion idempotent', async () => {
    const reviewTrip = {
      driver: driverReviewer,
      id: 'synthetic-trip-id',
      meta: { playReviewSynthetic: true },
      user: riderId,
    };
    db.trips.findOne
      .mockReturnValueOnce(
        populatedQuery({ ...reviewTrip, status: TripStatus.Started }),
      )
      .mockReturnValueOnce(
        populatedQuery({ ...reviewTrip, status: TripStatus.DriverArrived }),
      )
      .mockReturnValueOnce(
        populatedQuery({ ...reviewTrip, status: TripStatus.InProgress }),
      )
      .mockReturnValueOnce(
        populatedQuery({ ...reviewTrip, status: TripStatus.Completed }),
      );
    const announceArrival = jest
      .spyOn(service, 'annouceArrival')
      .mockResolvedValue({
        ...reviewTrip,
        status: TripStatus.DriverArrived,
      } as never);
    const startTrip = jest.spyOn(service, 'startTrip').mockResolvedValue({
      ...reviewTrip,
      status: TripStatus.InProgress,
    } as never);
    const endTrip = jest.spyOn(service, 'endTrip').mockResolvedValue({
      ...reviewTrip,
      status: TripStatus.Completed,
    } as never);

    await expect(
      service.advancePlayReviewTrip(riderReviewer, reviewTrip.id),
    ).resolves.toMatchObject({ status: TripStatus.DriverArrived });
    await expect(
      service.advancePlayReviewTrip(riderReviewer, reviewTrip.id),
    ).resolves.toMatchObject({ status: TripStatus.InProgress });
    await expect(
      service.advancePlayReviewTrip(riderReviewer, reviewTrip.id),
    ).resolves.toMatchObject({ status: TripStatus.Completed });
    await expect(
      service.advancePlayReviewTrip(riderReviewer, reviewTrip.id),
    ).resolves.toMatchObject({ status: TripStatus.Completed });

    expect(announceArrival).toHaveBeenCalledTimes(1);
    expect(startTrip).toHaveBeenCalledTimes(1);
    expect(endTrip).toHaveBeenCalledTimes(1);
  });

  it('advances a rider synthetic rental one valid status at a time', async () => {
    db.rentals.findOne.mockResolvedValue({
      id: rentalId,
      meta: { playReviewSynthetic: true },
      status: RentalStatus.Pending,
      user: riderId,
    });
    const updateRentalStatus = jest
      .spyOn(service, 'updateRentalStatus')
      .mockResolvedValue({
        id: rentalId,
        status: RentalStatus.Accepted,
      } as never);

    await expect(
      service.advancePlayReviewRental(riderReviewer, rentalId),
    ).resolves.toMatchObject({ status: RentalStatus.Accepted });
    expect(updateRentalStatus).toHaveBeenCalledWith(
      rentalId,
      RentalStatus.Accepted,
    );
  });

  it('creates a pending zero-charge synthetic hire without notifying the real owner', async () => {
    jest.spyOn(service, 'getOngoingRental').mockResolvedValue(null);
    const hireRide = {
      dailyRate: 50000,
      driver: ownerId,
      hourlyRate: 8000,
      id: rideId,
      insuranceFee: 500,
      specs: { synthetic: true },
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
      status: RentalStatus.Pending,
    });
    expect(db.rentals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cautionAmount: 0,
        driver: ownerId,
        hireFee: 0,
        insuranceFee: 0,
        price: 0,
        status: RentalStatus.Pending,
      }),
    );
    expect(paymentService.chargeUser).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
  });
});

describe('RidesService early rider trip completion', () => {
  const tripId = '64a000000000000000000005';
  const rider = { id: riderId } as any;
  const driver = { id: ownerId } as any;
  const ride = {
    id: rideId,
    location: {
      coordinates: [9.1, 7.4],
      recordedAt: new Date('2026-10-17T12:09:55.000Z'),
      type: 'Point',
    },
    type: RideType.Classic,
  } as any;
  let service: RidesService;
  let db: any;
  let paymentService: any;
  let websocket: any;
  let activityLedger: any;

  const makeTrip = () => ({
    distance: 20_000,
    driver,
    fare: {
      amount: 3000,
      baseFare: 500,
      commissionPercent: 20,
      distanceMeters: 20_000,
      durationSeconds: 1800,
      minimumFare: 700,
      perKm: 100,
      perMinute: 10,
      quotedAt: new Date('2026-10-17T11:55:00.000Z'),
      rideType: RideType.Classic,
    },
    from: { coordinates: [9.0, 7.3], type: 'Point' },
    id: tripId,
    meta: {},
    paymentMethod: PaymentMethod.RULBalance,
    ride,
    startedAt: new Date('2026-10-17T12:00:00.000Z'),
    status: TripStatus.InProgress,
    tripStops: [],
    user: rider,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-17T12:10:00.000Z'));
    db = {
      rides: {
        updateMany: jest.fn().mockResolvedValue(undefined),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
      trips: {
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
      },
    };
    paymentService = {
      chargeUser: jest.fn().mockResolvedValue({ reference: 'charge-1' }),
    };
    websocket = {
      emitToUser: jest.fn(),
      getLastRideLocation: jest.fn().mockReturnValue({
        accuracy: 8,
        lat: 9.1,
        lon: 7.4,
        recordedAt: '2026-10-17T12:09:58.000Z',
        tripId,
        updatedAt: '2026-10-17T12:09:58.000Z',
      }),
    };
    activityLedger = {
      formatAmountMeta: jest.fn().mockReturnValue('Total ₦1,100'),
      paymentActivityTitle: jest.fn().mockReturnValue('Ride payment'),
      recordActivity: jest.fn().mockResolvedValue(undefined),
      recordDriverEarning: jest.fn().mockResolvedValue(undefined),
    };
    service = Object.create(RidesService.prototype);
    Object.assign(service as any, {
      activityLedger,
      db,
      finance: {
        ensureDriverRestrictionState: jest
          .fn()
          .mockResolvedValue({ restricted: false }),
      },
      paymentService,
      pricing: { fareFor: jest.fn() },
      push: { sendToUser: jest.fn() },
      websocket,
    });
    jest
      .spyOn(service as any, 'openOnlineSession')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('ends an in-progress rider trip at the live driver location and charges a partial fare', async () => {
    const existing = makeTrip();
    const completed = {
      ...existing,
      endedEarly: true,
      meta: { amount: 1100, distance: 5000, durationSeconds: 600 },
      status: TripStatus.Completed,
    };
    db.trips.findOne.mockReturnValue(populatedQuery(existing));
    db.trips.findOneAndUpdate.mockResolvedValue(completed);
    jest.spyOn(GeolocationService, 'getRouteSummary').mockResolvedValue({
      distance: 5000,
      duration: 500,
    });

    await expect(
      service.cancelTrip(rider, tripId, 'User ended ride early'),
    ).resolves.toBe(completed);

    expect(GeolocationService.getRouteSummary).toHaveBeenCalledWith(
      [9.0, 7.3],
      [9.1, 7.4],
    );
    expect(paymentService.chargeUser).toHaveBeenCalledWith(rider, {
      amount: 1100,
      method: PaymentMethod.RULBalance,
    });
    expect(db.trips.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: tripId, status: TripStatus.InProgress },
      expect.objectContaining({
        $set: expect.objectContaining({
          endedBy: riderId,
          endedEarly: true,
          endLocation: expect.objectContaining({ coordinates: [9.1, 7.4] }),
          endReason: 'User ended ride early',
          status: TripStatus.Completed,
        }),
      }),
      { new: true, upsert: false },
    );
  });

  it('lets the driver end early with a pending stop and charges only the partial fare', async () => {
    const existing = {
      ...makeTrip(),
      tripStops: [
        {
          status: TripStopStatus.Pending,
          to: { coordinates: [9.2, 7.5], type: 'Point' },
          toAddress: 'Scheduled stop',
        },
      ],
    };
    const completed = {
      ...existing,
      endedEarly: true,
      meta: { amount: 1100, distance: 5000, durationSeconds: 600 },
      status: TripStatus.Completed,
    };
    db.trips.findOne.mockReturnValue(populatedQuery(existing));
    db.trips.findOneAndUpdate.mockResolvedValue(completed);
    jest.spyOn(GeolocationService, 'getRouteSummary').mockResolvedValue({
      distance: 5000,
      duration: 500,
    });

    await expect(
      service.cancelTrip(driver, tripId, 'Safety concern'),
    ).resolves.toBe(completed);

    expect(paymentService.chargeUser).toHaveBeenCalledWith(rider, {
      amount: 1100,
      method: PaymentMethod.RULBalance,
    });
    expect(db.trips.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: tripId, status: TripStatus.InProgress },
      expect.objectContaining({
        $set: expect.objectContaining({
          endedBy: ownerId,
          endedEarly: true,
          endReason: 'Safety concern',
          status: TripStatus.Completed,
        }),
      }),
      { new: true, upsert: false },
    );
  });

  it('ends a trip without a stop through the normal completion flow', async () => {
    const existing = makeTrip();
    db.findOrFail = jest.fn().mockResolvedValue(existing);
    const completeTrip = jest
      .spyOn(service as any, 'completeTrip')
      .mockResolvedValue({ ...existing, status: TripStatus.Completed });

    await service.endTrip(driver, tripId);

    expect(completeTrip).toHaveBeenCalledWith(existing, driver);
  });

  it('keeps the trip active when no fresh driver endpoint is available', async () => {
    db.trips.findOne.mockReturnValue(
      populatedQuery({
        ...makeTrip(),
        ride: {
          ...ride,
          location: {
            coordinates: [9.1, 7.4],
            recordedAt: new Date('2026-10-17T11:00:00.000Z'),
            type: 'Point',
          },
        },
      }),
    );
    websocket.getLastRideLocation.mockReturnValue(null);

    await expect(
      service.cancelTrip(rider, tripId, 'User ended ride early'),
    ).rejects.toThrow('Current driver location is unavailable');
    expect(paymentService.chargeUser).not.toHaveBeenCalled();
    expect(db.trips.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('prevents the driver from ending a trip before its scheduled stop', async () => {
    const trip = {
      ...makeTrip(),
      tripStops: [
        {
          status: TripStopStatus.Pending,
          to: { coordinates: [9.1, 7.4], type: 'Point' },
          toAddress: 'Stop address',
        },
      ],
    };
    db.findOrFail = jest.fn().mockResolvedValue(trip);

    await expect(service.endTrip(driver, tripId)).rejects.toThrow(
      'complete the scheduled stop before ending the trip',
    );
    expect(paymentService.chargeUser).not.toHaveBeenCalled();
  });

  it('completes the pending stop and broadcasts the updated trip', async () => {
    const trip = {
      ...makeTrip(),
      tripStops: [
        {
          status: TripStopStatus.Pending,
          to: { coordinates: [9.1, 7.4], type: 'Point' },
          toAddress: 'Stop address',
        },
      ],
    };
    const updatedTrip = {
      ...trip,
      tripStops: [{ ...trip.tripStops[0], status: TripStopStatus.Completed }],
    };
    db.findOrFail = jest.fn().mockResolvedValue(trip);
    db.findAndUpdateOrFail = jest.fn().mockResolvedValue(updatedTrip);

    await expect(service.completeTripStop(driver, tripId)).resolves.toBe(
      updatedTrip,
    );
    expect(db.findAndUpdateOrFail).toHaveBeenCalledWith(
      db.trips,
      { _id: tripId, driver: ownerId, status: TripStatus.InProgress },
      { $set: { 'tripStops.0.status': TripStopStatus.Completed } },
      expect.objectContaining({ options: { new: true, upsert: false } }),
    );
    expect(websocket.emitToUser).toHaveBeenCalledWith(
      rider,
      'TripInProgress',
      updatedTrip,
    );
    expect(websocket.emitToUser).toHaveBeenCalledWith(
      driver,
      'TripInProgress',
      updatedTrip,
    );
  });
});

describe('RidesService rider safety controls', () => {
  const driver = { id: ownerId } as never;
  const rider = { id: riderId } as never;
  const tripId = '64a000000000000000000005';
  const messageId = '64a000000000000000000006';
  let service: RidesService;
  let db: any;

  const tripQuery = (trip: unknown) => {
    const query: any = {
      populate: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(trip).then(resolve),
    };
    return query;
  };

  beforeEach(() => {
    db = {
      messages: {
        findOne: jest.fn().mockResolvedValue({ id: messageId }),
      },
      trips: {
        findOne: jest
          .fn()
          .mockReturnValue(tripQuery({ driver, id: tripId, user: rider })),
      },
      userBlocks: {
        findOneAndUpdate: jest.fn().mockResolvedValue({
          active: true,
          blocked: riderId,
          blocker: ownerId,
        }),
      },
      userReports: {
        create: jest.fn().mockImplementation(async (payload) => ({
          ...payload,
          id: '64a000000000000000000007',
        })),
      },
    };

    service = Object.create(RidesService.prototype);
    Object.assign(service as any, { db });
  });

  it('stores an auditable report and blocks the rider when requested', async () => {
    const result = await service.reportTripUser(driver, tripId, {
      blockUser: true,
      details: 'Threatening language in chat',
      messageId,
      reason: UserReportReason.AbusiveLanguage,
    });

    expect(db.messages.findOne).toHaveBeenCalledWith({
      _id: messageId,
      sender: riderId,
      trip: tripId,
    });
    expect(db.userBlocks.findOneAndUpdate).toHaveBeenCalledWith(
      { blocked: riderId, blocker: ownerId },
      expect.objectContaining({
        $set: { active: true, sourceTrip: tripId },
      }),
      expect.objectContaining({ new: true, upsert: true }),
    );
    expect(db.userReports.create).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedUser: true,
        message: messageId,
        reportedUser: riderId,
        reporter: ownerId,
        trip: tripId,
      }),
    );
    expect(result).toMatchObject({ blockedUser: true });
  });

  it('does not attach a message that was not sent by the reported rider', async () => {
    db.messages.findOne.mockResolvedValue(null);

    await expect(
      service.reportTripUser(driver, tripId, {
        messageId,
        reason: UserReportReason.Harassment,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(db.userReports.create).not.toHaveBeenCalled();
  });

  it('creates an idempotent future-matching block from a shared trip', async () => {
    await service.blockTripUser(driver, tripId);

    expect(db.userBlocks.findOneAndUpdate).toHaveBeenCalledWith(
      { blocked: riderId, blocker: ownerId },
      expect.objectContaining({
        $set: { active: true, sourceTrip: tripId },
      }),
      expect.objectContaining({ new: true, upsert: true }),
    );
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
    rides: { findOne: jest.Mock; updateOne: jest.Mock };
    trips: { create: jest.Mock };
    userBlocks: { exists: jest.Mock };
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
      rides: { findOne: jest.fn(), updateOne: jest.fn() },
      trips: { create: jest.fn() },
      userBlocks: { exists: jest.fn().mockResolvedValue(false) },
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
    const ride = {
      approvalStatus: RideApprovalStatus.Approved,
      driver,
      id: rideId,
      status: RideStatus.Online,
      type: RideType.Classic,
      vehicleCategory: VehicleCategory.Classic,
    } as never;
    db.rides.findOne.mockResolvedValue(ride);
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
      type: VehicleCategory.Classic,
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
    expect(websocket.emitToUser).not.toHaveBeenCalledWith(
      driver,
      'RideRequestExpired',
      expect.anything(),
    );
  });

  it('expires the driver request before telling the rider that drivers are busy', async () => {
    const ride = {
      approvalStatus: RideApprovalStatus.Approved,
      driver,
      id: rideId,
      status: RideStatus.Online,
      type: RideType.Classic,
      vehicleCategory: VehicleCategory.Classic,
    } as never;
    cache.get.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const internals = service as unknown as {
      recordRideOffer: () => Promise<void>;
      resolveRideOffer: () => Promise<void>;
    };
    jest.spyOn(internals, 'recordRideOffer').mockResolvedValue(undefined);
    jest.spyOn(internals, 'resolveRideOffer').mockResolvedValue(undefined);

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
      type: VehicleCategory.Classic,
    });

    expect(websocket.emitToUser).toHaveBeenCalledWith(
      driver,
      'RideRequest',
      expect.objectContaining({
        expiresAt: expect.any(String),
        trackingId: expect.any(String),
      }),
    );
    expect(websocket.emitToUser).toHaveBeenCalledWith(
      driver,
      'RideRequestExpired',
      expect.objectContaining({
        reason: 'timed_out',
        trackingId: expect.any(String),
      }),
    );
    expect(websocket.emitToUser).toHaveBeenCalledWith(
      rider,
      'DriversBusy',
      'All drivers are busy at this time',
    );

    const offerReadyCall = cache.set.mock.invocationCallOrder.find(
      (_, index) => cache.set.mock.calls[index][0] !== 'connection-id',
    );
    const rideRequestCall = websocket.emitToUser.mock.invocationCallOrder.find(
      (_, index) => websocket.emitToUser.mock.calls[index][1] === 'RideRequest',
    );
    const expiredCall = websocket.emitToUser.mock.invocationCallOrder.find(
      (_, index) =>
        websocket.emitToUser.mock.calls[index][1] === 'RideRequestExpired',
    );
    const driversBusyCall = websocket.emitToUser.mock.invocationCallOrder.find(
      (_, index) => websocket.emitToUser.mock.calls[index][1] === 'DriversBusy',
    );
    expect(offerReadyCall).toBeLessThan(rideRequestCall);
    expect(expiredCall).toBeLessThan(driversBusyCall);
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

describe('RidesService vehicle category review', () => {
  it('atomically approves an admin-selected category and writes an audit log', async () => {
    const admin = { id: '64a000000000000000000099' };
    const ride = {
      approvalStatus: RideApprovalStatus.Pending,
      claimedCategory: VehicleCategory.Classic,
      driver: ownerId,
      id: rideId,
      type: RideType.Classic,
    };
    const updated = {
      ...ride,
      approvalStatus: RideApprovalStatus.Approved,
      type: RideType.Luxury,
      vehicleCategory: VehicleCategory.Luxury,
    };
    const db = {
      adminAuditLogs: { create: jest.fn().mockResolvedValue(undefined) },
      rides: {
        findOne: jest.fn().mockResolvedValue(ride),
        findOneAndUpdate: jest.fn().mockResolvedValue(updated),
      },
    };
    const service = Object.create(RidesService.prototype);
    Object.assign(service, { db });

    await expect(
      service.setAdminFleetApproval(
        admin as never,
        rideId,
        RideApprovalStatus.Approved,
        VehicleCategory.Luxury,
      ),
    ).resolves.toMatchObject({
      type: RideType.Luxury,
      vehicleCategory: VehicleCategory.Luxury,
    });

    expect(db.rides.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: rideId },
      {
        $set: expect.objectContaining({
          approvalStatus: RideApprovalStatus.Approved,
          type: RideType.Luxury,
          vehicleCategory: VehicleCategory.Luxury,
        }),
      },
      { new: true },
    );
    expect(db.adminAuditLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: admin.id,
        meta: expect.objectContaining({
          claimedCategory: VehicleCategory.Classic,
          vehicleCategory: VehicleCategory.Luxury,
        }),
      }),
    );
  });

  it('does not approve a vehicle without an admin-selected category', async () => {
    const service = Object.create(RidesService.prototype);
    Object.assign(service, {
      db: {
        rides: {
          findOne: jest.fn().mockResolvedValue({
            claimedCategory: VehicleCategory.Classic,
            id: rideId,
            type: RideType.Classic,
          }),
        },
      },
    });

    await expect(
      service.setAdminFleetApproval(
        { id: ownerId } as never,
        rideId,
        RideApprovalStatus.Approved,
      ),
    ).rejects.toThrow('vehicle category is required');
  });
});

describe('RidesService car brand logos', () => {
  const logoId = '64a000000000000000000005';
  let service: RidesService;
  let db: any;

  beforeEach(() => {
    db = {
      carBrands: { find: jest.fn() },
      carBrandLogos: {
        create: jest.fn((doc) => Promise.resolve({ id: logoId, ...doc })),
        exists: jest.fn().mockResolvedValue(null),
        find: jest.fn(),
        findOneAndUpdate: jest.fn(),
      },
    };

    service = Object.create(RidesService.prototype);
    Object.assign(service as any, { db });
  });

  it('stores a normalized slug so brand names match regardless of spelling', async () => {
    await service.createCarBrandLogo({
      name: ' Mercedes-Benz ',
      logoUrl: 'https://cdn.example.com/mercedes.png',
    });

    expect(db.carBrandLogos.exists).toHaveBeenCalledWith({
      slug: 'mercedesbenz',
      deleted: { $ne: true },
    });
    expect(db.carBrandLogos.create).toHaveBeenCalledWith({
      name: 'Mercedes-Benz',
      slug: 'mercedesbenz',
      logoUrl: 'https://cdn.example.com/mercedes.png',
    });
  });

  it('rejects a logo for a brand that already has one', async () => {
    db.carBrandLogos.exists.mockResolvedValue({ _id: logoId });

    await expect(
      service.createCarBrandLogo({
        name: 'mercedes benz',
        logoUrl: 'https://cdn.example.com/mercedes.png',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.carBrandLogos.create).not.toHaveBeenCalled();
  });

  it('throws when updating a logo that does not exist', async () => {
    db.carBrandLogos.findOneAndUpdate.mockResolvedValue(null);

    await expect(
      service.updateCarBrandLogo(logoId, {
        name: 'Toyota',
        logoUrl: 'https://cdn.example.com/toyota.png',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attaches the matching logo url to each car brand by manufacturer', async () => {
    const brand = (manufacturer: string) => ({
      manufacturer,
      toJSON: () => ({ manufacturer, brand: 'Model', year: 2020 }),
    });
    db.carBrands.find.mockResolvedValue([
      brand('Mercedes-Benz'),
      brand('Toyota'),
    ]);
    db.carBrandLogos.find.mockResolvedValue([
      { slug: 'mercedesbenz', logoUrl: 'https://cdn.example.com/mercedes.png' },
    ]);

    const brands = await service.getCarBrands();

    expect(brands.map((item) => item.logoUrl)).toEqual([
      'https://cdn.example.com/mercedes.png',
      null,
    ]);
  });

  it('attaches the matching logo url to each rental brand', async () => {
    db.rides = {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce([
          { _id: 'mercedes benz', brand: 'mercedes benz', count: 2 },
        ])
        .mockResolvedValueOnce([{ _id: 'mercedes benz' }]),
    };
    db.carBrandLogos.find.mockResolvedValue([
      { slug: 'mercedesbenz', logoUrl: 'https://cdn.example.com/mercedes.png' },
    ]);

    const { data } = await service.getRentalCarBrands({});

    expect(data).toEqual([
      {
        _id: 'mercedes benz',
        brand: 'mercedes benz',
        count: 2,
        logoUrl: 'https://cdn.example.com/mercedes.png',
      },
    ]);
  });
});
