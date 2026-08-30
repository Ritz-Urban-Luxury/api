import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { DatabaseService } from '../database/database.service';
import {
  PushApp,
  PushDevice,
  UserDocument,
} from '../database/schemas/user.schema';
import { Logger } from '../logger/logger.service';
import config from '../shared/config';

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
  app?: PushApp;
};

const MAX_DEVICES_PER_USER = 5;

@Injectable()
export class PushNotificationService implements OnModuleInit {
  private messaging: admin.messaging.Messaging | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const { firebase } = config();
    const encoded = firebase.serviceAccountBase64?.trim();

    if (!encoded) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_BASE64 missing — push notifications disabled',
      );
      return;
    }

    try {
      const json = Buffer.from(encoded, 'base64').toString('utf8');
      const serviceAccount = JSON.parse(json) as admin.ServiceAccount;

      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }

      this.messaging = admin.messaging();
      this.logger.log('Firebase Admin initialized for push notifications');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Firebase Admin: ${(error as Error).message}`,
      );
      this.messaging = null;
    }
  }

  async upsertDevice(
    user: UserDocument,
    device: Pick<PushDevice, 'token' | 'platform' | 'app'>,
  ) {
    const token = device.token?.trim();
    if (!token) {
      return user.pushDevices || [];
    }

    const existing = (user.pushDevices || []).filter(
      (item) => item.token !== token,
    );
    const nextDevices: PushDevice[] = [
      {
        token,
        platform: device.platform,
        app: device.app,
        updatedAt: new Date(),
      },
      ...existing,
    ].slice(0, MAX_DEVICES_PER_USER);

    const updated = await this.db.users.findOneAndUpdate(
      { _id: user.id },
      { $set: { pushDevices: nextDevices } },
      { new: true, upsert: false },
    );

    return updated?.pushDevices || nextDevices;
  }

  async removeDevice(user: UserDocument, token: string) {
    const trimmed = token?.trim();
    if (!trimmed) {
      return user.pushDevices || [];
    }

    const nextDevices = (user.pushDevices || []).filter(
      (item) => item.token !== trimmed,
    );

    const updated = await this.db.users.findOneAndUpdate(
      { _id: user.id },
      { $set: { pushDevices: nextDevices } },
      { new: true, upsert: false },
    );

    return updated?.pushDevices || nextDevices;
  }

  sendToUser(
    user: UserDocument | string | null | undefined,
    payload: PushPayload,
  ): void {
    void this.sendToUserAsync(user, payload).catch((error) => {
      this.logger.error(`push send failed: ${(error as Error).message}`);
    });
  }

  private async sendToUserAsync(
    user: UserDocument | string | null | undefined,
    payload: PushPayload,
  ): Promise<void> {
    if (!this.messaging) {
      return;
    }

    const userId = typeof user === 'string' ? user : user?.id;
    if (!userId) {
      return;
    }

    const record =
      typeof user === 'object' && user && Array.isArray(user.pushDevices)
        ? user
        : await this.db.users.findById(userId).select('pushDevices');

    if (!record) {
      return;
    }

    let devices = record.pushDevices || [];
    if (payload.app) {
      devices = devices.filter((device) => device.app === payload.app);
    }

    const tokens = [
      ...new Set(devices.map((device) => device.token).filter(Boolean)),
    ];
    if (!tokens.length) {
      return;
    }

    const data: Record<string, string> = {};
    Object.entries(payload.data || {}).forEach(([key, value]) => {
      if (value != null) {
        data[key] = String(value);
      }
    });

    const response = await this.messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data,
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });

    const invalidTokens: string[] = [];
    response.responses.forEach((result, index) => {
      if (result.success) {
        return;
      }

      const code = result.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        invalidTokens.push(tokens[index]);
      } else {
        this.logger.warn(
          `FCM send error for token index ${index}: ${result.error?.message}`,
        );
      }
    });

    if (invalidTokens.length) {
      await this.db.users.updateOne(
        { _id: userId },
        {
          $pull: {
            pushDevices: { token: { $in: invalidTokens } },
          },
        },
      );
    }
  }
}
