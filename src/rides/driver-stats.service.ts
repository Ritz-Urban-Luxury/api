import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { ActivityLedgerService } from '../database/activity-ledger.service';
import { DatabaseService } from '../database/database.service';
import { RideOfferOutcome } from '../database/schemas/driver-ride-offer.schema';
import {
  PaymentMethod,
  TripStatus,
} from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';

const SCORE_WINDOW = 100;
const OFFER_WINDOW = 100;
const COACHING_THRESHOLD = 69;
const SUSPENSION_THRESHOLD = 27;

type TimeRange = 'daily' | 'weekly' | 'monthly';
type ActivityPeriod = 'week' | 'months';

type EarningsRow = {
  amount: number;
  grossAmount?: number;
  commissionAmount?: number;
  paymentMethod?: string;
  earnedAt: Date;
};

@Injectable()
export class DriverStatsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly activityLedger: ActivityLedgerService,
  ) {}

  private driverOid(driver: UserDocument | string) {
    const id = typeof driver === 'string' ? driver : driver.id;
    return new Types.ObjectId(id);
  }

  private startOfDay(date: Date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDay(date: Date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private startOfWeek(date: Date) {
    const start = this.startOfDay(date);
    const day = start.getDay();
    const distanceFromMonday = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - distanceFromMonday);
    return start;
  }

  private addDays(date: Date, days: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private parsePeriod(timeRange: TimeRange, period?: string) {
    const now = new Date();
    const key = period || this.defaultPeriod(timeRange);

    if (timeRange === 'daily') {
      if (key === 'today') {
        const start = this.startOfDay(now);
        return { start, end: this.endOfDay(now), key, isCurrent: true };
      }
      if (key.startsWith('day-')) {
        const start = this.startOfDay(new Date(key.slice(4)));
        return { start, end: this.endOfDay(start), key, isCurrent: false };
      }
      const start = this.startOfDay(now);
      return { start, end: this.endOfDay(now), key: 'today', isCurrent: true };
    }

    if (timeRange === 'monthly') {
      if (key === 'current-month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
          start: this.startOfDay(start),
          end: this.endOfDay(now),
          key,
          isCurrent: true,
        };
      }
      if (key === 'last-month') {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return {
          start: this.startOfDay(start),
          end: this.endOfDay(end),
          key,
          isCurrent: false,
        };
      }
      if (key.startsWith('month-')) {
        const start = this.startOfDay(new Date(key.slice(6)));
        const end = this.addDays(start, 29);
        return { start, end: this.endOfDay(end), key, isCurrent: false };
      }
    }

    // weekly
    if (key === 'current-week') {
      const start = this.startOfWeek(now);
      return { start, end: this.endOfDay(now), key, isCurrent: true };
    }
    if (key === 'last-week') {
      const start = this.addDays(this.startOfWeek(now), -7);
      const end = this.addDays(start, 6);
      return { start, end: this.endOfDay(end), key, isCurrent: false };
    }
    if (key.startsWith('week-')) {
      const start = this.startOfDay(new Date(key.slice(5)));
      const end = this.addDays(start, 6);
      return { start, end: this.endOfDay(end), key, isCurrent: false };
    }

    const start = this.startOfWeek(now);
    return {
      start,
      end: this.endOfDay(now),
      key: 'current-week',
      isCurrent: true,
    };
  }

  private defaultPeriod(timeRange: TimeRange) {
    if (timeRange === 'daily') return 'today';
    if (timeRange === 'monthly') return 'current-month';
    return 'current-week';
  }

  /** Normalize legacy gross-only rows to net + commission. */
  normalizeEarning(row: EarningsRow) {
    const rate = this.activityLedger.commissionRate();
    if (
      Number.isFinite(row.commissionAmount) &&
      Number.isFinite(row.grossAmount)
    ) {
      return {
        net: row.amount,
        gross: row.grossAmount as number,
        commission: row.commissionAmount as number,
        paymentMethod: row.paymentMethod,
        earnedAt: row.earnedAt,
      };
    }
    // Legacy: amount was full fare
    const gross = row.grossAmount ?? row.amount;
    const commission =
      Math.round(gross * rate * 100) / 100;
    const net = Math.round((gross - commission) * 100) / 100;
    return {
      net,
      gross,
      commission,
      paymentMethod: row.paymentMethod,
      earnedAt: row.earnedAt,
    };
  }

  async getSummary(driver: UserDocument) {
    const driverId = this.driverOid(driver);
    const start = this.startOfDay(new Date());

    const [todayRows, acceptance, score] = await Promise.all([
      this.db.driverEarnings
        .find({
          driver: driverId,
          deleted: { $ne: true },
          earnedAt: { $gte: start },
        })
        .lean<EarningsRow[]>(),
      this.computeAcceptanceRate(driverId),
      this.computeDriverScore(driverId),
    ]);

    const todayEarnings = todayRows.reduce(
      (sum, row) => sum + this.normalizeEarning(row).net,
      0,
    );

    return {
      todayEarnings: Math.round(todayEarnings * 100) / 100,
      acceptanceRate: acceptance.rate,
      driverScore: score.score,
    };
  }

  async getEarnings(
    driver: UserDocument,
    timeRange: TimeRange = 'weekly',
    period?: string,
  ) {
    const driverId = this.driverOid(driver);
    const { start, end, key, isCurrent } = this.parsePeriod(timeRange, period);

    const [earningRows, ledgerAgg, balanceAgg] = await Promise.all([
      this.db.driverEarnings
        .find({
          driver: driverId,
          deleted: { $ne: true },
          earnedAt: { $gte: start, $lte: end },
        })
        .lean<EarningsRow[]>(),
      this.db.driverLedgerEntries.aggregate<{ total: number }>([
        {
          $match: {
            driver: driverId,
            deleted: { $ne: true },
            earnedAt: { $gte: start, $lte: end },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.db.driverLedgerEntries.aggregate<{ total: number }>([
        {
          $match: {
            driver: driverId,
            deleted: { $ne: true },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const normalized = earningRows.map((row) => this.normalizeEarning(row));
    let cashGross = 0;
    let inAppGross = 0;
    let commission = 0;
    let totalGross = 0;
    let totalNet = 0;

    for (const row of normalized) {
      totalGross += row.gross;
      totalNet += row.net;
      commission += row.commission;
      if (row.paymentMethod === PaymentMethod.Cash) {
        cashGross += row.gross;
      } else {
        inAppGross += row.gross;
      }
    }

    const bars = this.buildEarningsBars(normalized, timeRange, start, end);
    const periodCommissionOwed = ledgerAgg[0]?.total || 0;
    const balanceOwed = balanceAgg[0]?.total || 0;

    return {
      timeRange,
      period: key,
      isCurrent,
      start: start.toISOString(),
      end: end.toISOString(),
      totalEarnings: Math.round(totalGross * 100) / 100,
      expenses: Math.round(commission * 100) / 100,
      net: Math.round(totalNet * 100) / 100,
      breakdown: {
        inApp: Math.round(inAppGross * 100) / 100,
        cash: Math.round(cashGross * 100) / 100,
        compensatedCashDiscount: 0,
        rulCommission: Math.round(commission * 100) / 100,
        bookingFees: 0,
      },
      bars,
      balance: {
        owed: Math.round(balanceOwed * 100) / 100,
        periodChange: Math.round(periodCommissionOwed * 100) / 100,
        starting: Math.round((balanceOwed - periodCommissionOwed) * 100) / 100,
        ending: Math.round(balanceOwed * 100) / 100,
      },
    };
  }

  private buildEarningsBars(
    rows: ReturnType<DriverStatsService['normalizeEarning']>[],
    timeRange: TimeRange,
    start: Date,
    end: Date,
  ) {
    if (timeRange === 'daily') {
      const earnings = rows.reduce((s, r) => s + r.net, 0);
      const expenses = rows.reduce((s, r) => s + r.commission, 0);
      return [
        {
          label: 'Day',
          earnings: Math.round(earnings * 100) / 100,
          expenses: Math.round(expenses * 100) / 100,
        },
      ];
    }

    if (timeRange === 'monthly') {
      const buckets = [
        { label: 'W1', earnings: 0, expenses: 0 },
        { label: 'W2', earnings: 0, expenses: 0 },
        { label: 'W3', earnings: 0, expenses: 0 },
        { label: 'W4', earnings: 0, expenses: 0 },
      ];
      const span = Math.max(1, end.getTime() - start.getTime());
      for (const row of rows) {
        const t = new Date(row.earnedAt).getTime() - start.getTime();
        const idx = Math.min(3, Math.floor((t / span) * 4));
        buckets[idx].earnings += row.net;
        buckets[idx].expenses += row.commission;
      }
      return buckets.map((b) => ({
        label: b.label,
        earnings: Math.round(b.earnings * 100) / 100,
        expenses: Math.round(b.expenses * 100) / 100,
      }));
    }

    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const buckets = labels.map((label) => ({
      label,
      earnings: 0,
      expenses: 0,
    }));
    for (const row of rows) {
      const d = new Date(row.earnedAt);
      const day = d.getDay();
      const idx = day === 0 ? 6 : day - 1;
      buckets[idx].earnings += row.net;
      buckets[idx].expenses += row.commission;
    }
    return buckets.map((b) => ({
      label: b.label,
      earnings: Math.round(b.earnings * 100) / 100,
      expenses: Math.round(b.expenses * 100) / 100,
    }));
  }

  async getScore(driver: UserDocument) {
    const driverId = this.driverOid(driver);
    return this.computeDriverScore(driverId);
  }

  private async computeAcceptanceRate(driverId: Types.ObjectId) {
    const offers = await this.db.driverRideOffers
      .find({
        driver: driverId,
        deleted: { $ne: true },
        outcome: {
          $in: [RideOfferOutcome.Accepted, RideOfferOutcome.TimedOut],
        },
      })
      .sort({ offeredAt: -1 })
      .limit(OFFER_WINDOW)
      .lean();

    if (!offers.length) {
      return { rate: 100, accepted: 0, timedOut: 0, sampleSize: 0 };
    }

    const accepted = offers.filter(
      (o) => o.outcome === RideOfferOutcome.Accepted,
    ).length;
    const timedOut = offers.length - accepted;
    const rate = Math.round((accepted / offers.length) * 100);
    return { rate, accepted, timedOut, sampleSize: offers.length };
  }

  private async computeDriverScore(driverId: Types.ObjectId) {
    const trips = await this.db.trips
      .find({
        driver: driverId,
        deleted: { $ne: true },
      })
      .sort({ createdAt: -1 })
      .limit(SCORE_WINDOW)
      .lean();

    const pads = Math.max(0, SCORE_WINDOW - trips.length);
    let riderCancelled = 0;
    let driverRequestedCancel = 0;
    let driverCancelledBeforePickup = 0;
    let lowRating = 0;
    let bad = 0;

    for (const trip of trips) {
      let isBad = false;
      if (trip.status === TripStatus.Cancelled && trip.cancelledBy) {
        const byDriver = String(trip.cancelledBy) === String(driverId);
        if (byDriver) {
          const reason = (trip.cancellationReason || '').toLowerCase();
          if (reason.includes('request') || reason.includes('ask')) {
            driverRequestedCancel += 1;
          } else {
            driverCancelledBeforePickup += 1;
          }
          isBad = true;
        } else {
          riderCancelled += 1;
          isBad = true;
        }
      }
      if (
        trip.rating &&
        typeof trip.rating.rating === 'number' &&
        trip.rating.rating <= 2
      ) {
        lowRating += 1;
        isBad = true;
      }
      if (isBad) bad += 1;
    }

    const good = pads + (trips.length - bad);
    const score = Math.round((good / SCORE_WINDOW) * 100);
    const denom = SCORE_WINDOW;

    return {
      score,
      coachingThreshold: COACHING_THRESHOLD,
      suspensionThreshold: SUSPENSION_THRESHOLD,
      sampleSize: trips.length,
      breakdown: {
        riderCancelled: Math.round((riderCancelled / denom) * 100),
        youRequestedCancellation: Math.round(
          (driverRequestedCancel / denom) * 100,
        ),
        youCancelledBeforePickup: Math.round(
          (driverCancelledBeforePickup / denom) * 100,
        ),
        lowRating: Math.round((lowRating / denom) * 100),
      },
    };
  }

  async getActivity(driver: UserDocument, period: ActivityPeriod = 'week') {
    const driverId = this.driverOid(driver);
    const now = new Date();
    let start: Date;
    let end = this.endOfDay(now);

    if (period === 'week') {
      start = this.startOfWeek(now);
    } else {
      start = this.startOfDay(this.addDays(now, -90));
    }

    const [
      sessions,
      trips,
      offers,
      cancelledTrips,
      acceptance,
    ] = await Promise.all([
      this.db.driverOnlineSessions
        .find({
          driver: driverId,
          deleted: { $ne: true },
          startedAt: { $lte: end },
          $or: [{ endedAt: { $exists: false } }, { endedAt: { $gte: start } }],
        })
        .lean(),
      this.db.trips
        .find({
          driver: driverId,
          deleted: { $ne: true },
          status: TripStatus.Completed,
          startedAt: { $exists: true },
          endedAt: { $gte: start, $lte: end },
        })
        .lean(),
      this.db.driverRideOffers
        .find({
          driver: driverId,
          deleted: { $ne: true },
          offeredAt: { $gte: start, $lte: end },
        })
        .lean(),
      this.db.trips
        .find({
          driver: driverId,
          deleted: { $ne: true },
          status: TripStatus.Cancelled,
          createdAt: { $gte: start, $lte: end },
        })
        .lean(),
      this.computeAcceptanceRate(driverId),
    ]);

    const waitingMs = this.sumSessionMs(sessions, start, end);
    const drivingMs = trips.reduce((sum, trip) => {
      if (!trip.startedAt || !trip.endedAt) return sum;
      const s = Math.max(new Date(trip.startedAt).getTime(), start.getTime());
      const e = Math.min(new Date(trip.endedAt).getTime(), end.getTime());
      return sum + Math.max(0, e - s);
    }, 0);

    const hoursSeries =
      period === 'week'
        ? this.weekHourBars(sessions, trips, start)
        : this.monthHourBars(sessions, trips, start, end);

    const received = offers.length;
    const accepted = offers.filter(
      (o) => o.outcome === RideOfferOutcome.Accepted,
    ).length;

    const cancelReasons = this.buildCancelReasons(
      offers,
      cancelledTrips as Array<{
        cancelledBy?: string;
        cancellationReason?: string;
      }>,
      driverId,
    );

    const periodLabel =
      period === 'week'
        ? this.formatRangeLabel(start, this.addDays(start, 6))
        : this.formatRangeLabel(start, end);

    return {
      period,
      periodLabel,
      inactivePeriodLabel: this.formatRangeLabel(
        this.addDays(start, period === 'week' ? -7 : -90),
        this.addDays(start, -1),
      ),
      hours: {
        waitingMs,
        drivingMs,
        totalMs: waitingMs + drivingMs,
        waitingLabel: this.formatDuration(waitingMs),
        drivingLabel: this.formatDuration(drivingMs),
        totalLabel: this.formatDuration(waitingMs + drivingMs),
        series: hoursSeries,
      },
      rides: {
        received,
        accepted,
        series:
          period === 'week'
            ? this.weekRideBars(offers, start)
            : this.monthRideBars(offers, start, end),
      },
      cancels: cancelReasons,
      acceptanceRate: acceptance.rate,
    };
  }

  private sumSessionMs(
    sessions: { startedAt: Date; endedAt?: Date }[],
    start: Date,
    end: Date,
  ) {
    const now = Date.now();
    return sessions.reduce((sum, session) => {
      const s = Math.max(new Date(session.startedAt).getTime(), start.getTime());
      const e = Math.min(
        session.endedAt ? new Date(session.endedAt).getTime() : now,
        end.getTime(),
      );
      return sum + Math.max(0, e - s);
    }, 0);
  }

  private weekHourBars(
    sessions: { startedAt: Date; endedAt?: Date }[],
    trips: { startedAt?: Date; endedAt?: Date }[],
    weekStart: Date,
  ) {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return labels.map((label, idx) => {
      const dayStart = this.addDays(weekStart, idx);
      const dayEnd = this.endOfDay(dayStart);
      const waitingMs = this.sumSessionMs(sessions, dayStart, dayEnd);
      const drivingMs = trips.reduce((sum, trip) => {
        if (!trip.startedAt || !trip.endedAt) return sum;
        const s = Math.max(
          new Date(trip.startedAt).getTime(),
          dayStart.getTime(),
        );
        const e = Math.min(new Date(trip.endedAt).getTime(), dayEnd.getTime());
        return sum + Math.max(0, e - s);
      }, 0);
      const totalMs = waitingMs + drivingMs;
      return {
        label,
        hours: Math.round((totalMs / 3_600_000) * 10) / 10,
        waitingMs,
        drivingMs,
        badge: this.formatDuration(totalMs),
      };
    });
  }

  private monthHourBars(
    sessions: { startedAt: Date; endedAt?: Date }[],
    trips: { startedAt?: Date; endedAt?: Date }[],
    start: Date,
    end: Date,
  ) {
    const months: { label: string; start: Date; end: Date }[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const mStart = new Date(cursor);
      const mEnd = this.endOfDay(
        new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
      );
      months.push({
        label: mStart.toLocaleString('en', { month: 'short' }),
        start: mStart < start ? start : mStart,
        end: mEnd > end ? end : mEnd,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    // keep last 3
    const slice = months.slice(-3);
    return slice.map((m) => {
      const waitingMs = this.sumSessionMs(sessions, m.start, m.end);
      const drivingMs = trips.reduce((sum, trip) => {
        if (!trip.startedAt || !trip.endedAt) return sum;
        const s = Math.max(
          new Date(trip.startedAt).getTime(),
          m.start.getTime(),
        );
        const e = Math.min(new Date(trip.endedAt).getTime(), m.end.getTime());
        return sum + Math.max(0, e - s);
      }, 0);
      const totalMs = waitingMs + drivingMs;
      return {
        label: m.label,
        hours: Math.round((totalMs / 3_600_000) * 10) / 10,
        waitingMs,
        drivingMs,
        badge: this.formatDuration(totalMs),
      };
    });
  }

  private weekRideBars(
    offers: { offeredAt: Date; outcome: string }[],
    weekStart: Date,
  ) {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return labels.map((label, idx) => {
      const dayStart = this.addDays(weekStart, idx);
      const dayEnd = this.endOfDay(dayStart);
      const dayOffers = offers.filter((o) => {
        const t = new Date(o.offeredAt).getTime();
        return t >= dayStart.getTime() && t <= dayEnd.getTime();
      });
      return {
        label,
        received: dayOffers.length,
        accepted: dayOffers.filter(
          (o) => o.outcome === RideOfferOutcome.Accepted,
        ).length,
      };
    });
  }

  private monthRideBars(
    offers: { offeredAt: Date; outcome: string }[],
    start: Date,
    end: Date,
  ) {
    const months: { label: string; start: Date; end: Date }[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const mStart = new Date(cursor);
      const mEnd = this.endOfDay(
        new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
      );
      months.push({
        label: mStart.toLocaleString('en', { month: 'short' }),
        start: mStart < start ? start : mStart,
        end: mEnd > end ? end : mEnd,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months.slice(-3).map((m) => {
      const dayOffers = offers.filter((o) => {
        const t = new Date(o.offeredAt).getTime();
        return t >= m.start.getTime() && t <= m.end.getTime();
      });
      return {
        label: m.label,
        received: dayOffers.length,
        accepted: dayOffers.filter(
          (o) => o.outcome === RideOfferOutcome.Accepted,
        ).length,
      };
    });
  }

  private buildCancelReasons(
    offers: { outcome: string }[],
    cancelledTrips: {
      cancelledBy?: string;
      cancellationReason?: string;
    }[],
    driverId: Types.ObjectId,
  ) {
    let youCancelled = 0;
    let youDidNotAccept = 0;
    let clientCancelled = 0;
    let clientNoShow = 0;

    for (const offer of offers) {
      if (offer.outcome === RideOfferOutcome.TimedOut) {
        youDidNotAccept += 1;
      }
    }

    for (const trip of cancelledTrips) {
      const byDriver =
        trip.cancelledBy && String(trip.cancelledBy) === String(driverId);
      const reason = (trip.cancellationReason || '').toLowerCase();
      if (byDriver) {
        youCancelled += 1;
      } else if (reason.includes('no show') || reason.includes('noshow')) {
        clientNoShow += 1;
      } else {
        clientCancelled += 1;
      }
    }

    const total =
      youCancelled + youDidNotAccept + clientCancelled + clientNoShow;
    const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

    return {
      total,
      reasons: [
        {
          key: 'youCancelled',
          label: 'You cancelled',
          percent: pct(youCancelled),
          color: '#F34763',
          count: youCancelled,
        },
        {
          key: 'youDidNotAccept',
          label: 'You did not accept',
          percent: pct(youDidNotAccept),
          color: '#8B99A8',
          count: youDidNotAccept,
        },
        {
          key: 'clientCancelled',
          label: 'Client cancelled',
          percent: pct(clientCancelled),
          color: '#F7AF00',
          count: clientCancelled,
        },
        {
          key: 'clientNoShow',
          label: 'Client did not show',
          percent: pct(clientNoShow),
          color: '#5B66F5',
          count: clientNoShow,
        },
      ],
    };
  }

  private formatDuration(ms: number) {
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) {
      return `${minutes}m`;
    }
    return `${hours}h ${minutes}m`;
  }

  private formatRangeLabel(start: Date, end: Date) {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `${fmt(start)}-${fmt(end)}`;
  }
}
