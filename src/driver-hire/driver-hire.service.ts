import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomInt } from 'crypto';
import { DatabaseService } from '../database/database.service';
import {
  DriverHireBookingDocument,
  DriverHireBookingStatus,
  DriverHirePaymentStatus,
  DriverChangeRequestStatus,
} from '../database/schemas/driver-hire-booking.schema';
import {
  DriverHirePlan,
  DriverHirePlanType,
  DriverHireSettingsDocument,
} from '../database/schemas/driver-hire-settings.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { PushNotificationService } from '../notification/push-notification.service';
import { PaymentService } from '../payments/payment.service';
import {
  AssignDriverHireBookingDTO,
  CreateDriverHireBookingDTO,
  ListDriverHireBookingsDTO,
  RequestDriverChangeDTO,
  RescheduleDriverHireDTO,
  ResolveDriverChangeDTO,
  UpdateDriverHireSettingsDTO,
} from './dto/driver-hire.dto';
import {
  DRIVER_HIRE_TERMS,
  DRIVER_HIRE_TERMS_EFFECTIVE_DATE,
  DRIVER_HIRE_TERMS_VERSION,
} from './driver-hire.terms';

const ACTIVE_ASSIGNMENT_STATUSES = [
  DriverHireBookingStatus.Assigned,
  DriverHireBookingStatus.DriverEnRoute,
  DriverHireBookingStatus.DriverArrived,
  DriverHireBookingStatus.InProgress,
];

const CUSTOMER_CANCELLABLE_STATUSES = [
  DriverHireBookingStatus.PendingReview,
  DriverHireBookingStatus.Assigned,
  DriverHireBookingStatus.DriverEnRoute,
  DriverHireBookingStatus.DriverArrived,
];

const DRIVER_TRANSITIONS: Partial<
  Record<DriverHireBookingStatus, DriverHireBookingStatus[]>
> = {
  [DriverHireBookingStatus.Assigned]: [DriverHireBookingStatus.DriverEnRoute],
  [DriverHireBookingStatus.DriverEnRoute]: [
    DriverHireBookingStatus.DriverArrived,
  ],
  [DriverHireBookingStatus.DriverArrived]: [DriverHireBookingStatus.InProgress],
  [DriverHireBookingStatus.InProgress]: [DriverHireBookingStatus.Completed],
};

const HANDOVER_CODE_TTL_MS = 10 * 60 * 1000;
const HANDOVER_CODE_MAX_ATTEMPTS = 5;

const DEFAULT_PLANS: Record<DriverHirePlanType, DriverHirePlan> = {
  [DriverHirePlanType.Hourly]: {
    enabled: true,
    baseRate: 8_000,
    discountPercent: 0,
    includedDays: 1,
    hoursPerDay: 8,
    validityDays: 1,
    overtimeHourlyRate: 8_000,
    overtimeBillingIncrementMinutes: 30,
  },
  [DriverHirePlanType.Weekly]: {
    enabled: true,
    baseRate: 100_000,
    discountPercent: 0,
    includedDays: 5,
    hoursPerDay: 8,
    validityDays: 7,
    overtimeHourlyRate: 8_000,
    overtimeBillingIncrementMinutes: 30,
  },
  [DriverHirePlanType.Monthly]: {
    enabled: true,
    baseRate: 350_000,
    discountPercent: 0,
    includedDays: 22,
    hoursPerDay: 8,
    validityDays: 30,
    overtimeHourlyRate: 8_000,
    overtimeBillingIncrementMinutes: 30,
  },
  [DriverHirePlanType.PremiumMonthly]: {
    enabled: true,
    baseRate: 450_000,
    discountPercent: 0,
    includedDays: 26,
    hoursPerDay: 10,
    validityDays: 30,
    overtimeHourlyRate: 8_000,
    overtimeBillingIncrementMinutes: 30,
  },
};

const planKey = (type: DriverHirePlanType) =>
  `${type.charAt(0).toLowerCase()}${type.slice(1)}Plan` as
    | 'hourlyPlan'
    | 'weeklyPlan'
    | 'monthlyPlan'
    | 'premiumMonthlyPlan';

@Injectable()
export class DriverHireService {
  constructor(
    private readonly db: DatabaseService,
    private readonly push: PushNotificationService,
    private readonly payments: PaymentService,
  ) {}

  static billableHours(
    hours: number,
    minimumHours: number,
    billingIncrementMinutes: number,
  ) {
    const requestedMinutes = Math.max(hours, minimumHours) * 60;
    const increments = Math.ceil(requestedMinutes / billingIncrementMinutes);
    return (increments * billingIncrementMinutes) / 60;
  }

