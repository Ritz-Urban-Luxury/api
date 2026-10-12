import {
  BadRequestException,
  CACHE_MANAGER,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { randomBytes } from 'crypto';
import { FilterQuery } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import {
  WaitlistEntryDocument,
  WaitlistRole,
} from '../database/schemas/waitlist-entry.schema';
import { Logger } from '../logger/logger.service';
import { NotificationService } from '../notification/notification.service';
import config from '../shared/config';
import { enforceRateLimit } from '../shared/rate-limit';
import {
  JoinWaitlistDTO,
  ListWaitlistDTO,
  WaitlistAudience,
} from './dto/waitlist.dto';

const MAX_SIGNUPS_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
/** Pause between launch emails to stay under the email provider's rate limit. */
const SEND_INTERVAL_MS = 600;

const appNames: Record<WaitlistRole, string> = {
  [WaitlistRole.Rider]: 'Ritz',
  [WaitlistRole.Driver]: 'Ritz Driver',
};

type RoleCounts = {
  total: number;
  pending: number;
  notified: number;
  unsubscribed: number;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

@Injectable()
export class WaitlistService {
  private sending = false;

  /** Swappable in tests so batches do not wait between emails. */
  sendInterval = SEND_INTERVAL_MS;

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: Logger,
  ) {}

  /**
   * Adds someone to the waiting list. The reply is the same whether or not the
   * email was already on the list, so the form cannot be used to look people up.
   */
  async join(payload: JoinWaitlistDTO, ip: string): Promise<void> {
    if (payload.website) {
      // Pretend it worked so bots do not learn to skip the honeypot.
      this.logger.warn('Waitlist honeypot triggered', { ip });
      return;
    }

    await enforceRateLimit(this.cache, this.logger, {
      key: `waitlist-form:${ip}`,
      max: MAX_SIGNUPS_PER_WINDOW,
      windowMs: RATE_LIMIT_WINDOW_MS,
      message:
        'Too many sign-ups from your connection. Please try again later.',
    });

    const name = payload.name?.replace(/\s+/g, ' ');
    const existing = await this.db.waitlistEntries
      .findOne({ email: payload.email })
      .select('+unsubscribeToken');

    if (existing && !existing.unsubscribedAt) {
      // Already on the list: keep their latest details, but don't email them again.
      await this.db.waitlistEntries.updateOne(
        { _id: existing.id },
        { $set: { role: payload.role, ...(name && { name }) } },
      );
      return;
    }

    let entry: WaitlistEntryDocument;
    if (existing) {
      // They unsubscribed before and have now asked to join again.
      entry = await this.db.waitlistEntries
        .findOneAndUpdate(
          { _id: existing.id },
          {
            $set: {
              role: payload.role,
              consentedAt: new Date(),
              ...(name && { name }),
              ...(payload.source && { source: payload.source }),
            },
            $unset: { unsubscribedAt: 1, notifiedAt: 1, notifyError: 1 },
          },
          { new: true },
        )
        .select('+unsubscribeToken');
    } else {
      try {
        entry = await this.db.waitlistEntries.create({
          email: payload.email,
          name,
          role: payload.role,
          source: payload.source,
          consentedAt: new Date(),
          unsubscribeToken: randomBytes(24).toString('hex'),
        });
      } catch (error) {
        // Two sign-ups for the same email at once: the other request won.
        if ((error as { code?: number }).code === 11000) return;
        throw error;
      }
    }

    this.logger.log('Waitlist sign-up', {
      role: payload.role,
      source: payload.source,
    });

    try {
      await this.notifications.sendEmail({
        template: 'waitlist-welcome.template.njk',
        recipient: name ? { name, email: entry.email } : entry.email,
        subject: "You're on the Ritz waiting list",
        context: this.emailContext(entry),
      });
    } catch (error) {
      // They are on the list either way; the welcome email is a courtesy.
      this.logger.warn('Unable to send waitlist welcome email', error);
    }
  }

  /** Returns false when the token does not match anyone on the list. */
  async unsubscribe(token: string): Promise<boolean> {
    if (!/^[a-f0-9]{48}$/.test(token)) return false;

    const entry = await this.db.waitlistEntries.findOne({
      unsubscribeToken: token,
    });
    if (!entry) return false;

    if (!entry.unsubscribedAt) {
      await this.db.waitlistEntries.updateOne(
        { _id: entry.id },
        { $set: { unsubscribedAt: new Date() } },
      );
      this.logger.log('Waitlist unsubscribe', { role: entry.role });
    }
    return true;
  }

  async summary() {
    const rows = await this.db.waitlistEntries.aggregate<
      { _id: WaitlistRole } & RoleCounts
    >([
      { $match: { deleted: { $ne: true } } },
      {
        $group: {
          _id: '$role',
          total: { $sum: 1 },
          unsubscribed: {
            $sum: { $cond: [{ $ifNull: ['$unsubscribedAt', false] }, 1, 0] },
          },
          notified: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ['$notifiedAt', false] },
                    { $not: [{ $ifNull: ['$unsubscribedAt', false] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const counts = (role: WaitlistRole): RoleCounts => {
      const row = rows.find((r) => r._id === role);
      if (!row) return { total: 0, pending: 0, notified: 0, unsubscribed: 0 };
      return {
        total: row.total,
        notified: row.notified,
        unsubscribed: row.unsubscribed,
        pending: row.total - row.notified - row.unsubscribed,
      };
    };

    const { storeLinks } = config().waitlist;
    return {
      rider: counts(WaitlistRole.Rider),
      driver: counts(WaitlistRole.Driver),
      sending: this.sending,
      storeLinksReady: {
        rider: Boolean(storeLinks.rider.apple || storeLinks.rider.google),
        driver: Boolean(storeLinks.driver.apple || storeLinks.driver.google),
      },
    };
  }

  async list(query: ListWaitlistDTO) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const filter: FilterQuery<WaitlistEntryDocument> = {};
    if (query.role) filter.role = query.role;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ email: pattern }, { name: pattern }];
    }

    const [entries, total] = await Promise.all([
      this.db.waitlistEntries
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.db.waitlistEntries.countDocuments(filter),
    ]);

    return { entries, meta: { page, limit, total } };
  }

  /** Everyone on the list as CSV, for backups or importing elsewhere. */
  async exportCsv(): Promise<string> {
    const entries = await this.db.waitlistEntries
      .find({})
      .sort({ createdAt: 1 })
      .lean();
    const cell = (value: unknown) => {
      let text =
        value instanceof Date ? value.toISOString() : String(value ?? '');
      // Stop spreadsheet apps from treating a cell as a formula.
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const header = [
      'email',
      'name',
      'role',
      'source',
      'signed_up',
      'consented',
      'notified',
      'unsubscribed',
    ];
    const lines = entries.map((e) =>
      [
        e.email,
        e.name,
        e.role,
        e.source,
        e.createdAt,
        e.consentedAt,
        e.notifiedAt,
        e.unsubscribedAt,
      ]
        .map(cell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }

  /** Sends the launch email to the admin's own address, once per app in the audience. */
  async sendTest(adminEmail: string | undefined, audience: WaitlistAudience) {
    if (!adminEmail) {
      throw new BadRequestException('Your admin account has no email address');
    }
    const roles = this.rolesFor(audience);
    this.assertStoreLinks(roles);

    await Promise.all(
      roles.map((role) =>
        this.notifications.sendEmail({
          template: 'waitlist-launch.template.njk',
          recipient: adminEmail,
          subject: `[TEST] ${this.launchSubject(role)}`,
          context: this.emailContext({ role, name: undefined }),
        }),
      ),
    );
    return { sentTo: adminEmail, emails: roles.length };
  }

  /**
   * Starts emailing everyone in the audience who hasn't had the launch email yet.
   * Runs in the background; each person is claimed before sending, so running it
   * again (or on two servers) never emails anyone twice.
   */
  async sendLaunch(audience: WaitlistAudience) {
    const roles = this.rolesFor(audience);
    this.assertStoreLinks(roles);

    if (this.sending) {
      throw new BadRequestException('The launch email is already being sent');
    }

    const queued = await this.db.waitlistEntries.countDocuments(
      this.pendingFilter(roles),
    );
    if (queued === 0) return { queued };

    this.sending = true;
    this.drain(roles)
      .catch((error) =>
        this.logger.error(
          `Waitlist launch email failed: ${(error as Error).message}`,
        ),
      )
      .finally(() => {
        this.sending = false;
      });

    return { queued };
  }

  private async drain(roles: WaitlistRole[]) {
    const failed: string[] = [];
    const sent = await this.sendNext(roles, failed, 0);
    this.logger.log('Waitlist launch email finished', {
      sent,
      failed: failed.length,
    });
  }

  /** Claims the next person, emails them, then moves on. Resolves with the number sent. */
  private async sendNext(
    roles: WaitlistRole[],
    failed: string[],
    sent: number,
  ): Promise<number> {
    const entry = await this.db.waitlistEntries
      .findOneAndUpdate(
        { ...this.pendingFilter(roles), _id: { $nin: failed } },
        { $set: { notifiedAt: new Date() }, $unset: { notifyError: 1 } },
        { new: true, sort: { createdAt: 1 } },
      )
      .select('+unsubscribeToken');
    if (!entry) return sent;

    let delivered = false;
    try {
      await this.notifications.sendEmail({
        template: 'waitlist-launch.template.njk',
        recipient: entry.name
          ? { name: entry.name, email: entry.email }
          : entry.email,
        subject: this.launchSubject(entry.role),
        context: this.emailContext(entry),
      });
      delivered = true;
    } catch (error) {
      // Release them so the next run tries again, and skip them for this run.
      failed.push(entry.id);
      await this.db.waitlistEntries.updateOne(
        { _id: entry.id },
        {
          $unset: { notifiedAt: 1 },
          $set: { notifyError: String((error as Error)?.message ?? error) },
        },
      );
    }

    await wait(this.sendInterval);
    return this.sendNext(roles, failed, sent + (delivered ? 1 : 0));
  }

  private pendingFilter(
    roles: WaitlistRole[],
  ): FilterQuery<WaitlistEntryDocument> {
    return {
      role: { $in: roles },
      notifiedAt: null,
      unsubscribedAt: null,
    };
  }

  private rolesFor(audience: WaitlistAudience): WaitlistRole[] {
    if (audience === WaitlistAudience.Both) {
      return [WaitlistRole.Rider, WaitlistRole.Driver];
    }
    return [audience as unknown as WaitlistRole];
  }

  private assertStoreLinks(roles: WaitlistRole[]) {
    const { storeLinks } = config().waitlist;
    const missing = roles.filter(
      (role) => !storeLinks[role].apple && !storeLinks[role].google,
    );
    if (missing.length) {
      throw new BadRequestException(
        `Add the App Store or Google Play link for ${missing
          .map((role) => appNames[role])
          .join(' and ')} before sending the launch email`,
      );
    }
  }

  private launchSubject(role: WaitlistRole) {
    return role === WaitlistRole.Driver
      ? 'Ritz Driver is live. Download it now'
      : 'Ritz is here. Download the app';
  }

  private emailContext(
    entry: Pick<WaitlistEntryDocument, 'role' | 'name'> & {
      unsubscribeToken?: string;
    },
  ) {
    const { publicApiUrl, siteUrl, storeLinks } = config().waitlist;
    return {
      name: entry.name?.split(' ')[0],
      role: entry.role,
      appName: appNames[entry.role],
      appStoreUrl: storeLinks[entry.role].apple,
      playStoreUrl: storeLinks[entry.role].google,
      siteUrl,
      unsubscribeUrl: entry.unsubscribeToken
        ? `${publicApiUrl}/waitlist/unsubscribe?token=${entry.unsubscribeToken}`
        : `${siteUrl}/`,
    };
  }
}
