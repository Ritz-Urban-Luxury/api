import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Response } from '../shared/response';
import { ContactService } from './contact.service';
import { ContactMessageDTO } from './dto/contact-message.dto';

/** The API runs behind a proxy, so the visitor's address is the first x-forwarded-for entry. */
function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(',')[0]
    ?.trim();
  return first || req.ip || 'unknown';
}

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  async send(@Body() body: ContactMessageDTO, @Req() req: Request) {
    await this.contact.send(body, clientIp(req));
    return Response.json('message sent');
  }
}
