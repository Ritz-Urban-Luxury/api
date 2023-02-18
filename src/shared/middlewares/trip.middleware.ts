import { Injectable, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DatabaseService } from 'src/database/database.service';
import { UserDocument } from 'src/database/schemas/user.schema';

@Injectable()
export class TripMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const user = req.user as UserDocument;
    const _id = req.params.trip;

    const trip = await this.db.trips.findOne({
      _id,
      $or: [{ user: user.id }, { driver: user.id }],
    });
    if (!trip) {
      throw new NotFoundException('trip not found');
    }

    req.trip = trip;

    next();
  }
}
