import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from './logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);
  const port = configService.get<string>('port');
  const logger = app.get(Logger);

  app.useLogger(logger);

  await app.listen(port);
  logger.log(`Running on port ${port}`);
}
bootstrap();
