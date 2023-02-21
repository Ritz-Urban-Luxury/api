import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Socket } from 'socket.io';
import { WebsocketEvent } from '../../websocket/types';

import { ValidationException } from '../exceptions/validation.exception';

@Catch(ValidationException)
export class WSValidationFilter implements ExceptionFilter {
  catch(exception: ValidationException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const status = HttpStatus.UNPROCESSABLE_ENTITY;

    client.emit(WebsocketEvent.UnprocessableEntity, {
      status,
      message: 'Validation Error',
      errors: exception.validationErrors,
      timestamp: new Date().toISOString(),
    });
  }
}
