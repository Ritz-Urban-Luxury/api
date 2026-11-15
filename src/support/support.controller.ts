import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import { CreateSupportComplaintDTO } from './dto/support-complaint.dto';
import { SupportService } from './support.service';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** Public so the app can show the address even before sign-in. */
  @Get('contact')
  getContact() {
    return Response.json('support contact', this.support.getContact());
  }

  @Post('complaints')
  @UseGuards(JwtGuard)
  async createComplaint(
    @CurrentUser() user: UserDocument,
    @Body() payload: CreateSupportComplaintDTO,
  ) {
    const complaint = await this.support.createComplaint(user, payload);
    return Response.json('complaint received', complaint);
  }
}
