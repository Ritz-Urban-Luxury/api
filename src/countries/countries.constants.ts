export type SupportedCountry = {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
  phonePlaceholder: string;
  phoneDigits: number;
};

export const DEFAULT_COUNTRY_CODE = 'NG';

export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  {
    code: 'NG',
    name: 'Nigeria',
    dialCode: '+234',
    flag: '🇳🇬',
    phonePlaceholder: '0803 000 0000',
    phoneDigits: 11,
  },
];
