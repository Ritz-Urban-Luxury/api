import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UserDocument } from 'src/database/schemas/user.schema';
import { UpdateUserDTO } from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(private readonly db: DatabaseService) {}

  async updateUser(user: UserDocument, update: UpdateUserDTO) {
    const { email, emailOtp } = update;
    if (email) {
      const _email = email.toLocaleLowerCase();
      const otp = await this.db.authTokens.findOne({
        'meta.email': _email,
        'meta.type': 'email-otp',
        token: emailOtp,
        deleted: { $ne: true },
        isUsed: { $ne: true },
        expiresAt: { $gte: new Date() },
      });
      if (!otp) {
        throw new BadRequestException('invalid email validation token');
      }
    }

    update.email = update.email?.toLowerCase();

    return this.db.users.findOneAndUpdate(
      { _id: user.id },
      { $set: update },
      { new: true, upsert: false },
    );
  }
}
