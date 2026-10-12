import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import config from '../shared/config';
import { DatabaseService } from './database.service';
import { PricingChangeAction } from './schemas/pricing-change.schema';
import {
  PricingSettingsDocument,
  RideTypeRates,
} from './schemas/pricing-settings.schema';
import { TripFare } from './schemas/trips.schema';

export type PricedRideType = 'Classic' | 'Luxury';

export type PricingSettingsInput = {
  classic: RideTypeRates;
  luxury: RideTypeRates;
  commissionPercent: number;
};

export type PricingZoneInput = {
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  classic: RideTypeRates;
  luxury: RideTypeRates;
  active: boolean;
};

export type ActiveZone = PricingZoneInput & { id: string };

/** [latitude, longitude], the order Ritz stores locations in. */
export type LatLng = [number, number];

/** Used to estimate driving time when only a distance is known (Abuja traffic, roughly). */
export const AVERAGE_SPEED_KMH = 25;

/** Settings are read on every quote, so keep them in memory briefly. */
const SETTINGS_CACHE_MS = 15_000;

/**
 * Starting prices: exactly what the app charged before pricing became configurable
 * (₦85/km with a ₦700 minimum for Classic, ₦100/km with ₦800 for Luxury).
 */
export const defaultPricing = (): PricingSettingsInput => {
  const rate = config().driverCommissionRate;
  const commissionPercent =
    Number.isFinite(rate) && rate >= 0 && rate < 1
      ? Math.round(rate * 1000) / 10
      : 20;
  return {
    classic: { baseFare: 0, perKm: 85, perMinute: 0, minimumFare: 700 },
    luxury: { baseFare: 0, perKm: 100, perMinute: 0, minimumFare: 800 },
    commissionPercent,
  };
};

const ratesKey = (type: string): 'classic' | 'luxury' | null => {
  const key = type.toLowerCase();
  return key === 'classic' || key === 'luxury' ? key : null;
};

const plainRates = (rates: RideTypeRates): RideTypeRates => ({
  baseFare: rates.baseFare,
  perKm: rates.perKm,
  perMinute: rates.perMinute,
  minimumFare: rates.minimumFare,
});

const plainZone = (zone: PricingZoneInput): PricingZoneInput => ({
  name: zone.name.trim(),
  latitude: zone.latitude,
  longitude: zone.longitude,
  radiusKm: zone.radiusKm,
  classic: plainRates(zone.classic),
  luxury: plainRates(zone.luxury),
  active: zone.active,
});

const assertChargeable = (rates: RideTypeRates, label: string) => {
  if (rates.perKm <= 0 && rates.perMinute <= 0 && rates.baseFare <= 0) {
    throw new BadRequestException(
      `${label} needs a base fare, a price per km or a price per minute`,
    );
  }
};

const assertRates = (
  input: { classic: RideTypeRates; luxury: RideTypeRates },
  prefix = '',
) => {
  assertChargeable(input.classic, `${prefix}Classic`);
  assertChargeable(input.luxury, `${prefix}Luxury`);
};

type Snapshot = { defaults: PricingSettingsInput; zones: ActiveZone[] };

@Injectable()
export class PricingService {
  private cached?: { at: number; snapshot: Snapshot };

  constructor(private readonly db: DatabaseService) {}

  /** Fare in whole naira: base + distance + time, never below the minimum. */
  static calculateFare(
    rates: RideTypeRates,
    distanceMeters: number,
    durationSeconds: number,
  ): number {
    const km = Math.max(0, distanceMeters) / 1000;
    const minutes = Math.max(0, durationSeconds) / 60;
    const fare = rates.baseFare + rates.perKm * km + rates.perMinute * minutes;
    return Math.max(rates.minimumFare, Math.round(fare));
  }

  static estimateDurationSeconds(distanceMeters: number): number {
    return Math.round(
      (Math.max(0, distanceMeters) / 1000 / AVERAGE_SPEED_KMH) * 3600,
    );
  }

