import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Response } from 'src/shared/response';
import {
  RequestEmailOTPDTO,
  RequestPhoneOTPDTO,
  SignupDTO,
} from './authentication.dto';
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

  @HttpCode(HttpStatus.CREATED)
  @Post('email-otp')
  async requestEmailOtp(@Body() payload: RequestEmailOTPDTO) {
    await this.authenticationService.requestEmailOtp(payload);

    return Response.json('otp sent');
  }

  @Post('signup')
  async signup(@Body() payload: SignupDTO) {
    const loggedInUser = await this.authenticationService.signUp(payload);

    return Response.json('sign up successful', loggedInUser);
  }

  @Get('check/:key')
  async getUser(@Param('key') key: string) {
    const user = await this.authenticationService.getUser(key);

    return Response.json('user found', user);
  }
}
