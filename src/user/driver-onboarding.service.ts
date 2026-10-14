import { BadRequestException, Injectable } from '@nestjs/common';
import { ReferralService } from '../database/referral.service';
import { UserDocument } from '../database/schemas/user.schema';
import { RidesService } from '../rides/rides.service';
import { CompleteDriverOnboardingDTO } from './dto/driver-onboarding.dto';
import { UserService } from './user.service';

@Injectable()
export class DriverOnboardingService {
  constructor(
    private readonly users: UserService,
    private readonly referrals: ReferralService,
    private readonly rides: RidesService,
  ) {}

  async complete(user: UserDocument, payload: CompleteDriverOnboardingDTO) {
    if (!user.isDriver) {
      throw new BadRequestException('driver account required');
    }

    const isFleetOwner = Boolean(user.vehiclesInFleet?.trim());
    if (
      isFleetOwner &&
      (!payload.companyName?.trim() || !payload.registrationCode?.trim())
    ) {
      throw new BadRequestException(
        'company name and registration code are required for fleet owners',
      );
    }

    const updatedUser = await this.users.updateUser(user, {
      accountNumber: payload.accountNumber,
      address: payload.address,
      avatar: payload.avatar,
      avatarSource: payload.avatarSource,
      bank: payload.bank,
      bankHolderName: payload.bankHolderName,
      billingType: isFleetOwner ? 'company' : 'individual',
      companyName: payload.companyName,
      email: undefined,
      emailOtp: undefined,
      firstName: payload.firstName,
      lastName: payload.lastName,
      license: payload.license,
      licenseExpiry: payload.licenseExpiry,
      licenseNumber: payload.licenseNumber,
      registrationCode: payload.registrationCode,
      vatNumber: payload.vatNumber,
    });

    const referralCode = payload.referralCode?.trim();
    const referral = referralCode
      ? await this.referrals.applyReferralCodeIdempotent(
          updatedUser,
          referralCode,
        )
      : null;

    const vehicle = await this.rides.createOnboardingRide(updatedUser, {
      brand: payload.vehicle.brand,
      color: payload.vehicle.color,
      images: [
        ...payload.vehicle.exteriorImages,
        ...payload.vehicle.interiorImages,
      ],
      model: payload.vehicle.model,
      registration: payload.vehicle.registration,
      specs: {
        seats: payload.vehicle.seats,
        year: payload.vehicle.year,
      },
    });

    return { referral, user: updatedUser, vehicle };
  }
}
