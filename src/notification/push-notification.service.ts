import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
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
  channelId?: string;
  sound?: string;
};

export type PushDispatchResult = {
  targeted: number;
  accepted: number;
  failed: number;
  invalidTokens: string[];
};

const MAX_DEVICES_PER_USER = 5;
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_BATCH_SIZE = 100;
const FCM_BATCH_SIZE = 500;
const DEFAULT_NOTIFICATION_CHANNEL_ID = 'rides-with-sound-v2';
const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_value, index) =>
    items.slice(index * size, (index + 1) * size),
  );
const isExpoPushToken = (token: string) =>
  (token.startsWith('ExponentPushToken[') ||
    token.startsWith('ExpoPushToken[')) &&
  token.endsWith(']');

type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
};

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
        'FIREBASE_SERVICE_ACCOUNT_BASE64 missing — Android push notifications disabled',
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
    this.sendToUserAsync(user, payload).catch((error) => {
      this.logger.error(`push send failed: ${(error as Error).message}`);
    });
  }

  private async sendToUserAsync(
    user: UserDocument | string | null | undefined,
    payload: PushPayload,
  ): Promise<void> {
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

    const result = await this.dispatchToDevices(
      record.pushDevices || [],
      payload,
    );
    if (result.invalidTokens.length) {
      await this.db.users.updateOne(
        { _id: userId },
        {
          $pull: {
            pushDevices: { token: { $in: result.invalidTokens } },
          },
        },
      );
    }
  }

  async dispatchToDevices(
    sourceDevices: Pick<PushDevice, 'token' | 'platform' | 'app'>[],
    payload: PushPayload,
  ): Promise<PushDispatchResult> {
    let devices = sourceDevices;
    if (payload.app) {
      devices = devices.filter((device) => device.app === payload.app);
    }

    const uniqueDevices = [
      ...new Map(
        devices
          .filter((device) => Boolean(device.token))
          .map((device) => [device.token, device]),
      ).values(),
    ];
    if (!uniqueDevices.length) {
      return { targeted: 0, accepted: 0, failed: 0, invalidTokens: [] };
    }

    const data: Record<string, string> = {};
    Object.entries(payload.data || {}).forEach(([key, value]) => {
      if (value != null) {
        data[key] = String(value);
      }
    });

    const expoTokens = uniqueDevices
      .filter((device) => isExpoPushToken(device.token))
      .map((device) => device.token);
    const androidTokens = uniqueDevices
      .filter(
        (device) =>
          device.platform === 'android' && !isExpoPushToken(device.token),
      )
      .map((device) => device.token);
    const legacyIosTokenCount = uniqueDevices.filter(
      (device) => device.platform === 'ios' && !isExpoPushToken(device.token),
    ).length;

    const [expoResult, androidResult] = await Promise.all([
      this.sendExpoNotifications(expoTokens, payload, data).catch((error) => {
        this.logger.error(`Expo push send failed: ${(error as Error).message}`);
        return {
          accepted: 0,
          failed: expoTokens.length,
          invalidTokens: [],
        };
      }),
      this.sendAndroidNotifications(androidTokens, payload, data).catch(
        (error) => {
          this.logger.error(
            `Firebase push send failed: ${(error as Error).message}`,
          );
          return {
            accepted: 0,
            failed: androidTokens.length,
            invalidTokens: [],
          };
        },
      ),
    ]);
    const invalidTokens = [
      ...expoResult.invalidTokens,
      ...androidResult.invalidTokens,
    ];

    if (legacyIosTokenCount > 0) {
      this.logger.warn(
        `Skipped ${legacyIosTokenCount} legacy APNs token(s); the device must open the updated app to register an Expo push token`,
      );
    }

    return {
      targeted: uniqueDevices.length,
      accepted: expoResult.accepted + androidResult.accepted,
      failed: expoResult.failed + androidResult.failed + legacyIosTokenCount,
      invalidTokens,
    };
  }

  private async sendExpoNotifications(
    tokens: string[],
    payload: PushPayload,
    data: Record<string, string>,
  ): Promise<Omit<PushDispatchResult, 'targeted'>> {
    if (!tokens.length) {
      return { accepted: 0, failed: 0, invalidTokens: [] };
    }

    const { expo } = config();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (expo.accessToken?.trim()) {
      headers.Authorization = `Bearer ${expo.accessToken.trim()}`;
    }

    const results = await Promise.all(
      chunk(tokens, EXPO_PUSH_BATCH_SIZE).map(async (batch, batchIndex) => {
        const response = await axios.post<{ data: ExpoPushTicket[] }>(
          EXPO_PUSH_ENDPOINT,
          batch.map((token) => ({
            to: token,
            title: payload.title,
            body: payload.body,
            data,
            sound: payload.sound || 'default',
            priority: 'high',
            channelId: payload.channelId || DEFAULT_NOTIFICATION_CHANNEL_ID,
          })),
          { headers },
        );

        const tickets = response.data?.data || [];
        return tickets.reduce<Omit<PushDispatchResult, 'targeted'>>(
          (result, ticket, index) => {
            if (ticket.status === 'ok') {
              result.accepted += 1;
              return result;
            }

            result.failed += 1;
            if (ticket.details?.error === 'DeviceNotRegistered') {
              result.invalidTokens.push(batch[index]);
            } else {
              const tokenIndex = batchIndex * EXPO_PUSH_BATCH_SIZE + index;
              this.logger.warn(
                `Expo push error for token index ${tokenIndex}: ${
                  ticket.message || ticket.details?.error || 'Unknown error'
                }`,
              );
            }
            return result;
          },
          {
            accepted: 0,
            failed: Math.max(0, batch.length - tickets.length),
            invalidTokens: [],
          },
        );
      }),
    );

    return this.combineProviderResults(results);
  }

  private async sendAndroidNotifications(
    tokens: string[],
    payload: PushPayload,
    data: Record<string, string>,
  ): Promise<Omit<PushDispatchResult, 'targeted'>> {
    if (!tokens.length) {
      return { accepted: 0, failed: 0, invalidTokens: [] };
    }
    if (!this.messaging) {
      this.logger.warn(
        `Skipped ${tokens.length} Android push token(s): Firebase Admin is not configured`,
      );
      return { accepted: 0, failed: tokens.length, invalidTokens: [] };
    }

    const { messaging } = this;
    const results = await Promise.all(
      chunk(tokens, FCM_BATCH_SIZE).map(async (batch, batchIndex) => {
        const response = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data,
          android: {
            priority: 'high',
            notification: {
              channelId: payload.channelId || DEFAULT_NOTIFICATION_CHANNEL_ID,
              sound: payload.sound || 'default',
            },
          },
        });

        return response.responses.reduce<Omit<PushDispatchResult, 'targeted'>>(
          (dispatch, result, index) => {
            if (result.success) {
              dispatch.accepted += 1;
              return dispatch;
            }

            dispatch.failed += 1;
            const code = result.error?.code;
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              dispatch.invalidTokens.push(batch[index]);
            } else {
              const tokenIndex = batchIndex * FCM_BATCH_SIZE + index;
              this.logger.warn(
                `FCM send error for token index ${tokenIndex}: ${result.error?.message}`,
              );
            }
            return dispatch;
          },
          { accepted: 0, failed: 0, invalidTokens: [] },
        );
      }),
    );

    return this.combineProviderResults(results);
  }

  private combineProviderResults(
    results: Omit<PushDispatchResult, 'targeted'>[],
  ): Omit<PushDispatchResult, 'targeted'> {
    return results.reduce(
      (combined, result) => ({
        accepted: combined.accepted + result.accepted,
        failed: combined.failed + result.failed,
        invalidTokens: [...combined.invalidTokens, ...result.invalidTokens],
      }),
      { accepted: 0, failed: 0, invalidTokens: [] },
    );
  }
}
