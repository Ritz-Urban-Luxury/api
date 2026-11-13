import { Controller, Get, Header } from '@nestjs/common';
import { Response } from '../shared/response';
import {
  DEFAULT_COUNTRY_CODE,
  SUPPORTED_COUNTRIES,
} from './countries.constants';

@Controller('countries')
export class CountriesController {
  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  list() {
    return Response.json('supported countries', {
      countries: SUPPORTED_COUNTRIES,
      defaultCountryCode: DEFAULT_COUNTRY_CODE,
    });
  }
}
