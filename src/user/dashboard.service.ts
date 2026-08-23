import { Injectable } from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import { ActivityDocument } from '../database/schemas/activities.schema';
import { TripDocument, TripStatus } from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';

const moment = require('moment');

const RUNNING_STATUSES = [
  TripStatus.Started,
  TripStatus.InProgress,
  TripStatus.DriverArrived,
];

const CANCELLED_STATUSES = [TripStatus.Cancelled, TripStatus.PaymentFailed];

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async getDashboard() {
    const notDeleted: FilterQuery<unknown> = { deleted: { $ne: true } };
    const startOfToday = moment().startOf('day').toDate();
    const startOfMonth = moment().startOf('month').toDate();

    const [
      totalRiders,
      driverIds,
      vehicleTypes,
      totalTrips,
      cancelledTrips,
      runningTrips,
      completedTrips,
      revenueAgg,
      recentTripDocs,
      dailyEarningsAgg,
      monthlyEarningsAgg,
      activityDocs,
    ] = await Promise.all([
      this.db.users.countDocuments(notDeleted),
      this.db.rides.distinct('driver', notDeleted),
      this.db.carBrands.countDocuments(notDeleted),
      this.db.trips.countDocuments(notDeleted),
      this.db.trips.countDocuments({
        ...notDeleted,
        status: { $in: CANCELLED_STATUSES },
      }),
      this.db.trips.countDocuments({
        ...notDeleted,
        status: { $in: RUNNING_STATUSES },
      }),
      this.db.trips.countDocuments({
        ...notDeleted,
        status: TripStatus.Completed,
      }),
      this.db.trips.aggregate<{ total: number; count: number }>([
        {
          $match: {
            deleted: { $ne: true },
            status: TripStatus.Completed,
            'meta.amount': { $type: 'number' },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$meta.amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.db.trips
        .find(notDeleted)
        .sort({ createdAt: -1 })
        .limit(12)
        .populate('user')
        .lean(),
      this.db.driverEarnings.aggregate<{ total: number }>([
        {
          $match: {
            deleted: { $ne: true },
            earnedAt: { $gte: startOfToday },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.db.driverEarnings.aggregate<{ total: number }>([
        {
          $match: {
            deleted: { $ne: true },
            earnedAt: { $gte: startOfMonth, $lt: startOfToday },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.db.activities
        .find(notDeleted)
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const revenueRow = revenueAgg[0];
    const revenue =
      revenueRow && revenueRow.count > 0 ? revenueRow.total : null;

    const dailyTotal = dailyEarningsAgg[0]?.total || 0;
    const monthlyTotal = monthlyEarningsAgg[0]?.total || 0;
    const mtdTotal = dailyTotal + monthlyTotal;
    const dailyPct = mtdTotal > 0 ? Math.round((100 * dailyTotal) / mtdTotal) : 0;
    const monthlyPct = mtdTotal > 0 ? 100 - dailyPct : 0;

    const recentRides = (recentTripDocs as TripDocument[]).map((trip, index) => {
      const user = trip.user as UserDocument | undefined;
      const name =
        [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
        user?.email ||
        'Unknown rider';

      return {
        id: String(trip._id ?? trip.id),
        index: index + 1,
        name,
        time: trip.createdAt ? moment(trip.createdAt).fromNow() : '',
        status: this.mapTripStatus(trip.status),
        createdAt: trip.createdAt
          ? new Date(trip.createdAt).toISOString()
          : null,
      };
    });

    const activity = (activityDocs as ActivityDocument[]).map((item) => ({
      id: String(item._id ?? item.id),
      type: item.type,
      title: item.title,
      meta: item.meta || null,
      amount: item.amount ?? null,
      createdAt: item.createdAt
        ? new Date(item.createdAt).toISOString()
        : null,
    }));

    return {
      site: {
        totalRiders,
        totalDrivers: driverIds.length,
        vehicleTypes,
        revenue,
        revenueChangePct: null,
      },
      rides: {
        total: totalTrips,
        cancelled: cancelledTrips,
        running: runningTrips,
        completed: completedTrips,
      },
      unallocated: {
        rideNow: null,
        rideLater: null,
      },
      recentRides,
      wages: {
        dailyTotal,
        monthlyTotal,
        dailyPct,
        monthlyPct,
        centerPct: dailyPct,
        hasData: mtdTotal > 0,
      },
      activity,
    };
  }

  private mapTripStatus(
    status?: TripStatus,
  ): 'complete' | 'pending' | 'cancelled' {
    if (status === TripStatus.Completed) {
      return 'complete';
    }
    if (
      status === TripStatus.Cancelled ||
      status === TripStatus.PaymentFailed
    ) {
      return 'cancelled';
    }
    return 'pending';
  }
}
