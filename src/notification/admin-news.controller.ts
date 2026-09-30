import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import { CreateNewsDTO, UpdateNewsDTO } from './dto/news.dto';
import { NewsService } from './news.service';

@Controller('admin/news')
@UseGuards(AdminJwtGuard)
export class AdminNewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  async list() {
    return Response.json('news articles', await this.news.adminList());
  }

  @Post()
  async create(
    @CurrentUser() admin: UserDocument,
    @Body() payload: CreateNewsDTO,
  ) {
    return Response.json(
      'news article created',
      await this.news.create(admin, payload),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() admin: UserDocument,
    @Param('id') articleId: string,
    @Body() payload: UpdateNewsDTO,
  ) {
    return Response.json(
      'news article updated',
      await this.news.update(admin, articleId, payload),
    );
  }

  @Post(':id/archive')
  async archive(
    @CurrentUser() admin: UserDocument,
    @Param('id') articleId: string,
  ) {
    return Response.json(
      'news article archived',
      await this.news.archive(admin, articleId),
    );
  }
}
