import { Injectable } from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import * as moment from 'moment';
import { DatabaseService } from '../database/database.service';
import { ActivityDocument } from '../database/schemas/activities.schema';
import { TripDocument, TripStatus } from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';

const RUNNING_STATUSES = [
  TripStatus.Started,
  TripStatus.InProgress,
  TripStatus.DriverArrived,
];

const CANCELLED_STATUSES = [TripStatus.Cancelled, TripStatus.PaymentFailed];

const DASHBOARD_TIMEZONE = '+01:00';
const DASHBOARD_RANGE_DAYS = 30;

type UserTrendRow = {
  _id: { date: string; isDriver: boolean };
  count: number;
};

type TripTrendRow = {
  _id: string;
  requestedRides: number;
  completedRides: number;
  cancelledRides: number;
  revenue: number;
};

export type DashboardTrendPoint = {
  date: string;
  newRiders: number;
  newDrivers: number;
  requestedRides: number;
  completedRides: number;
  cancelledRides: number;
  revenue: number;
};

export const buildDashboardTrendPoints = (
  startDate: Date,
  userRows: UserTrendRow[],
  tripRows: TripTrendRow[],
): DashboardTrendPoint[] => {
  const points = new Map<string, DashboardTrendPoint>();

  for (let day = 0; day < DASHBOARD_RANGE_DAYS; day += 1) {
    const date = moment(startDate)
      .utcOffset(60)
      .add(day, 'days')
      .format('YYYY-MM-DD');
    points.set(date, {
      date,
      newRiders: 0,
      newDrivers: 0,
      requestedRides: 0,
      completedRides: 0,
      cancelledRides: 0,
      revenue: 0,
    });
  }

  userRows.forEach((row) => {
    const point = points.get(row._id.date);
    if (!point) return;
    if (row._id.isDriver) point.newDrivers += row.count;
    else point.newRiders += row.count;
  });

  tripRows.forEach((row) => {
    const point = points.get(row._id);
    if (!point) return;
    point.requestedRides = row.requestedRides;
    point.completedRides = row.completedRides;
    point.cancelledRides = row.cancelledRides;
    point.revenue = row.revenue;
  });

  return Array.from(points.values());
};

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async getDashboard() {
    const notDeleted: FilterQuery<unknown> = { deleted: { $ne: true } };
    const startOfToday = moment().startOf('day').toDate();
    const startOfMonth = moment().startOf('month').toDate();
    const startOfPreviousMonth = moment()
      .subtract(1, 'month')
      .startOf('month')
      .toDate();
    const trendStartDate = moment()
      .utcOffset(60)
      .startOf('day')
      .subtract(DASHBOARD_RANGE_DAYS - 1, 'days')
      .toDate();

    const [
      totalRiders,
      totalDrivers,
      vehicleTypes,
      totalTrips,
      cancelledTrips,
      runningTrips,
      completedTrips,
      revenueAgg,
      currentMonthRevenueAgg,
      previousMonthRevenueAgg,
      recentTripDocs,
      dailyEarningsAgg,
      monthlyEarningsAgg,
      activityDocs,
      userTrendRows,
      tripTrendRows,
    ] = await Promise.all([
      this.db.users.countDocuments({
        ...notDeleted,
        isDriver: { $ne: true },
        isAppAdmin: { $ne: true },
      }),
      this.db.users.countDocuments({ ...notDeleted, isDriver: true }),
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
            amount: { $type: 'number' },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.db.trips.aggregate<{ total: number }>([
        {
          $match: {
            deleted: { $ne: true },
            status: TripStatus.Completed,
            amount: { $type: 'number' },
            createdAt: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.db.trips.aggregate<{ total: number }>([
        {
          $match: {
            deleted: { $ne: true },
            status: TripStatus.Completed,
            amount: { $type: 'number' },
            createdAt: { $gte: startOfPreviousMonth, $lt: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
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
      this.db.users.aggregate<UserTrendRow>([
        {
          $match: {
            ...notDeleted,
            isAppAdmin: { $ne: true },
            createdAt: { $gte: trendStartDate },
          },
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: {
                  date: '$createdAt',
                  format: '%Y-%m-%d',
                  timezone: DASHBOARD_TIMEZONE,
                },
              },
              isDriver: { $eq: ['$isDriver', true] },
            },
            count: { $sum: 1 },
          },
        },
      ]),
      this.db.trips.aggregate<TripTrendRow>([
        {
          $match: {
            ...notDeleted,
            createdAt: { $gte: trendStartDate },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                date: '$createdAt',
                format: '%Y-%m-%d',
                timezone: DASHBOARD_TIMEZONE,
              },
            },
            requestedRides: { $sum: 1 },
            completedRides: {
              $sum: {
                $cond: [{ $eq: ['$status', TripStatus.Completed] }, 1, 0],
              },
            },
            cancelledRides: {
              $sum: {
                $cond: [{ $in: ['$status', CANCELLED_STATUSES] }, 1, 0],
              },
            },
            revenue: {
              $sum: {
                $cond: [
                  { $eq: ['$status', TripStatus.Completed] },
                  { $ifNull: ['$amount', 0] },
                  0,
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const revenueRow = revenueAgg[0];
    const revenue =
      revenueRow && revenueRow.count > 0 ? revenueRow.total : null;
    const currentMonthRevenue = currentMonthRevenueAgg[0]?.total || 0;
    const previousMonthRevenue = previousMonthRevenueAgg[0]?.total || 0;
    let revenueChangePct = 0;
    if (previousMonthRevenue > 0) {
      revenueChangePct = Math.round(
        ((currentMonthRevenue - previousMonthRevenue) /
          previousMonthRevenue) *
          100,
      );
    } else if (currentMonthRevenue > 0) {
      revenueChangePct = 100;
    }

    const dailyTotal = dailyEarningsAgg[0]?.total || 0;
    const monthlyTotal = monthlyEarningsAgg[0]?.total || 0;
    const mtdTotal = dailyTotal + monthlyTotal;
    const dailyPct =
      mtdTotal > 0 ? Math.round((100 * dailyTotal) / mtdTotal) : 0;
    const monthlyPct = mtdTotal > 0 ? 100 - dailyPct : 0;

    const recentRides = (recentTripDocs as TripDocument[]).map(
      (trip, index) => {
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
      },
    );

    const activity = (activityDocs as ActivityDocument[]).map((item) => ({
      id: String(item._id ?? item.id),
      type: item.type,
      title: item.title,
      meta: item.meta || null,
      amount: item.amount ?? null,
      createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
    }));
    const trendPoints = buildDashboardTrendPoints(
      trendStartDate,
      userTrendRows,
      tripTrendRows,
    );

    return {
      site: {
        totalRiders,
        totalDrivers,
        vehicleTypes,
        revenue,
        revenueChangePct,
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
      trends: {
        rangeDays: DASHBOARD_RANGE_DAYS,
        timezone: 'Africa/Lagos',
        points: trendPoints,
      },
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
