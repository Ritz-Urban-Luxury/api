import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { clientIp } from '../shared/client-ip';
import { Response } from '../shared/response';
import { ContactService } from './contact.service';
import { ContactMessageDTO } from './dto/contact-message.dto';

@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  async send(@Body() body: ContactMessageDTO, @Req() req: Request) {
    await this.contact.send(body, clientIp(req));
    return Response.json('message sent');
  }
}
