import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { clientIp } from '../shared/client-ip';
import config from '../shared/config';
import { Response } from '../shared/response';
import { JoinWaitlistDTO } from './dto/waitlist.dto';
import { WaitlistService } from './waitlist.service';

const page = (title: string, message: string) => {
  const { siteUrl } = config().waitlist;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title} | Ritz Urban Luxury</title>
  </head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fdfbfe;color:#2a0a3a;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:420px;margin:24px;padding:32px;border:2px solid #2a0a3a;border-radius:22px;background:#fff;box-shadow:0 6px 0 #2a0a3a;text-align:center;">
      <h1 style="margin:0 0 12px;font-size:24px;color:#4b0c67;">${title}</h1>
      <p style="margin:0 0 24px;line-height:1.5;color:#5f5169;">${message}</p>
      <a href="${siteUrl}/" style="color:#4b0c67;font-weight:bold;">Go to ritzurbanluxury.com</a>
    </main>
  </body>
</html>`;
};

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Post()
  async join(@Body() body: JoinWaitlistDTO, @Req() req: Request) {
    await this.waitlist.join(body, clientIp(req));
    return Response.json("you're on the waiting list");
  }

  /** Linked from every waiting-list email, so it answers with a page rather than JSON. */
  @Get('unsubscribe')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Query('token') token?: string) {
    const found =
      typeof token === 'string' && (await this.waitlist.unsubscribe(token));
    return found
      ? page(
          "You're unsubscribed",
          "We won't email you about the app launch again. If that was a mistake, you can join the waiting list again on our website.",
        )
      : page(
          'Link not recognised',
          'This unsubscribe link is invalid or has expired. Write to support@ritzurbanluxury.com and we will remove you by hand.',
        );
  }
}
