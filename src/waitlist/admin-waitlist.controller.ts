import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import { ListWaitlistDTO, WaitlistAudienceDTO } from './dto/waitlist.dto';
import { WaitlistService } from './waitlist.service';

@Controller('admin/waitlist')
@UseGuards(AdminJwtGuard)
export class AdminWaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  async list(@Query() query: ListWaitlistDTO) {
    const { entries, meta } = await this.waitlist.list(query);
    return Response.json('waiting list', entries, meta);
  }

  @Get('summary')
  async summary() {
    return Response.json('waiting list summary', await this.waitlist.summary());
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ritz-waitlist.csv"')
  async export() {
    return this.waitlist.exportCsv();
  }

  @Post('test')
  async test(
    @CurrentUser() admin: UserDocument,
    @Body() payload: WaitlistAudienceDTO,
  ) {
    return Response.json(
      'test launch email sent',
      await this.waitlist.sendTest(admin.email, payload.audience),
    );
  }

  @Post('send')
  async send(@Body() payload: WaitlistAudienceDTO) {
    return Response.json(
      'launch email started',
      await this.waitlist.sendLaunch(payload.audience),
    );
  }
}