  /** Straight-line distance in km between two [latitude, longitude] points. */
  static distanceKm(a: LatLng, b: LatLng): number {
    const toRad = (degrees: number) => (degrees * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }

  /** The zone a pickup falls in. Where zones overlap, the smallest (most specific) wins. */
  static zoneFor(zones: ActiveZone[], pickup?: LatLng): ActiveZone | undefined {
    if (!pickup || !Number.isFinite(pickup[0]) || !Number.isFinite(pickup[1])) {
      return undefined;
    }
    return zones
      .filter(
        (zone) =>
          zone.active &&
          PricingService.distanceKm([zone.latitude, zone.longitude], pickup) <=
            zone.radiusKm,
      )
      .sort((a, b) => a.radiusKm - b.radiusKm)[0];
  }

  async getSettings(): Promise<PricingSettingsInput> {
    return (await this.snapshot()).defaults;
  }

  /** The settings document with who last changed it, for the admin page. */
  async getSettingsForAdmin() {
    const doc = await this.loadDocument();
    return doc.populate('updatedBy', 'firstName lastName email');
  }

  async update(adminId: string, input: PricingSettingsInput) {
    assertRates(input);

    const before = await this.getSettings();
    const after: PricingSettingsInput = {
      classic: plainRates(input.classic),
      luxury: plainRates(input.luxury),
      commissionPercent: input.commissionPercent,
    };

    const doc = await this.db.pricingSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: { ...after, updatedBy: adminId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    await this.db.pricingChanges.create({
      before,
      after,
      changedBy: adminId,
    });
    this.cached = undefined;
    return doc.populate('updatedBy', 'firstName lastName email');
  }

  async listZones() {
    return this.db.pricingZones
      .find({ deleted: { $ne: true } })
      .populate('updatedBy', 'firstName lastName email')
      .sort({ name: 1 });
  }

  async createZone(adminId: string, input: PricingZoneInput) {
    assertRates(input, `${input.name}: `);
    const after = plainZone(input);
    const zone = await this.db.pricingZones.create({
      ...after,
      updatedBy: adminId,
    });
    await this.db.pricingChanges.create({
      action: PricingChangeAction.Created,
      zone: zone.id,
      zoneName: after.name,
      after,
      changedBy: adminId,
    });
    this.cached = undefined;
    return zone;
  }

  async updateZone(adminId: string, zoneId: string, input: PricingZoneInput) {
    assertRates(input, `${input.name}: `);
    if (!isValidObjectId(zoneId)) {
      throw new NotFoundException('pricing location not found');
    }
    const existing = await this.db.pricingZones.findOne({
      _id: zoneId,
      deleted: { $ne: true },
    });
    if (!existing) throw new NotFoundException('pricing location not found');

    const before = plainZone(existing);
    const after = plainZone(input);
    const zone = await this.db.pricingZones.findOneAndUpdate(
      { _id: zoneId },
      { $set: { ...after, updatedBy: adminId } },
      { new: true },
    );
    await this.db.pricingChanges.create({
      action: PricingChangeAction.Updated,
      zone: zoneId,
      zoneName: after.name,
      before,
      after,
      changedBy: adminId,
    });
    this.cached = undefined;
    return zone;
  }

  async deleteZone(adminId: string, zoneId: string) {
    if (!isValidObjectId(zoneId)) {
      throw new NotFoundException('pricing location not found');
    }
    const existing = await this.db.pricingZones.findOne({
      _id: zoneId,
      deleted: { $ne: true },
    });
    if (!existing) throw new NotFoundException('pricing location not found');

    await this.db.pricingZones.updateOne(
      { _id: zoneId },
      { $set: { deleted: true, deletedAt: new Date(), updatedBy: adminId } },
    );
    await this.db.pricingChanges.create({
      action: PricingChangeAction.Deleted,
      zone: zoneId,
      zoneName: existing.name,
      before: plainZone(existing),
      changedBy: adminId,
    });
    this.cached = undefined;
    return { id: zoneId, deleted: true };
  }

  async history(limit = 30) {
    return this.db.pricingChanges
      .find({ deleted: { $ne: true } })
      .populate('changedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Prices for every ride type at a pickup. Riders' apps send a distance (and, from
   * newer versions, the pickup); driving time is estimated unless the caller knows it.
   */
  async quote(
    distanceMeters: number,
    durationSeconds?: number,
    pickup?: LatLng,
  ) {
    const { defaults, zones } = await this.snapshot();
    const zone = PricingService.zoneFor(zones, pickup);
    const duration =
      durationSeconds ?? PricingService.estimateDurationSeconds(distanceMeters);
    return {
      classic: PricingService.calculateFare(
        (zone ?? defaults).classic,
        distanceMeters,
        duration,
      ),
      luxury: PricingService.calculateFare(
        (zone ?? defaults).luxury,
        distanceMeters,
        duration,
      ),
      ...(zone ? { zone: zone.name } : {}),
    };
  }

  /** The price for one ride, with the rates and location used, to store on the trip at booking. */
  async fareFor(
    rideType: string,
    distanceMeters: number,
    durationSeconds?: number,
    pickup?: LatLng,
  ): Promise<TripFare> {
    const key = ratesKey(rideType);
    if (!key) {
      throw new BadRequestException(`no ride pricing for ${rideType}`);
    }
    const { defaults, zones } = await this.snapshot();
    const zone = PricingService.zoneFor(zones, pickup);
    const rates = (zone ?? defaults)[key];
    const duration =
      durationSeconds ?? PricingService.estimateDurationSeconds(distanceMeters);
    return {
      rideType,
      ...rates,
      commissionPercent: defaults.commissionPercent,
      ...(zone ? { zoneId: zone.id, zoneName: zone.name } : {}),
      distanceMeters,
      durationSeconds: duration,
      amount: PricingService.calculateFare(rates, distanceMeters, duration),
      quotedAt: new Date(),
    };
  }

  /**
   * What to charge when a trip ends: the price agreed at booking, plus distance for
   * any stops the rider added on the way, at the booked per-km rate.
   */
  static chargeForTrip(fare: TripFare, extraDistanceMeters = 0): number {
    const extra = Math.max(0, extraDistanceMeters) / 1000;
    return Math.round(fare.amount + fare.perKm * extra);
  }

  /** Ritz's share of a fare, as a fraction (0.2 = 20%). */
  async commissionRate(): Promise<number> {
    const { commissionPercent } = await this.getSettings();
    return commissionPercent / 100;
  }

  private async snapshot(): Promise<Snapshot> {
    if (this.cached && Date.now() - this.cached.at < SETTINGS_CACHE_MS) {
      return this.cached.snapshot;
    }
    const [doc, zones] = await Promise.all([
      this.loadDocument(),
      this.db.pricingZones.find({ deleted: { $ne: true }, active: true }),
    ]);
    const snapshot: Snapshot = {
      defaults: {
        classic: plainRates(doc.classic),
        luxury: plainRates(doc.luxury),
        commissionPercent: doc.commissionPercent,
      },
      zones: zones.map((zone) => ({ id: String(zone.id), ...plainZone(zone) })),
    };
    this.cached = { at: Date.now(), snapshot };
    return snapshot;
  }

  private async loadDocument(): Promise<PricingSettingsDocument> {
    const defaults = defaultPricing();
    return this.db.pricingSettings.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { key: 'default', ...defaults } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }
}
