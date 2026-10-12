import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../authentication/guards/jwt.guard';
import { PricingService } from '../database/pricing.service';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import { PricingZoneDTO, UpdatePricingDTO } from './dto/pricing.dto';

@Controller('admin/pricing')
@UseGuards(AdminJwtGuard)
export class AdminPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  async get() {
    return Response.json(
      'ride pricing',
      await this.pricing.getSettingsForAdmin(),
    );
  }

  @Put()
  async update(
    @CurrentUser() admin: UserDocument,
    @Body() payload: UpdatePricingDTO,
  ) {
    return Response.json(
      'ride pricing updated',
      await this.pricing.update(admin.id, payload),
    );
  }

  @Get('history')
  async history() {
    return Response.json('ride pricing history', await this.pricing.history());
  }

  @Get('zones')
  async listZones() {
    return Response.json('pricing locations', await this.pricing.listZones());
  }

  @Post('zones')
  async createZone(
    @CurrentUser() admin: UserDocument,
    @Body() payload: PricingZoneDTO,
  ) {
    return Response.json(
      'pricing location created',
      await this.pricing.createZone(admin.id, payload),
    );
  }

  @Patch('zones/:zoneId')
  async updateZone(
    @CurrentUser() admin: UserDocument,
    @Param('zoneId') zoneId: string,
    @Body() payload: PricingZoneDTO,
  ) {
    return Response.json(
      'pricing location updated',
      await this.pricing.updateZone(admin.id, zoneId, payload),
    );
  }

  @Delete('zones/:zoneId')
  async deleteZone(
    @CurrentUser() admin: UserDocument,
    @Param('zoneId') zoneId: string,
  ) {
    return Response.json(
      'pricing location deleted',
      await this.pricing.deleteZone(admin.id, zoneId),
    );
  }
}
