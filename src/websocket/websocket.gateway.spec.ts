import { AuthenticationService } from '../authentication';
import { DatabaseService } from '../database/database.service';
import { RideStatus, RidesDocument } from '../database/schemas/rides.schema';
import { TripDocument, TripStatus } from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { Logger } from '../logger/logger.service';
import { WebsocketGateway } from './websocket.gateway';
import { WebsocketEvent } from './types';

describe('WebsocketGateway', () => {
  const driver = { id: 'driver-id' } as UserDocument;
  const rider = { id: 'rider-id' } as UserDocument;
  const ride = { id: 'ride-id' } as RidesDocument;
  const findOneAndUpdate = jest.fn();
  const findOne = jest.fn();
  const updateOne = jest.fn();
  const db = {
    rides: {
      findOneAndUpdate,
      updateOne,
    },
    trips: {
      findOne,
    },
  } as unknown as DatabaseService;
  let gateway: WebsocketGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    findOneAndUpdate.mockResolvedValue(ride);
    gateway = new WebsocketGateway(
      {} as AuthenticationService,
      {} as Logger,
      db,
    );
  });

  describe('updateRideLocation', () => {
    it('stores and emits the driver location to the active trip rider', async () => {
      const trip = {
        id: 'trip-id',
        ride: ride.id,
        status: TripStatus.Started,
        user: rider,
      } as TripDocument;
      const populate = jest.fn().mockResolvedValue(trip);
      findOne.mockReturnValue({ populate });
      const emitToUser = jest
        .spyOn(gateway, 'emitToUser')
        .mockResolvedValue(undefined);

      await gateway.updateRideLocation(driver, {
        accuracy: 8,
        heading: 90,
        lat: 9.067114,
        lon: 7.397462,
        recordedAt: '2026-07-31T15:00:00.000Z',
        sequence: 100,
        speed: 12,
      });

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { driver: driver.id },
        {
          $set: {
            location: {
              accuracy: 8,
              coordinates: [9.067114, 7.397462],
              heading: 90,
              recordedAt: new Date('2026-07-31T15:00:00.000Z'),
              sequence: 100,
              speed: 12,
              type: 'Point',
            },
          },
        },
        { new: true },
      );
      expect(findOne).toHaveBeenCalledWith({
        driver: driver.id,
        status: {
          $nin: [
            TripStatus.Cancelled,
            TripStatus.Completed,
            TripStatus.PaymentFailed,
          ],
        },
        deleted: { $ne: true },
      });
      expect(populate).toHaveBeenCalledWith('user');
      expect(emitToUser).toHaveBeenCalledWith(
        rider,
        WebsocketEvent.RideLocation,
        {
          accuracy: 8,
          tripId: 'trip-id',
          rideId: ride.id,
          lat: 9.067114,
          lon: 7.397462,
          heading: 90,
          recordedAt: '2026-07-31T15:00:00.000Z',
          sequence: 100,
          speed: 12,
          updatedAt: expect.any(String),
        },
      );
    });

    it('stores the location without emitting when there is no active trip', async () => {
      const populate = jest.fn().mockResolvedValue(null);
      findOne.mockReturnValue({ populate });
      const emitToUser = jest
        .spyOn(gateway, 'emitToUser')
        .mockResolvedValue(undefined);

      await gateway.updateRideLocation(driver, {
        lat: 9.067114,
        lon: 7.397462,
      });

      expect(findOneAndUpdate).toHaveBeenCalled();
      expect(emitToUser).not.toHaveBeenCalled();
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('marks an in-progress ride as finishing when it is near the destination', async () => {
      const trip = {
        id: 'trip-id',
        nextDestination: {
          to: {
            coordinates: [9.0672, 7.3975],
            type: 'Point',
          },
          toAddress: 'Destination',
        },
        ride: ride.id,
        status: TripStatus.InProgress,
        user: rider,
      } as TripDocument;
      const populate = jest.fn().mockResolvedValue(trip);
      findOne.mockReturnValue({ populate });
      jest.spyOn(gateway, 'emitToUser').mockResolvedValue(undefined);

      await gateway.updateRideLocation(driver, {
        lat: 9.067114,
        lon: 7.397462,
      });

      expect(updateOne).toHaveBeenCalledWith(
        { _id: ride.id },
        { $set: { status: RideStatus.FinishingTrip } },
      );
    });

    it('drops stale location sequences', async () => {
      const trip = {
        id: 'trip-id',
        ride: ride.id,
        status: TripStatus.Started,
        user: rider,
      } as TripDocument;
      const populate = jest.fn().mockResolvedValue(trip);
      findOne.mockReturnValue({ populate });
      const emitToUser = jest
        .spyOn(gateway, 'emitToUser')
        .mockResolvedValue(undefined);

      await gateway.updateRideLocation(driver, {
        lat: 9.067114,
        lon: 7.397462,
        sequence: 20,
      });
      await gateway.updateRideLocation(driver, {
        lat: 9.067,
        lon: 7.397,
        sequence: 19,
      });

      expect(emitToUser).toHaveBeenCalledTimes(1);
      expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('emits every fresh sample while throttling persistence', async () => {
      const trip = {
        id: 'trip-id',
        ride: ride.id,
        status: TripStatus.Started,
        user: rider,
      } as TripDocument;
      const populate = jest.fn().mockResolvedValue(trip);
      findOne.mockReturnValue({ populate });
      const emitToUser = jest
        .spyOn(gateway, 'emitToUser')
        .mockResolvedValue(undefined);

      await gateway.updateRideLocation(driver, {
        lat: 9.067114,
        lon: 7.397462,
        sequence: 30,
      });
      await gateway.updateRideLocation(driver, {
        lat: 9.0672,
        lon: 7.3975,
        sequence: 31,
      });

      expect(emitToUser).toHaveBeenCalledTimes(2);
      expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
