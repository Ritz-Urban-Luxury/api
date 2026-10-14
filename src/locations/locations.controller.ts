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
import { Response } from '../shared/response';
import {
  CreateServiceLocationDTO,
  SetServiceLocationStatusDTO,
  UpdateServiceLocationDTO,
} from './dto/location.dto';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  async list() {
    return Response.json(
      'registration locations',
      await this.locations.listPublic(),
    );
  }
}

@Controller('admin/locations')
@UseGuards(AdminJwtGuard)
export class AdminLocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  async list() {
    return Response.json('service locations', await this.locations.listAdmin());
  }

  @Post()
  async create(@Body() payload: CreateServiceLocationDTO) {
    return Response.json(
      'service location created',
      await this.locations.create(payload),
    );
  }

  @Patch(':locationId')
  async update(
    @Param('locationId') locationId: string,
    @Body() payload: UpdateServiceLocationDTO,
  ) {
    return Response.json(
      'service location updated',
      await this.locations.update(locationId, payload),
    );
  }

  @Patch(':locationId/status')
  async setStatus(
    @Param('locationId') locationId: string,
    @Body() payload: SetServiceLocationStatusDTO,
  ) {
    return Response.json(
      'service location status updated',
      await this.locations.update(locationId, { active: payload.active }),
    );
  }
}
