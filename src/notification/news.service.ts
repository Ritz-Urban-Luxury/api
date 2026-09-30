import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  NewsAudience,
  NewsStatus,
} from '../database/schemas/news-article.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { CreateNewsDTO, UpdateNewsDTO } from './dto/news.dto';

const DEFAULT_NEWS_SLUG = 'welcome-to-ritz-driver';

@Injectable()
export class NewsService implements OnModuleInit {
  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    await this.db.newsArticles.findOneAndUpdate(
      { slug: DEFAULT_NEWS_SLUG },
      {
        $set: {
          coverImageUrl: 'asset://ritz-driver-welcome',
        },
        $setOnInsert: {
          slug: DEFAULT_NEWS_SLUG,
          title: 'Welcome to Ritz Driver',
          summary:
            'Everything you need to get started and make the most of driving with Ritz.',
          body: 'Welcome to Ritz Driver. We are excited to have you on the road with us.\n\nUse the app to receive and manage ride requests, follow trip updates, track your earnings, monitor your driver score, and keep your vehicle and documents up to date.\n\nBefore going online, confirm that your profile, vehicle information, required documents, and payout account are complete. Keep location and notification permissions enabled so you can receive nearby ride requests and provide accurate trip updates.\n\nDrive safely, provide a professional experience, and check the News section regularly for important platform updates, driver guidance, and new opportunities.',
          audience: NewsAudience.Driver,
          status: NewsStatus.Published,
          publishedAt: new Date(),
          isDefault: true,
        },
      },
      { new: true, upsert: true },
    );
  }

  adminList() {
    return this.db.newsArticles
      .find({ deleted: { $ne: true } })
      .sort({ publishedAt: -1, createdAt: -1 })
      .populate('createdBy', 'firstName lastName email');
  }

  async create(admin: UserDocument, payload: CreateNewsDTO) {
    return this.db.newsArticles.create({
      ...this.payloadFields(payload),
      slug: await this.uniqueSlug(payload.title),
      createdBy: admin.id,
      updatedBy: admin.id,
      isDefault: false,
    });
  }

  async update(admin: UserDocument, articleId: string, payload: UpdateNewsDTO) {
    const existing = await this.db.newsArticles.findOne({
      _id: articleId,
      deleted: { $ne: true },
    });
    if (!existing) throw new NotFoundException('news article not found');
    const article = await this.db.newsArticles.findOneAndUpdate(
      { _id: articleId, deleted: { $ne: true } },
      {
        $set: {
          ...this.payloadFields(payload),
          ...(existing.isDefault
            ? {
                audience: NewsAudience.Driver,
                status: NewsStatus.Published,
              }
            : {}),
          updatedBy: admin.id,
        },
      },
      { new: true, upsert: false },
    );
    if (!article) throw new NotFoundException('news article not found');
    return article;
  }

  async archive(admin: UserDocument, articleId: string) {
    const existing = await this.db.newsArticles.findOne({
      _id: articleId,
      deleted: { $ne: true },
    });
    if (!existing) throw new NotFoundException('news article not found');
    if (existing.isDefault) return existing;
    const article = await this.db.newsArticles.findOneAndUpdate(
      { _id: articleId, deleted: { $ne: true } },
      { $set: { status: NewsStatus.Archived, updatedBy: admin.id } },
      { new: true, upsert: false },
    );
    if (!article) throw new NotFoundException('news article not found');
    return article;
  }

  async driverList(user: UserDocument) {
    const articles = await this.db.newsArticles
      .find(this.publishedQuery(user))
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(100);
    const reads = await this.db.newsReads.find({
      user: user.id,
      article: { $in: articles.map((article) => article.id) },
    });
    const readIds = new Set(reads.map((read) => String(read.article)));
    return articles.map((article) => ({
      ...article.toJSON(),
      isRead: readIds.has(String(article.id)),
    }));
  }

  async driverDetail(user: UserDocument, articleId: string) {
    const article = await this.db.newsArticles.findOne({
      _id: articleId,
      ...this.publishedQuery(user),
    });
    if (!article) throw new NotFoundException('news article not found');
    const read = await this.db.newsReads.findOne({
      user: user.id,
      article: article.id,
    });
    return { ...article.toJSON(), isRead: Boolean(read) };
  }

  async markRead(user: UserDocument, articleId: string) {
    const article = await this.db.newsArticles.exists({
      _id: articleId,
      ...this.publishedQuery(user),
    });
    if (!article) throw new NotFoundException('news article not found');
    await this.db.newsReads.findOneAndUpdate(
      { user: user.id, article: articleId },
      { $set: { readAt: new Date() } },
      { new: true, upsert: true },
    );
    return { read: true };
  }

  async unreadCount(user: UserDocument) {
    const articleIds = await this.db.newsArticles.distinct(
      '_id',
      this.publishedQuery(user),
    );
    if (!articleIds.length) return { count: 0 };
    const relevantReadCount = await this.db.newsReads.countDocuments({
      user: user.id,
      article: { $in: articleIds },
    });
    return { count: Math.max(0, articleIds.length - relevantReadCount) };
  }

  private publishedQuery(user: UserDocument) {
    return {
      status: NewsStatus.Published,
      audience: {
        $in: [
          user.isDriver ? NewsAudience.Driver : NewsAudience.Rider,
          NewsAudience.Both,
        ],
      },
      publishedAt: { $lte: new Date() },
      deleted: { $ne: true },
    };
  }

  private payloadFields(payload: CreateNewsDTO | UpdateNewsDTO) {
    return {
      title: payload.title,
      summary: payload.summary,
      body: payload.body,
      audience: payload.audience,
      status: payload.status,
      publishedAt:
        payload.status === NewsStatus.Published
          ? new Date(payload.publishedAt || Date.now())
          : payload.publishedAt
          ? new Date(payload.publishedAt)
          : undefined,
      coverImageUrl: payload.coverImageUrl,
    };
  }

  private async uniqueSlug(title: string) {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'news';
    const exists = await this.db.newsArticles.exists({ slug: base });
    return exists ? `${base}-${Date.now()}` : base;
  }
}