  static calculateAmount(
    hours: number,
    pricing: {
      hourlyRate: number;
      minimumHours: number;
      billingIncrementMinutes: number;
      logisticsFee: number;
    },
  ) {
    const billableHours = DriverHireService.billableHours(
      hours,
      pricing.minimumHours,
      pricing.billingIncrementMinutes,
    );
    return (
      Math.round(
        (billableHours * pricing.hourlyRate + pricing.logisticsFee) * 100,
      ) / 100
    );
  }

  static discountedRate(baseRate: number, discountPercent: number) {
    return Math.round(baseRate * (1 - discountPercent / 100) * 100) / 100;
  }

  async getSettings(): Promise<DriverHireSettingsDocument> {
    const settings = await this.db.driverHireSettings.findOneAndUpdate(
      { key: 'default' },
      {
        $setOnInsert: {
          key: 'default',
          active: false,
          hourlyRate: 0,
          minimumHours: 2,
          billingIncrementMinutes: 30,
          logisticsFee: 0,
          minimumAdvanceHours: 2,
          rescheduleNoticeHours: 24,
          supportsBookingRequestIdempotency: true,
          hourlyPlan: DEFAULT_PLANS.Hourly,
          weeklyPlan: DEFAULT_PLANS.Weekly,
          monthlyPlan: DEFAULT_PLANS.Monthly,
          premiumMonthlyPlan: DEFAULT_PLANS.PremiumMonthly,
          termsVersion: DRIVER_HIRE_TERMS_VERSION,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    const missingPlans = Object.values(DriverHirePlanType).reduce(
      (updates, type) => {
        const key = planKey(type);
        if (!settings[key]) {
          const fallback = { ...DEFAULT_PLANS[type] };
          if (type === DriverHirePlanType.Hourly && settings.hourlyRate > 0) {
            fallback.baseRate = settings.hourlyRate;
            fallback.overtimeHourlyRate = settings.hourlyRate;
          }
          updates[key] = fallback;
        }
        return updates;
      },
      {} as Record<string, unknown>,
    );
    if (!settings.rescheduleNoticeHours) {
      Object.assign(missingPlans, { rescheduleNoticeHours: 24 });
    }
    if (settings.supportsBookingRequestIdempotency !== true) {
      Object.assign(missingPlans, {
        supportsBookingRequestIdempotency: true,
      });
    }
    if (settings.termsVersion !== DRIVER_HIRE_TERMS_VERSION) {
      Object.assign(missingPlans, {
        termsVersion: DRIVER_HIRE_TERMS_VERSION,
      });
    }
    if (!Object.keys(missingPlans).length) return settings;
    return this.db.driverHireSettings.findOneAndUpdate(
      { _id: settings.id },
      { $set: missingPlans },
      { new: true },
    );
  }

  async getTerms(user: UserDocument) {
    const settings = await this.getSettings();
    const acceptance = await this.db.driverHireTermsAcceptances.findOne({
      user: user.id,
      version: settings.termsVersion,
      deleted: { $ne: true },
    });
    return {
      version: settings.termsVersion,
      effectiveDate: DRIVER_HIRE_TERMS_EFFECTIVE_DATE,
      content: DRIVER_HIRE_TERMS,
      accepted: Boolean(acceptance),
      acceptedAt: acceptance?.acceptedAt,
    };
  }

  async acceptTerms(user: UserDocument, version: string) {
    const settings = await this.getSettings();
    if (version !== settings.termsVersion) {
      throw new BadRequestException(
        'The terms have changed. Review the current version before continuing.',
      );
    }
    const acceptedAt = new Date();
    return this.db.driverHireTermsAcceptances.findOneAndUpdate(
      { user: user.id, version },
      { $set: { acceptedAt, deleted: false } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }

  async createBooking(
    user: UserDocument,
    payload: CreateDriverHireBookingDTO,
    clientRequestId?: string,
  ) {
    if (
      clientRequestId &&
      !/^driver-hire-[a-z0-9-]{12,80}$/.test(clientRequestId)
    ) {
      throw new BadRequestException('Invalid booking request identifier');
    }
    if (clientRequestId) {
      const existingRequest = await this.db.driverHireBookings.findOne({
        user: user.id,
        clientRequestId,
        deleted: { $ne: true },
      });
      if (existingRequest) return existingRequest;
    }

    const settings = await this.getSettings();
    const planType = payload.planType || DriverHirePlanType.Hourly;
    const plan = settings[planKey(planType)] || DEFAULT_PLANS[planType];
    if (!settings.active || !plan.enabled || plan.baseRate <= 0) {
      throw new BadRequestException(
        'This Hire a Driver plan is not accepting requests at this time',
      );
    }

    const acceptance = await this.db.driverHireTermsAcceptances.findOne({
      user: user.id,
      version: settings.termsVersion,
      deleted: { $ne: true },
    });
    if (!acceptance) {
      throw new BadRequestException(
        'Accept the current Hire a Driver terms before submitting a request',
      );
    }

    if (
      !payload.vehicleRoadworthyConfirmed ||
      !payload.vehicleInsuredConfirmed ||
      !payload.vehicleAuthorizationConfirmed
    ) {
      throw new BadRequestException(
        'Confirm that the vehicle is roadworthy, insured, and authorized for use',
      );
    }

    const scheduledAt = new Date(payload.scheduledAt);
    const earliest = Date.now() + settings.minimumAdvanceHours * 60 * 60 * 1000;
    if (scheduledAt.getTime() < earliest) {
      throw new BadRequestException(
        `Bookings must be made at least ${settings.minimumAdvanceHours} hours in advance`,
      );
    }

    const isHourly = planType === DriverHirePlanType.Hourly;
    const expectedEndAt = new Date(
      scheduledAt.getTime() +
        (isHourly ? payload.estimatedHours / 24 : plan.validityDays) *
          24 *
          60 *
          60 *
          1000,
    );
    const effectiveRate = DriverHireService.discountedRate(
      plan.baseRate,
      plan.discountPercent,
    );
    const pricing = {
      planType,
      baseRate: plan.baseRate,
      discountPercent: plan.discountPercent,
      includedDays: plan.includedDays,
      hoursPerDay: plan.hoursPerDay,
      validityDays: plan.validityDays,
      overtimeHourlyRate: plan.overtimeHourlyRate,
      overtimeBillingIncrementMinutes: plan.overtimeBillingIncrementMinutes,
      hourlyRate: isHourly ? effectiveRate : plan.overtimeHourlyRate,
      minimumHours: settings.minimumHours,
      billingIncrementMinutes: settings.billingIncrementMinutes,
      logisticsFee: 0,
    };

    const estimatedAmount = isHourly
      ? DriverHireService.calculateAmount(payload.estimatedHours, pricing)
      : effectiveRate;
    const defaultWorkingDays =
      planType === DriverHirePlanType.PremiumMonthly
        ? [1, 2, 3, 4, 5, 6]
        : [1, 2, 3, 4, 5];

    try {
      return await this.db.driverHireBookings.create({
        ...payload,
        ...(clientRequestId ? { clientRequestId } : {}),
        planType,
        user: user.id,
        status: DriverHireBookingStatus.PendingReview,
        paymentStatus: DriverHirePaymentStatus.Pending,
        scheduledAt,
        expectedEndAt,
        pickup: {
          type: 'Point',
          address: payload.pickup.address,
          coordinates: [payload.pickup.latitude, payload.pickup.longitude],
        },
        completion: {
          type: 'Point',
          address: payload.completion.address,
          coordinates: [
            payload.completion.latitude,
            payload.completion.longitude,
          ],
        },
        additionalStops: payload.additionalStops || [],
        pricing,
        estimatedHours: isHourly ? payload.estimatedHours : plan.hoursPerDay,
        estimatedAmount,
        ...(isHourly
          ? {}
          : {
              packageSchedule: {
                startDate: scheduledAt,
                endDate: expectedEndAt,
                workingDays: payload.workingDays || defaultWorkingDays,
                dailyStartTime:
                  payload.dailyStartTime ||
                  scheduledAt.toISOString().slice(11, 16),
              },
            }),
        termsVersion: settings.termsVersion,
        termsAcceptedAt: acceptance.acceptedAt,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000 || !clientRequestId) {
        throw error;
      }
      const concurrentRequest = await this.db.driverHireBookings.findOne({
        user: user.id,
        clientRequestId,
        deleted: { $ne: true },
      });
      if (concurrentRequest) return concurrentRequest;
      throw error;
    }
  }

  async getMyBookings(user: UserDocument, query: ListDriverHireBookingsDTO) {
    const { page = 1, limit = 20, status } = query;
    return this.db.driverHireBookings.paginate(
      {
        user: user.id,
        deleted: { $ne: true },
        ...(status ? { status } : {}),
      },
      {
        page,
        limit,
        sort: { scheduledAt: -1 },
        populate: [
          {
            path: 'assignedDriver',
            select: 'firstName lastName phoneNumber avatar',
          },
        ],
      },
    );
  }

  async getMyBooking(user: UserDocument, bookingId: string) {
    const booking = await this.db.driverHireBookings
      .findOne({ _id: bookingId, user: user.id, deleted: { $ne: true } })
      .populate('assignedDriver', 'firstName lastName phoneNumber avatar');
    if (!booking) throw new NotFoundException('driver booking not found');
    return booking;
  }

  async cancelBooking(user: UserDocument, bookingId: string, reason?: string) {
    const booking = await this.db.driverHireBookings
      .findOneAndUpdate(
        {
          _id: bookingId,
          user: user.id,
          status: { $in: CUSTOMER_CANCELLABLE_STATUSES },
          deleted: { $ne: true },
        },
        {
          $set: {
            status: DriverHireBookingStatus.Cancelled,
            cancelledAt: new Date(),
            cancelledBy: user.id,
            cancellationReason: reason?.trim() || 'Cancelled by customer',
          },
        },
        { new: true },
      )
      .populate('assignedDriver', 'firstName lastName phoneNumber avatar');
    if (!booking) {
      throw new ConflictException('This booking can no longer be cancelled');
    }
    if (booking.assignedDriver) {
      this.push.sendToUser(booking.assignedDriver as UserDocument, {
        title: 'Driver booking cancelled',
        body: 'The customer cancelled the assignment',
        app: 'driver',
        data: { type: 'DriverHireCancelled', bookingId: String(booking.id) },
      });
    }
    return booking;
  }

  async rescheduleBooking(
    user: UserDocument,
    bookingId: string,
    payload: RescheduleDriverHireDTO,
  ) {
    const settings = await this.getSettings();
    const booking = await this.getMyBooking(user, bookingId);
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(booking.status)) {
      throw new ConflictException('This service can no longer be rescheduled');
    }
    const scheduledAt = new Date(payload.scheduledAt);
    const minimum =
      Date.now() + settings.rescheduleNoticeHours * 60 * 60 * 1000;
    if (scheduledAt.getTime() < minimum) {
      throw new BadRequestException(
        `Rescheduling requires at least ${settings.rescheduleNoticeHours} hours notice`,
      );
    }
    const duration =
      new Date(booking.expectedEndAt).getTime() -
      new Date(booking.scheduledAt).getTime();
    const expectedEndAt = new Date(scheduledAt.getTime() + duration);
    const updated = await this.db.driverHireBookings
      .findOneAndUpdate(
        { _id: booking.id, user: user.id, status: booking.status },
        {
          $set: {
            scheduledAt,
            expectedEndAt,
            rescheduledAt: new Date(),
            ...(booking.packageSchedule
              ? {
                  'packageSchedule.startDate': scheduledAt,
                  'packageSchedule.endDate': expectedEndAt,
                }
              : {}),
          },
        },
        { new: true },
      )
      .populate('assignedDriver', 'firstName lastName phoneNumber avatar');
    if (!updated) throw new ConflictException('The booking changed elsewhere');
    if (updated.assignedDriver) {
      this.push.sendToUser(updated.assignedDriver as UserDocument, {
        title: 'Assignment rescheduled',
        body: `The service now starts ${scheduledAt.toLocaleString()}`,
        app: 'driver',
        data: { type: 'DriverHireRescheduled', bookingId: String(updated.id) },
      });
    }
    return updated;
  }

  async requestDriverChange(
    user: UserDocument,
    bookingId: string,
    payload: RequestDriverChangeDTO,
  ) {
    const booking = await this.db.driverHireBookings.findOneAndUpdate(
      {
        _id: bookingId,
        user: user.id,
        assignedDriver: { $exists: true },
        status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
        'driverChangeRequest.status': {
          $ne: DriverChangeRequestStatus.Pending,
        },
        deleted: { $ne: true },
      },
      {
        $set: {
          driverChangeRequest: {
            reason: payload.reason.trim(),
            note: payload.note?.trim(),
            status: DriverChangeRequestStatus.Pending,
            requestedAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!booking) {
      throw new ConflictException(
        'A driver change cannot be requested for this booking',
      );
    }
    return booking;
  }

  async resolveDriverChange(
    admin: UserDocument,
    bookingId: string,
    payload: ResolveDriverChangeDTO,
  ) {
    const existing = await this.db.driverHireBookings.findOne({
      _id: bookingId,
      'driverChangeRequest.status': DriverChangeRequestStatus.Pending,
      deleted: { $ne: true },
    });
    if (!existing)
      throw new NotFoundException('pending change request not found');
    if (payload.approved) {
      if (!payload.driverId) {
        throw new BadRequestException('Select a replacement driver');
      }
      await this.assignDriver(admin, bookingId, {
        driverId: payload.driverId,
        adminNotes: payload.note,
      });
    }
    const status = payload.approved
      ? DriverChangeRequestStatus.Approved
      : DriverChangeRequestStatus.Rejected;
    const booking = await this.db.driverHireBookings
      .findOneAndUpdate(
        {
          _id: bookingId,
          'driverChangeRequest.status': DriverChangeRequestStatus.Pending,
        },
        {
          $set: {
            'driverChangeRequest.status': status,
            'driverChangeRequest.resolvedAt': new Date(),
            'driverChangeRequest.resolvedBy': admin.id,
            'driverChangeRequest.resolutionNote': payload.note?.trim(),
          },
        },
        { new: true },
      )
      .populate('user', 'firstName lastName email phoneNumber avatar')
      .populate(
        'assignedDriver',
        'firstName lastName email phoneNumber avatar',
      );
    if (!booking) throw new ConflictException('The request changed elsewhere');
    this.push.sendToUser(booking.user as UserDocument, {
      title: payload.approved
        ? 'Driver change approved'
        : 'Driver change request reviewed',
      body:
        payload.note?.trim() ||
        (payload.approved
          ? 'A replacement driver has been assigned'
          : 'Your current driver remains assigned'),
      app: 'rider',
      data: {
        type: 'DriverHireDriverChangeResolved',
        bookingId: String(booking.id),
      },
    });
    return booking;
  }

  async getAdminBookings(query: ListDriverHireBookingsDTO) {
    const { page = 1, limit = 50, status } = query;
    return this.db.driverHireBookings.paginate(
      { deleted: { $ne: true }, ...(status ? { status } : {}) },
      {
        page,
        limit,
        sort: { createdAt: -1 },
        populate: [
          {
            path: 'user',
            select: 'firstName lastName email phoneNumber avatar',
          },
          {
            path: 'assignedDriver',
            select: 'firstName lastName email phoneNumber avatar',
          },
          { path: 'assignedBy', select: 'firstName lastName email' },
        ],
      },
    );
  }

  async getAdminBooking(bookingId: string) {
    const booking = await this.db.driverHireBookings
      .findOne({ _id: bookingId, deleted: { $ne: true } })
      .populate('user', 'firstName lastName email phoneNumber avatar')
      .populate('assignedDriver', 'firstName lastName email phoneNumber avatar')
      .populate('assignedBy', 'firstName lastName email');
    if (!booking) throw new NotFoundException('driver booking not found');
    return booking;
  }

  async getEligibleDrivers() {
    return this.db.users
      .find({
        deleted: { $ne: true },
        isDriver: true,
        isVerified: true,
        isInHouseDriver: true,
      })
      .select(
        'firstName lastName email phoneNumber avatar isVerified isInHouseDriver',
      )
      .sort({ firstName: 1, lastName: 1 });
  }

  async getDriverCandidates() {
    return this.db.users
      .find({ deleted: { $ne: true }, isDriver: true, isVerified: true })
      .select(
        'firstName lastName email phoneNumber avatar isVerified isInHouseDriver',
      )
      .sort({ isInHouseDriver: -1, firstName: 1, lastName: 1 });
  }

  async setInHouseDriver(userId: string, eligible: boolean) {
    const previous = await this.db.users.findOneAndUpdate(
      {
        _id: userId,
        deleted: { $ne: true },
        isDriver: true,
        isVerified: true,
      },
      { $set: { isInHouseDriver: eligible } },
      { new: false },
    );
    if (!previous) {
      throw new NotFoundException('verified driver not found');
    }

    if (eligible && !previous.isInHouseDriver) {
      this.push.sendToUser(previous, {
        title: "You're now an in-house driver",
        body: "You can now receive Hire a Driver assignments. We'll notify you when you're assigned a job.",
        app: 'driver',
        data: { type: 'DriverHireEnabled' },
      });
    }

    previous.isInHouseDriver = eligible;
    return previous;
  }

  async assignDriver(
    admin: UserDocument,
    bookingId: string,
    payload: AssignDriverHireBookingDTO,
  ) {
    const [booking, driver] = await Promise.all([
      this.db.driverHireBookings.findOne({
        _id: bookingId,
        status: {
          $in: [
            DriverHireBookingStatus.PendingReview,
            DriverHireBookingStatus.Assigned,
            DriverHireBookingStatus.DriverEnRoute,
            DriverHireBookingStatus.DriverArrived,
            DriverHireBookingStatus.InProgress,
          ],
        },
        deleted: { $ne: true },
      }),
      this.db.users.findOne({
        _id: payload.driverId,
        isDriver: true,
        isVerified: true,
        isInHouseDriver: true,
        deleted: { $ne: true },
      }),
    ]);
    if (!booking) throw new NotFoundException('assignable booking not found');
    if (!driver) throw new BadRequestException('driver is not eligible');

    const conflict = await this.db.driverHireBookings.exists({
      _id: { $ne: booking.id },
      assignedDriver: driver.id,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
      scheduledAt: { $lt: booking.expectedEndAt },
      expectedEndAt: { $gt: booking.scheduledAt },
      deleted: { $ne: true },
    });
    if (conflict) {
      throw new ConflictException(
        'This driver already has an overlapping assignment',
      );
    }

    const previousDriver = booking.assignedDriver;
    const assigned = await this.db.driverHireBookings
      .findOneAndUpdate(
        {
          _id: booking.id,
          status: booking.status,
          assignedDriver: booking.assignedDriver,
        },
        {
          $set: {
            assignedDriver: driver.id,
            assignedBy: admin.id,
            assignedAt: new Date(),
            status:
              booking.status === DriverHireBookingStatus.PendingReview
                ? DriverHireBookingStatus.Assigned
                : booking.status,
            ...(payload.adminNotes
              ? { adminNotes: payload.adminNotes.trim() }
              : {}),
          },
        },
        { new: true },
      )
      .populate('user', 'firstName lastName email phoneNumber avatar')
      .populate('assignedDriver', 'firstName lastName email phoneNumber avatar')
      .populate('assignedBy', 'firstName lastName email');
    if (!assigned) {
      throw new ConflictException('The booking was updated by another admin');
    }

    if (previousDriver && String(previousDriver) !== String(driver.id)) {
      this.push.sendToUser(previousDriver as string, {
        title: 'Assignment changed',
        body: 'A Hire a Driver assignment has been reassigned',
        app: 'driver',
        data: { type: 'DriverHireReassigned', bookingId: String(booking.id) },
      });
    }
    this.push.sendToUser(assigned.user as UserDocument, {
      title: 'Driver assigned',
      body: `${
        driver.firstName || 'Your driver'
      } has been assigned to your Hire a Driver request`,
      app: 'rider',
      data: { type: 'DriverHireAssigned', bookingId: String(booking.id) },
    });
    this.push.sendToUser(driver, {
      title: 'New driver assignment',
      body: `You have a Hire a Driver assignment for ${booking.scheduledAt.toLocaleString()}`,
      app: 'driver',
      data: { type: 'DriverHireAssigned', bookingId: String(booking.id) },
    });
    return assigned;
  }

  async rejectBooking(admin: UserDocument, bookingId: string, reason: string) {
    const booking = await this.db.driverHireBookings
      .findOneAndUpdate(
        {
          _id: bookingId,
          status: DriverHireBookingStatus.PendingReview,
          deleted: { $ne: true },
        },
        {
          $set: {
            status: DriverHireBookingStatus.Rejected,
            rejectionReason: reason.trim(),
            assignedBy: admin.id,
          },
        },
        { new: true },
      )
      .populate('user');
    if (!booking) throw new ConflictException('Booking cannot be rejected');
    this.push.sendToUser(booking.user as UserDocument, {
      title: 'Driver request unavailable',
      body: reason.trim(),
      app: 'rider',
      data: { type: 'DriverHireRejected', bookingId: String(booking.id) },
    });
    return booking;
  }

  async updateSettings(
    admin: UserDocument,
    payload: UpdateDriverHireSettingsDTO,
  ) {
    const plans = [
      payload.hourlyPlan,
      payload.weeklyPlan,
      payload.monthlyPlan,
      payload.premiumMonthlyPlan,
    ];
    if (
      payload.active &&
      !plans.some((plan) => plan.enabled && plan.baseRate > 0)
    ) {
      throw new BadRequestException(
        'Enable at least one plan with a valid price before activating Hire a Driver',
      );
    }
    return this.db.driverHireSettings.findOneAndUpdate(
      { key: 'default' },
      {
        $set: {
          ...payload,
          hourlyRate: payload.hourlyPlan.baseRate,
          logisticsFee: 0,
          termsVersion: DRIVER_HIRE_TERMS_VERSION,
          updatedBy: admin.id,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }

  async updateOvertime(
    admin: UserDocument,
    bookingId: string,
    overtimeMinutes: number,
  ) {
    const booking = await this.db.driverHireBookings.findOne({
      _id: bookingId,
      deleted: { $ne: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.planType === DriverHirePlanType.Hourly) {
      throw new BadRequestException(
        'Hourly bookings are billed from their actual service duration',
      );
    }
    if (
      booking.status === DriverHireBookingStatus.Completed ||
      booking.status === DriverHireBookingStatus.Cancelled ||
      booking.status === DriverHireBookingStatus.Rejected
    ) {
      throw new ConflictException(
        'Overtime cannot be changed for this booking',
      );
    }

    const increment = Math.max(
      booking.pricing.overtimeBillingIncrementMinutes || 30,
      1,
    );
    const billableMinutes = Math.ceil(overtimeMinutes / increment) * increment;
    const overtimeAmount =
      Math.round(
        (billableMinutes / 60) *
          (booking.pricing.overtimeHourlyRate || booking.pricing.hourlyRate) *
          100,
      ) / 100;

    return this.db.driverHireBookings.findOneAndUpdate(
      { _id: booking.id },
      {
        $set: {
          overtimeMinutes,
          overtimeAmount,
          updatedBy: admin.id,
        },
      },
      { new: true },
    );
  }

  async getDriverAssignments(
    driver: UserDocument,
    query: ListDriverHireBookingsDTO,
  ) {
    const { page = 1, limit = 50, status } = query;
    return this.db.driverHireBookings.paginate(
      {
        assignedDriver: driver.id,
        deleted: { $ne: true },
        ...(status ? { status } : {}),
      },
      {
        page,
        limit,
        sort: { scheduledAt: -1 },
        populate: [
          {
            path: 'user',
            select: 'firstName lastName email phoneNumber avatar',
          },
        ],
      },
    );
  }

  async getDriverAssignment(driver: UserDocument, bookingId: string) {
    const booking = await this.db.driverHireBookings
      .findOne({
        _id: bookingId,
        assignedDriver: driver.id,
        deleted: { $ne: true },
      })
      .populate('user', 'firstName lastName email phoneNumber avatar');
    if (!booking) throw new NotFoundException('assignment not found');
    return booking;
  }

  async generateHandoverCode(driver: UserDocument, bookingId: string) {
    const existing = await this.getDriverAssignment(driver, bookingId);
    if (existing.status !== DriverHireBookingStatus.DriverArrived) {
      throw new ConflictException(
        'The verification code is available only after you have arrived',
      );
    }
    if (existing.handoverVerifiedAt) {
      throw new ConflictException('Vehicle handover is already verified');
    }

    const code = randomInt(100_000, 1_000_000).toString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + HANDOVER_CODE_TTL_MS);
    const codeHash = await hash(code, 10);
    const booking = await this.db.driverHireBookings.findOneAndUpdate(
      {
        _id: bookingId,
        assignedDriver: driver.id,
        status: DriverHireBookingStatus.DriverArrived,
        handoverVerifiedAt: { $exists: false },
        deleted: { $ne: true },
      },
      {
        $set: {
          handoverCodeHash: codeHash,
          handoverCodeExpiresAt: expiresAt,
          handoverCodeAttempts: 0,
          handoverCodeGeneratedAt: now,
        },
      },
      { new: true },
    );
    if (!booking) {
      throw new ConflictException('The assignment can no longer be verified');
    }

    return { code, expiresAt };
  }

  async verifyHandoverCode(
    user: UserDocument,
    bookingId: string,
    code: string,
  ) {
    const booking = await this.db.driverHireBookings
      .findOne({
        _id: bookingId,
        user: user.id,
        status: DriverHireBookingStatus.DriverArrived,
        deleted: { $ne: true },
      })
      .select('+handoverCodeHash +handoverCodeExpiresAt +handoverCodeAttempts');
    if (!booking) {
      throw new ConflictException(
        'Driver verification is not available for this booking',
      );
    }
    if (booking.handoverVerifiedAt) {
      return this.getMyBooking(user, bookingId);
    }
    if (!booking.handoverCodeHash || !booking.handoverCodeExpiresAt) {
      throw new BadRequestException(
        'Ask the driver to generate a new verification code',
      );
    }
    if (booking.handoverCodeAttempts >= HANDOVER_CODE_MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Ask the driver for a new code',
      );
    }
    if (new Date(booking.handoverCodeExpiresAt).getTime() <= Date.now()) {
      throw new BadRequestException(
        'This verification code has expired. Ask the driver for a new code',
      );
    }

    const matches = await compare(code, booking.handoverCodeHash);
    if (!matches) {
      const updated = await this.db.driverHireBookings.findOneAndUpdate(
        {
          _id: booking.id,
          handoverCodeHash: booking.handoverCodeHash,
          handoverCodeAttempts: { $lt: HANDOVER_CODE_MAX_ATTEMPTS },
          handoverVerifiedAt: { $exists: false },
        },
        { $inc: { handoverCodeAttempts: 1 } },
        { new: true },
      );
      const attempts =
        updated?.handoverCodeAttempts || booking.handoverCodeAttempts + 1;
      const remaining = Math.max(0, HANDOVER_CODE_MAX_ATTEMPTS - attempts);
      throw new BadRequestException(
        remaining > 0
          ? `Incorrect verification code. ${remaining} attempt${
              remaining === 1 ? '' : 's'
            } remaining`
          : 'Too many incorrect attempts. Ask the driver for a new code',
      );
    }

    const verifiedAt = new Date();
    const verified = await this.db.driverHireBookings
      .findOneAndUpdate(
        {
          _id: booking.id,
          handoverCodeHash: booking.handoverCodeHash,
          handoverCodeAttempts: { $lt: HANDOVER_CODE_MAX_ATTEMPTS },
          handoverCodeExpiresAt: { $gt: verifiedAt },
          handoverVerifiedAt: { $exists: false },
        },
        {
          $set: { handoverVerifiedAt: verifiedAt, handoverVerifiedBy: user.id },
          $unset: {
            handoverCodeHash: 1,
            handoverCodeExpiresAt: 1,
            handoverCodeAttempts: 1,
          },
        },
        { new: true },
      )
      .populate('assignedDriver', 'firstName lastName phoneNumber avatar');
    if (!verified) {
      throw new ConflictException(
        'The verification code changed. Ask the driver for the latest code',
      );
    }

    this.push.sendToUser(booking.assignedDriver as string, {
      title: 'Vehicle handover verified',
      body: 'The customer confirmed your identity. You can now start the service.',
      app: 'driver',
      data: {
        type: 'DriverHireHandoverVerified',
        bookingId: String(booking.id),
      },
    });
    return verified;
  }

  async updateDriverStatus(
    driver: UserDocument,
    bookingId: string,
    nextStatus: DriverHireBookingStatus,
  ) {
    const existing = await this.getDriverAssignment(driver, bookingId);
    const allowed = DRIVER_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new ConflictException(
        `Cannot move an assignment from ${existing.status} to ${nextStatus}`,
      );
    }
    if (
      nextStatus === DriverHireBookingStatus.InProgress &&
      !existing.handoverVerifiedAt
    ) {
      throw new ConflictException(
        'The customer must verify the handover code before service can start',
      );
    }

    const now = new Date();
    const timestamps: Record<string, Date> = {};
    if (nextStatus === DriverHireBookingStatus.DriverEnRoute) {
      timestamps.driverEnRouteAt = now;
    } else if (nextStatus === DriverHireBookingStatus.DriverArrived) {
      timestamps.driverArrivedAt = now;
    } else if (nextStatus === DriverHireBookingStatus.InProgress) {
      timestamps.startedAt = now;
    } else if (nextStatus === DriverHireBookingStatus.Completed) {
      timestamps.endedAt = now;
    }

    let finalAmount: number | undefined;
    if (nextStatus === DriverHireBookingStatus.Completed) {
      if (
        (existing.planType || existing.pricing.planType) ===
        DriverHirePlanType.Hourly
      ) {
        const startedAt = existing.startedAt
          ? new Date(existing.startedAt)
          : now;
        const actualHours = Math.max(
          0,
          (now.getTime() - startedAt.getTime()) / (60 * 60 * 1000),
        );
        finalAmount = DriverHireService.calculateAmount(
          actualHours,
          existing.pricing,
        );
      } else {
        finalAmount = existing.estimatedAmount + (existing.overtimeAmount || 0);
      }
    }

    const booking = await this.db.driverHireBookings
      .findOneAndUpdate(
        { _id: bookingId, assignedDriver: driver.id, status: existing.status },
        {
          $set: {
            status: nextStatus,
            ...timestamps,
            ...(finalAmount !== undefined ? { finalAmount } : {}),
          },
        },
        { new: true },
      )
      .populate('user', 'firstName lastName email phoneNumber avatar');
    if (!booking) {
      throw new ConflictException('The assignment was updated elsewhere');
    }

    if (nextStatus === DriverHireBookingStatus.Completed) {
      try {
        const paymentResponse = await this.payments.chargeUser(
          booking.user as UserDocument,
          { amount: finalAmount || 0, method: booking.paymentMethod },
        );
        booking.paymentStatus = DriverHirePaymentStatus.Charged;
        booking.paymentResponse = paymentResponse;
      } catch (error) {
        booking.paymentStatus = DriverHirePaymentStatus.Failed;
        booking.paymentError = (error as Error).message;
      }
      await booking.save();
    }

    const copy: Partial<Record<DriverHireBookingStatus, [string, string]>> = {
      [DriverHireBookingStatus.DriverEnRoute]: [
        'Driver on the way',
        'Your assigned driver is heading to the vehicle location',
      ],
      [DriverHireBookingStatus.DriverArrived]: [
        'Driver has arrived',
        'Your assigned driver is ready for vehicle handover',
      ],
      [DriverHireBookingStatus.InProgress]: [
        'Driver service started',
        'Your Hire a Driver booking is now in progress',
      ],
      [DriverHireBookingStatus.Completed]: [
        'Driver service completed',
        `Your final charge is ₦${(finalAmount || 0).toLocaleString()}`,
      ],
    };
    const notification = copy[nextStatus];
    if (notification) {
      this.push.sendToUser(booking.user as UserDocument, {
        title: notification[0],
        body: notification[1],
        app: 'rider',
        data: {
          type: 'DriverHireStatusChanged',
          bookingId: String(booking.id),
          status: nextStatus,
        },
      });
    }
    return booking;
  }
}
