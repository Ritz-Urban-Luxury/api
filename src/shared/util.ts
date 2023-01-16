import { ValidationError } from '@nestjs/common';

export class Util {
  static randomAlphabetic = 'abcdefghijklmnopqrstuvwxyz';

  static randomAlphanumeric = 'a1b2c3d4e5f6g7h8i9j0klmnopqrstuvwxyz';

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
}
