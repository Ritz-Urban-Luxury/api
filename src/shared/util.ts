import { BadRequestException, ValidationError } from '@nestjs/common';
import { isMongoId } from 'class-validator';
import {
  CountryCode,
  PhoneNumberFormat,
  PhoneNumberUtil,
} from 'google-libphonenumber';

const phoneUtil = PhoneNumberUtil.getInstance();

const countryPhoneFormat: Record<string, (x: string) => string> = {
  NG(phoneNumber: string) {
    return `0${phoneNumber.substring(Math.max(phoneNumber.length - 10, 0))}`;
  },
};

export class Util {
  /**
   * Safely turn a mongoose ref (ObjectId | populated doc | string) into a hex id.
   * Never use ObjectId.id — that is a 12-byte Buffer and String(buffer) is garbage.
   */
  static resolveDocumentId(ref: unknown): string | null {
    if (ref == null) {
      return null;
    }

    if (typeof ref === 'string') {
      return isMongoId(ref) ? ref : null;
    }

    if (typeof ref !== 'object') {
      return null;
    }

    const asHex =
      typeof (ref as { toHexString?: () => string }).toHexString === 'function'
        ? (ref as { toHexString: () => string }).toHexString()
        : null;
    if (asHex && isMongoId(asHex)) {
      return asHex;
    }

    const asString = String(ref);
    if (isMongoId(asString)) {
      return asString;
    }

    const doc = ref as { id?: unknown; _id?: unknown };
    if (typeof doc.id === 'string' && isMongoId(doc.id)) {
      return doc.id;
    }
    if (doc._id != null && doc._id !== ref) {
      return Util.resolveDocumentId(doc._id);
    }

    return null;
  }

  static formatValidationErrors(errorsToFromat: ValidationError[]) {
    return errorsToFromat.reduce((accumulator, error: ValidationError) => {
      let constraints: string | Record<string, unknown>;
      if (Array.isArray(error.children) && error.children.length) {
        constraints = this.formatValidationErrors(error.children);
      } else {
        const hasContraints = !!error.constraints;
        if (hasContraints) {
          let items = Object.values(error.constraints);
          const lastItem = items.pop();
          items = [items.join(', '), lastItem].filter((item) => item);
          constraints = items.join(' and ');
        } else {
          constraints = '';
        }
      }
      return {
        ...accumulator,
        [error.property]: constraints,
      };
    }, {} as Record<string, unknown>);
  }

  static formatPhoneNumber(phoneNumber: string, countryCode: CountryCode) {
    try {
      let _phoneNumber = phoneNumber;
      if (countryPhoneFormat[countryCode]) {
        _phoneNumber = countryPhoneFormat[countryCode](_phoneNumber);
      }

      const number = phoneUtil.parse(_phoneNumber, countryCode);
      const formatted = phoneUtil
        .format(number, PhoneNumberFormat.E164)
        .replace('+', '');
      return formatted;
    } catch (error) {
      throw new BadRequestException('invalid phonumber');
    }
  }

  static isPriObj(payload: unknown): payload is Record<string, unknown> {
    return payload !== null && typeof payload === 'object';
  }

  static calculateDistance(
    [lat1, lon1]: [number, number],
    [lat2, lon2]: [number, number],
  ) {
    const earthRadius = 6371; // Radius of the Earth in kilometers
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

    // Convert latitude and longitude to radians
    const phi1 = toRadians(lat1);
    const phi2 = toRadians(lat2);
    const deltaPhi = toRadians(lat2 - lat1);
    const deltaLambda = toRadians(lon2 - lon1);

    // Haversine formula
    const a =
      Math.sin(deltaPhi / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Calculate the distance in meters
    return earthRadius * c * 1000;
  }
}
