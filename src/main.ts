import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Logger } from './logger/logger.service';
import cors from './shared/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    cors,
    bodyParser: true,
  });
  const configService = app.get(ConfigService);
  const port = configService.get<string>('port');
  const logger = app.get(Logger);

  app.useLogger(logger);
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ limit: '100mb', extended: true }));
  app.use(helmet());

  await app.listen(port);
  logger.log(`Running on port ${port}`);
}
bootstrap();
