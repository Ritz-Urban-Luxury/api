import { CountriesController } from './countries.controller';

describe('CountriesController', () => {
  it('lists only Nigeria and makes it the default', () => {
    const response = new CountriesController().list() as unknown as {
      data: {
        countries: { code: string; dialCode: string; flag: string }[];
        defaultCountryCode: string;
      };
    };

    expect(response.data.defaultCountryCode).toBe('NG');
    expect(response.data.countries).toEqual([
      expect.objectContaining({ code: 'NG', dialCode: '+234', flag: '🇳🇬' }),
    ]);
  });
});
