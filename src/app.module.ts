import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as mongooseDelete from 'mongoose-delete';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthenticationModule } from './authentication';
import { FileModule } from './file/file.module';
import { LoggerModule } from './logger/logger.module';
import { PaymentModule } from './payments/payment.module';
import config from './shared/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [config] }),
    LoggerModule,
    AuthenticationModule,
    MongooseModule.forRoot(config().database.url, {
      connectionFactory(connection) {
        connection.plugin(mongooseDelete, {
          overrideMethods: true,
          deletedAt: true,
        });
        return connection;
      },
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }),
    FileModule,
    PaymentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
