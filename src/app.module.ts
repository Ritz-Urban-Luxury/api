import { CacheModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import * as redisStore from 'cache-manager-redis-store';
// import * as mongooseDelete from 'mongoose-delete';
// import * as mongoosePaginate from 'mongoose-paginate-v2';
import { RedisClientOptions } from 'redis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// import { AuthenticationModule } from './authentication';
// import { DatabaseModule } from './database/database.module';
import { FileModule } from './file/file.module';
import { LoggerModule } from './logger/logger.module';
// import { PaymentModule } from './payments/payment.module';
// import { RidesModule } from './rides/rides.module';
import config from './shared/config';
// import { UserModule } from './user/user.module';
// import { WebsocketModule } from './websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [config] }),
    LoggerModule,
    // AuthenticationModule,
    MongooseModule.forRoot(config().database.url, {
      //   connectionFactory(connection) {
      //     connection.plugin(mongoosePaginate);
      //     connection.plugin(mongooseDelete, {
      //       overrideMethods: true,
      //       deletedAt: true,
      //     });
      //     return connection;
      //   },
      //   useNewUrlParser: true,
      //   useUnifiedTopology: true,
    }),
    FileModule,
    //     PaymentModule,
    CacheModule.registerAsync<RedisClientOptions>({
      isGlobal: true,
      useFactory() {
        const { cache, redis } = config();

        if (redis.url) {
          return {
            ttl: cache.ttl,
            url: redis.url,
            password: redis.password,
            store: redisStore as unknown as string,
          };
        }

        return { ttl: cache.ttl };
      },
    }),
    //     RidesModule,
    //     WebsocketModule,
    //     DatabaseModule,
    //     UserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
