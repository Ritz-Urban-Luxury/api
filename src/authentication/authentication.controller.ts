import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Response } from 'src/shared/response';
import { RequestPhoneOTPDTO } from './authentication.dto';
import { AuthenticationService } from './authentication.service';

@Controller({ path: 'authentication' })
export class AuthenticationController {
  constructor(private readonly authenticationService: AuthenticationService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post('phone-otp')
  async requestPhoneOtp(@Body() payload: RequestPhoneOTPDTO) {
    await this.authenticationService.requestPhoneOtp(payload);

    return Response.json('otp sent');
  }
}
