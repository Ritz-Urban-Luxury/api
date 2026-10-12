import {
  buildDashboardTrendPoints,
  DashboardService,
} from './dashboard.service';

describe('buildDashboardTrendPoints', () => {
  it('fills missing days and merges user, ride, and revenue metrics', () => {
    const points = buildDashboardTrendPoints(
      new Date('2026-09-13T23:00:00.000Z'),
      [
        { _id: { date: '2026-09-14', isDriver: false }, count: 4 },
        { _id: { date: '2026-09-14', isDriver: true }, count: 2 },
      ],
      [
        {
          _id: '2026-09-14',
          requestedRides: 8,
          completedRides: 5,
          cancelledRides: 1,
          revenue: 12500,
        },
      ],
    );

    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({
      date: '2026-09-14',
      newRiders: 4,
      newDrivers: 2,
      requestedRides: 8,
      completedRides: 5,
      cancelledRides: 1,
      revenue: 12500,
    });
    expect(points[1]).toEqual({
      date: '2026-09-15',
      newRiders: 0,
      newDrivers: 0,
      requestedRides: 0,
      completedRides: 0,
      cancelledRides: 0,
      revenue: 0,
    });
  });
});

describe('DashboardService.getAttention', () => {
  it('counts the work waiting on an admin with the same filters as each list', async () => {
    const count = (n: number) => jest.fn().mockResolvedValue(n);
    const db = {
      users: { countDocuments: count(3) },
      rentals: { countDocuments: count(2) },
      rides: {
        distinct: jest.fn().mockResolvedValue(['driver-1']),
        countDocuments: jest
          .fn()
          .mockResolvedValueOnce(4)
          .mockResolvedValueOnce(1),
      },
      userReports: { countDocuments: count(5) },
      payoutRequests: { countDocuments: count(6) },
    };
    const service = new DashboardService(db as never);

    await expect(service.getAttention()).resolves.toEqual({
      pendingDrivers: 3,
      pendingRentals: 2,
      pendingTripVehicles: 4,
      pendingHireCars: 1,
      openReports: 5,
      pendingPayouts: 6,
    });
    expect(db.users.countDocuments).toHaveBeenCalledWith({
      deleted: { $ne: true },
      $or: [{ isDriver: true }, { _id: { $in: ['driver-1'] } }],
      isVerified: { $ne: true },
    });
    expect(db.rides.countDocuments).toHaveBeenNthCalledWith(1, {
      deleted: { $ne: true },
      type: { $in: ['Classic', 'Luxury'] },
      approvalStatus: 'Pending',
    });
  });
});
