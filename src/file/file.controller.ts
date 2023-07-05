import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Response } from 'src/shared/response';
import { JwtGuard } from 'src/authentication/guards/jwt.guard';
import { FileUploadDTO } from './dto/file-upload.dto';
import { FileService } from './file.service';

@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(JwtGuard)
  @Post()
  async uploadFile(@Body() payload: FileUploadDTO) {
    const file = await this.fileService.uploadFile(payload);

    return Response.json('file uploaded', file);
  }
}
