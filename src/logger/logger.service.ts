import { LoggerService, LogLevel } from '@nestjs/common';
import {
  createLogger,
  format,
  Logger as WinstonLogger,
  transports,
} from 'winston';

export class Logger implements LoggerService {
  private readonly logger: WinstonLogger;

  private logLevels: LogLevel[] = [];

  constructor() {
    const logger = createLogger({
      level: '',
      format: format.combine(format.timestamp(), format.simple()),
    });

    logger.add(new transports.Console());

    this.logger = logger;
  }

  private canLog(level: LogLevel) {
    return !this.logLevels.length || this.logLevels.includes(level);
  }

  log(message: string, ...optionalParams: unknown[]) {
    if (this.canLog('log')) {
      this.logger.info(message, ...optionalParams);
    }
  }

  error(message: string, ...optionalParams: unknown[]) {
    if (this.canLog('error')) {
      this.logger.error(message, ...optionalParams);
    }
  }

  warn(message: string, ...optionalParams: unknown[]) {
    if (this.canLog('warn')) {
      this.logger.warn(message, ...optionalParams);
    }
  }

  debug(message: string, ...optionalParams: unknown[]) {
    if (this.canLog('debug')) {
      this.logger.debug(message, ...optionalParams);
    }
  }

  verbose(message: string, ...optionalParams: unknown[]) {
    if (this.canLog('verbose')) {
      this.logger.verbose(message, ...optionalParams);
    }
  }

  setLogLevels?(levels: LogLevel[]) {
    this.logLevels = levels;
  }
}
