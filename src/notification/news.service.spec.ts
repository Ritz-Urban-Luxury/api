import {
  NewsAudience,
  NewsStatus,
} from '../database/schemas/news-article.schema';
import { NewsService } from './news.service';

describe('NewsService', () => {
  const admin = { id: '64a000000000000000000001' } as never;
  let db: {
    newsArticles: {
      findOne: jest.Mock;
      findOneAndUpdate: jest.Mock;
    };
  };
  let service: NewsService;

  beforeEach(() => {
    db = {
      newsArticles: {
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
      },
    };
    service = new NewsService(db as never);
  });

  it('inserts the default driver welcome article without overwriting edits', async () => {
    db.newsArticles.findOneAndUpdate.mockResolvedValue({ id: 'welcome' });

    await service.onModuleInit();

    expect(db.newsArticles.findOneAndUpdate).toHaveBeenCalledWith(
      { slug: 'welcome-to-ritz-driver' },
      {
        $set: {
          coverImageUrl: 'asset://ritz-driver-welcome',
        },
        $setOnInsert: expect.objectContaining({
          audience: NewsAudience.Driver,
          isDefault: true,
          status: NewsStatus.Published,
          title: 'Welcome to Ritz Driver',
        }),
      },
      { new: true, upsert: true },
    );
  });

  it('keeps the default article published for drivers when its message is edited', async () => {
    const unsafeProtocol = ['java', 'script:'].join('');
    db.newsArticles.findOne.mockResolvedValue({ isDefault: true });
    db.newsArticles.findOneAndUpdate.mockResolvedValue({ id: 'welcome' });

    await service.update(admin, 'welcome', {
      audience: NewsAudience.Rider,
      body: 'An updated welcome message.',
      bodyHtml: `<p onclick="alert(1)" style="text-align:center">Welcome <a href="${unsafeProtocol}alert(1)">here</a></p><script>alert(1)</script>`,
      bodyJson: {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      },
      contentVersion: 1,
      coverImageUrl: 'asset://ritz-driver-welcome',
      status: NewsStatus.Archived,
      summary: 'Updated summary',
      title: 'Updated welcome',
    });

    expect(db.newsArticles.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'welcome', deleted: { $ne: true } },
      {
        $set: expect.objectContaining({
          audience: NewsAudience.Driver,
          body: 'An updated welcome message.',
          status: NewsStatus.Published,
          title: 'Updated welcome',
          updatedBy: '64a000000000000000000001',
        }),
      },
      { new: true, upsert: false },
    );
    const update = db.newsArticles.findOneAndUpdate.mock.calls[0][1].$set;
    expect(update.bodyHtml).toContain('style="text-align:center"');
    expect(update.bodyHtml).not.toContain('onclick');
    expect(update.bodyHtml).not.toContain(unsafeProtocol);
    expect(update.bodyHtml).not.toContain('<script');
  });
});
