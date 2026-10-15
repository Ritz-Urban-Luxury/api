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
    } catch (error: unknown) {
      const uploadError = error as {
        message?: string;
        error?: { message?: string } | string;
      };
      const cloudinaryMessage =
        uploadError.message ||
        (typeof uploadError.error === 'object'
          ? uploadError.error?.message
          : uploadError.error) ||
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

  private cloudinaryPublicId(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'res.cloudinary.com') return null;
      const marker = '/upload/';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex < 0) return null;
      const segments = parsed.pathname
        .slice(markerIndex + marker.length)
        .split('/')
        .filter(Boolean);
      if (/^v\d+$/.test(segments[0])) segments.shift();
      if (!segments.length) return null;
      return decodeURIComponent(segments.join('/')).replace(/\.[^.]+$/, '');
    } catch {
      return null;
    }
  }

  async deleteUrls(urls: Array<string | undefined>): Promise<string[]> {
    const failed: string[] = [];
    const uniqueUrls = [...new Set(urls.filter((url): url is string => !!url))];

    await Promise.all(
      uniqueUrls.map(async (url) => {
        const publicId = this.cloudinaryPublicId(url);
        if (!publicId) return;
        try {
          await cloudinary.v2.uploader.destroy(publicId, {
            invalidate: true,
            resource_type: 'image',
          });
        } catch {
          failed.push(url);
        }
      }),
    );

    return failed;
  }
}
