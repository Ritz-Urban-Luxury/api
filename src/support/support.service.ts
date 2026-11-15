import {
  BadRequestException,
  CACHE_MANAGER,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { isMongoId } from 'class-validator';
import { FilterQuery } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import {
  SupportComplaintDocument,
  SupportComplaintSource,
  SupportComplaintStatus,
} from '../database/schemas/support-complaint.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { Logger } from '../logger/logger.service';
import { NotificationService } from '../notification/notification.service';
import config from '../shared/config';
import { enforceRateLimit } from '../shared/rate-limit';
import {
  AdminGetSupportComplaintsDTO,
  AdminUpdateSupportComplaintDTO,
  CreateSupportComplaintDTO,
} from './dto/support-complaint.dto';

const MAX_COMPLAINTS_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Ride issues that should be treated as safety-related in the admin app. */
const SAFETY_PATTERN = /unsafe|safety|harass|assault|threat/i;

const COMPLAINT_POPULATE = [
  { path: 'user', select: 'firstName lastName email phoneNumber' },
  { path: 'trip', select: 'fromAddress toAddress status createdAt' },
  { path: 'handledBy', select: 'firstName lastName email' },
];

const singleLine = (value: string) => value.replace(/\s+/g, ' ').trim();

@Injectable()
export class SupportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: Logger,
  ) {}

  getContact() {
    return { email: config().contact.supportEmail };
  }

  async createComplaint(
    user: UserDocument,
    payload: CreateSupportComplaintDTO,
  ) {
    await enforceRateLimit(this.cache, this.logger, {
      key: `support-complaint:${user.id}`,
      max: MAX_COMPLAINTS_PER_WINDOW,
      windowMs: RATE_LIMIT_WINDOW_MS,
      message:
        'You have sent several complaints recently. Please wait a while or email us directly.',
    });

    const name =
      singleLine(`${user.firstName ?? ''} ${user.lastName ?? ''}`) ||
      'Ritz rider';
    const trip = await this.findRiderTrip(user, payload.tripId);
    const issue = payload.issue ? singleLine(payload.issue) : undefined;
    const topic = payload.topic ? singleLine(payload.topic) : undefined;
    const safetyRelated = SAFETY_PATTERN.test(`${issue ?? ''} ${topic ?? ''}`);

    const complaint = await this.db.supportComplaints.create({
      user: user.id,
      email: payload.email,
      name: name.slice(0, 100),
      source:
        payload.source ??
        (payload.tripId
          ? SupportComplaintSource.RideHelp
          : SupportComplaintSource.Support),
      issue,
      topic,
      trip: trip?.id,
      tripReference: payload.tripId,
      message: payload.message,
      safetyRelated,
    });

    // The complaint is saved either way; a failed email must not lose it.
    await this.emailSupportInbox(complaint, name).catch((error) =>
      this.logger.error('Unable to email support complaint', {
        complaintId: complaint.id,
        error,
      }),
    );

    this.logger.log('Support complaint received', {
      complaintId: complaint.id,
      safetyRelated,
    });

    return { id: complaint.id, status: complaint.status };
  }

  async getComplaints(payload: AdminGetSupportComplaintsDTO) {
    const { page = 1, limit = 20, status } = payload;
    const query: FilterQuery<SupportComplaintDocument> = {};
    if (status) query.status = status;

    return this.db.supportComplaints.paginate(query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: COMPLAINT_POPULATE,
    });
  }

  async updateComplaint(
    complaintId: string,
    payload: AdminUpdateSupportComplaintDTO,
    admin: UserDocument,
  ) {
    if (!isMongoId(complaintId)) {
      throw new BadRequestException('invalid complaint id');
    }

    const isClosed =
      payload.status === SupportComplaintStatus.Resolved ||
      payload.status === SupportComplaintStatus.Dismissed;
    const update: Record<string, unknown> = {
      status: payload.status,
      handledBy: admin.id,
      resolvedAt: isClosed ? new Date() : null,
    };
    if (payload.adminNote !== undefined) update.adminNote = payload.adminNote;

    return this.db.findAndUpdateOrFail<SupportComplaintDocument>(
      this.db.supportComplaints,
      { _id: complaintId },
      { $set: update },
      {
        error: new NotFoundException('support complaint not found'),
        options: { new: true, upsert: false },
        populate: COMPLAINT_POPULATE,
      },
    );
  }

  private async findRiderTrip(user: UserDocument, tripId?: string) {
    if (!tripId || !isMongoId(tripId)) return null;
    return this.db.trips.findOne({ _id: tripId, user: user.id }).select('_id');
  }

  private async emailSupportInbox(
    complaint: SupportComplaintDocument,
    name: string,
  ) {
    const { contact } = config();
    const heading = complaint.issue || complaint.topic || 'General complaint';
    const tripLabel = complaint.tripReference
      ? ` · trip ${complaint.tripReference.slice(-8).toUpperCase()}`
      : '';

    await this.notifications.sendEmail({
      template: 'support-complaint.template.njk',
      recipient: contact.supportEmail,
      replyTo: { name, email: complaint.email },
      subject: `${
        complaint.safetyRelated ? '[Safety] ' : ''
      }App complaint: ${heading}${tripLabel}`,
      context: {
        name,
        email: complaint.email,
        heading,
        source:
          complaint.source === SupportComplaintSource.RideHelp
            ? 'Ride help'
            : 'Support page',
        tripReference: complaint.tripReference,
        tripLinked: Boolean(complaint.trip),
        safetyRelated: complaint.safetyRelated,
        message: complaint.message,
        sentAt: new Date().toUTCString(),
        adminUrl: contact.adminAppUrl
          ? `${contact.adminAppUrl}/document/complaints?tab=support&complaint=${complaint.id}`
          : undefined,
      },
    });
  }
}
