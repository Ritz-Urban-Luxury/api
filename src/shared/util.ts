import { BadRequestException, ValidationError } from '@nestjs/common';
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
}
