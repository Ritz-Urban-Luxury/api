import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  CreateServiceLocationDTO,
  UpdateServiceLocationDTO,
} from './dto/location.dto';

const DEFAULT_LOCATIONS = [
  { name: 'Abuja', code: 'abuja', displayOrder: 10 },
  { name: 'Lagos', code: 'lagos', displayOrder: 20 },
  { name: 'Port Harcourt', code: 'port-harcourt', displayOrder: 30 },
] as const;

@Injectable()
export class LocationsService {
  constructor(private readonly db: DatabaseService) {}

  private async ensureDefaults() {
    const exists = await this.db.serviceLocations.exists({
      deleted: { $ne: true },
    });
    if (exists) return;

    await Promise.all(
      DEFAULT_LOCATIONS.map((location) =>
        this.db.serviceLocations.updateOne(
          { code: location.code },
          {
            $setOnInsert: {
              ...location,
              active: true,
              country: 'Nigeria',
            },
          },
          { upsert: true },
        ),
      ),
    );
  }

  async listPublic() {
    await this.ensureDefaults();
    return this.db.serviceLocations
      .find({ active: true, deleted: { $ne: true } })
      .select(
        'name code country displayOrder inspectionAddress inspectionMapUrl',
      )
      .sort({ displayOrder: 1, name: 1 });
  }

  async listAdmin() {
    await this.ensureDefaults();
    return this.db.serviceLocations
      .find({ deleted: { $ne: true } })
      .sort({ displayOrder: 1, name: 1 });
  }

  async getActiveOrFail(locationId: string) {
    const location = await this.db.serviceLocations.findOne({
      _id: locationId,
      active: true,
      deleted: { $ne: true },
    });
    if (!location) {
      throw new NotFoundException(
        'This registration location is no longer available',
      );
    }
    return location;
  }

  async create(payload: CreateServiceLocationDTO) {
    const existing = await this.db.serviceLocations.exists({
      code: payload.code,
      deleted: { $ne: true },
    });
    if (existing) throw new ConflictException('location code already exists');
    return this.db.serviceLocations.create({
      ...payload,
      active: payload.active ?? true,
      country: payload.country || 'Nigeria',
      displayOrder: payload.displayOrder ?? 0,
    });
  }

  async update(locationId: string, payload: UpdateServiceLocationDTO) {
    const location = await this.db.serviceLocations.findOneAndUpdate(
      { _id: locationId, deleted: { $ne: true } },
      { $set: payload },
      { new: true, upsert: false },
    );
    if (!location) throw new NotFoundException('location not found');
    return location;
  }
}
