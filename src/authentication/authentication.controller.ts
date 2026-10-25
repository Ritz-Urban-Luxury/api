import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  LoginDTO,
  DriverSignupDTO,
  RequestEmailOTPDTO,
  RequestPhoneOTPDTO,
  ResetPasswordDTO,
  SignupDTO,
  VerifyOtpDTO,
} from './authentication.dto';
import { AuthenticationService } from './authentication.service';
import { AdminJwtGuard } from './guards/jwt.guard';

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

  @Post('driver-signup')
  async driverSignup(@Body() payload: DriverSignupDTO) {
    const loggedInUser = await this.authenticationService.signUpDriver(payload);

    return Response.json('driver sign up successful', loggedInUser);
  }

  @Get('check/:key')
  async getUser(@Param('key') key: string) {
    const user = await this.authenticationService.getUser(key);

    return Response.json('user found', user);
  }

  @Post('login')
  async login(@Body() payload: LoginDTO) {
    const loggedInUser = await this.authenticationService.login(payload);

    return Response.json('login successful', loggedInUser);
  }

  @UseGuards(AdminJwtGuard)
  @Get('admin-session')
  adminSession(@CurrentUser() user: UserDocument) {
    return Response.json('admin session', user);
  }

  @Post('reset-password')
  async resetPassword(@Body() payload: ResetPasswordDTO) {
    const loggedInUser = await this.authenticationService.resetPassword(
      payload,
    );

    return Response.json('password updated', loggedInUser);
  }

  /**
   * Validates a code only against the identifier it was issued for.  Do not
   * restore the old public `check-otp/:otp` route: it acted as an OTP oracle.
   */
  @Post('verify-otp')
  async verifyOtp(@Body() payload: VerifyOtpDTO) {
    const res = await this.authenticationService.verifyOtp(payload);

    return Response.json('otp verified', res);
  }
}
