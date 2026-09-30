import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import { NewsService } from './news.service';

@Controller('news')
@UseGuards(JwtGuard)
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  async list(@CurrentUser() user: UserDocument) {
    return Response.json('news articles', await this.news.driverList(user));
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: UserDocument) {
    return Response.json(
      'news unread count',
      await this.news.unreadCount(user),
    );
  }

  @Get(':id')
  async detail(
    @CurrentUser() user: UserDocument,
    @Param('id') articleId: string,
  ) {
    return Response.json(
      'news article',
      await this.news.driverDetail(user, articleId),
    );
  }

  @Post(':id/read')
  async markRead(
    @CurrentUser() user: UserDocument,
    @Param('id') articleId: string,
  ) {
    return Response.json(
      'news article read',
      await this.news.markRead(user, articleId),
    );
  }
}
