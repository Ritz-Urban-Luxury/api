import {
  ValidationError,
  ValidationPipe as VP,
  ValidationPipeOptions,
} from '@nestjs/common';
import { ValidationException } from '../exceptions/validation.exception';

import { Util } from '../util';

export class ValidationPipe extends VP {
  constructor(options?: ValidationPipeOptions) {
    super({
      whitelist: true,
      forbidNonWhitelisted: true, // Turn on to block non whitelisted values
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors: ValidationError[]) => {
        const messages = Util.formatValidationErrors(errors);

        return new ValidationException(messages);
      },
      ...options,
    });
  }
}
