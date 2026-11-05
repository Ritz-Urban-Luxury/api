import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  DriverHireBookingDocument,
  DriverHireBookingStatus,
  DriverHirePaymentStatus,
} from '../database/schemas/driver-hire-booking.schema';
import { DriverHireSettingsDocument } from '../database/schemas/driver-hire-settings.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { PushNotificationService } from '../notification/push-notification.service';
import { PaymentService } from '../payments/payment.service';
import {
  AssignDriverHireBookingDTO,
  CreateDriverHireBookingDTO,
  ListDriverHireBookingsDTO,
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

  async getSettings(): Promise<DriverHireSettingsDocument> {
    return this.db.driverHireSettings.findOneAndUpdate(
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
          termsVersion: DRIVER_HIRE_TERMS_VERSION,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
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

  async createBooking(user: UserDocument, payload: CreateDriverHireBookingDTO) {
    const settings = await this.getSettings();
    if (!settings.active || settings.hourlyRate <= 0) {
      throw new BadRequestException(
        'Hire a Driver is not accepting requests at this time',
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

    const expectedEndAt = new Date(
      scheduledAt.getTime() + payload.estimatedHours * 60 * 60 * 1000,
    );
    const pricing = {
      hourlyRate: settings.hourlyRate,
      minimumHours: settings.minimumHours,
      billingIncrementMinutes: settings.billingIncrementMinutes,
      logisticsFee: settings.logisticsFee,
    };

    return this.db.driverHireBookings.create({
      ...payload,
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
      estimatedAmount: DriverHireService.calculateAmount(
        payload.estimatedHours,
        pricing,
      ),
      termsVersion: settings.termsVersion,
      termsAcceptedAt: acceptance.acceptedAt,
    });
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
    const driver = await this.db.users.findOneAndUpdate(
      {
        _id: userId,
        deleted: { $ne: true },
        isDriver: true,
        isVerified: true,
      },
      { $set: { isInHouseDriver: eligible } },
      { new: true },
    );
    if (!driver) {
      throw new NotFoundException('verified driver not found');
    }
    return driver;
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
            status: DriverHireBookingStatus.Assigned,
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
    if (payload.active && payload.hourlyRate <= 0) {
      throw new BadRequestException(
        'Set an hourly rate before activating Hire a Driver',
      );
    }
    return this.db.driverHireSettings.findOneAndUpdate(
      { key: 'default' },
      {
        $set: {
          ...payload,
          termsVersion: DRIVER_HIRE_TERMS_VERSION,
          updatedBy: admin.id,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
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
      const startedAt = existing.startedAt ? new Date(existing.startedAt) : now;
      const actualHours = Math.max(
        0,
        (now.getTime() - startedAt.getTime()) / (60 * 60 * 1000),
      );
      finalAmount = DriverHireService.calculateAmount(
        actualHours,
        existing.pricing,
      );
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
