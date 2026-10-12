import { buildDashboardTrendPoints } from './dashboard.service';

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
