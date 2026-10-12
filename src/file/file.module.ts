import { Global, Module } from '@nestjs/common';
import { FileService } from './file.service';
import { AdminFileController, FileController } from './file.controller';

@Global()
@Module({
  providers: [FileService],
  exports: [FileService],
  controllers: [FileController, AdminFileController],
})
export class FileModule {}
