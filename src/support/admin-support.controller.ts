import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  AdminGetSupportComplaintsDTO,
  AdminUpdateSupportComplaintDTO,
} from './dto/support-complaint.dto';
import { SupportService } from './support.service';

@Controller('admin/support')
@UseGuards(AdminJwtGuard)
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('complaints')
  async getComplaints(@Query() query: AdminGetSupportComplaintsDTO) {
    const { docs, ...meta } = await this.support.getComplaints(query);
    return Response.json('support complaints', docs, meta);
  }

  @Patch('complaints/:complaintId')
  async updateComplaint(
    @Param('complaintId') complaintId: string,
    @Body() payload: AdminUpdateSupportComplaintDTO,
    @CurrentUser() admin: UserDocument,
  ) {
    const complaint = await this.support.updateComplaint(
      complaintId,
      payload,
      admin,
    );
    return Response.json('support complaint updated', complaint);
  }
}
