import { Injectable } from '@nestjs/common';
import * as cloudinary from 'cloudinary';
import config from '../shared/config';
import { Http } from '../shared/http';
import { FileUploadDTO } from './dto/file-upload.dto';

@Injectable()
export class FileService {
  constructor() {
    const { name, key, secret } = config().cloudinary;

    cloudinary.v2.config({
      cloud_name: name,
      api_key: key,
      api_secret: secret,
    });
  }

  async uploadFile(fileUploandDTO: FileUploadDTO) {
    try {
      const { data, filename } = fileUploandDTO;
      if (!data?.startsWith('data:')) {
        throw new Error('invalid file payload');
      }

      const result = await cloudinary.v2.uploader.upload(data, {
        resource_type: 'auto',
        public_id: filename,
      });

      return result.secure_url;
    } catch (error: any) {
      const cloudinaryMessage =
        error?.message ||
        error?.error?.message ||
        (typeof error?.error === 'string' ? error.error : undefined) ||
        'unknown upload failure';
      const wrapped = new Error(`FILE UPLOAD ERROR: ${cloudinaryMessage}`);
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
  }

  async uploadUrl(url: string) {
    const { data: res, headers } = await Http.request<string>({
      method: 'GET',
      url,
      responseType: 'arraybuffer',
    });
    const base64 = Buffer.from(res, 'binary').toString('base64');
    const contentType = headers['content-type'];
    const data = `data:${contentType};base64,${base64}`;

    return this.uploadFile({
      filename: Math.random().toString(32).substring(2),
      data,
    });
  }
}
