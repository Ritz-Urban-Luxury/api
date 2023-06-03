import { BadRequestException } from '@nestjs/common';
import config from 'src/shared/config';
import { Http } from 'src/shared/http';

export class GeolocationService {
  static async getDistance(from: [number, number], to: [number, number]) {
    if (config().turnOffGeolaction) {
      return 3000;
    }

    const { mapsApiKey, mapsApiUrl } = config().google;

    return Http.request({
      baseURL: mapsApiUrl,
      url: '/distancematrix/json',
      params: {
        origins: `${from[0]},${from[1]}`,
        destinations: `${to[0]},${to[1]}`,
        key: mapsApiKey,
      },
    })
      .then((res) => {
        const data = res.data as Record<string, unknown>;

        if (data.status !== 'OK') {
          throw new Error(data.status as string);
        }

        return (
          data.rows as {
            elements: { distance: { value: number } }[];
          }[]
        )[0].elements[0].distance.value;
      })
      .catch((error) => {
        throw new BadRequestException(
          `error getting distance - ${error.message}`,
        );
      });
  }

  static async getETA(from: [number, number], to: [number, number]) {
    if (config().turnOffGeolaction) {
      return 5;
    }

    const { mapsApiKey, mapsApiUrl } = config().google;

    return Http.request({
      baseURL: mapsApiUrl,
      url: '/distancematrix/json',
      params: {
        origins: `${from[0]},${from[1]}`,
        destinations: `${to[0]},${to[1]}`,
        key: mapsApiKey,
      },
    })
      .then((res) => {
        const data = res.data as Record<string, unknown>;

        if (data.status !== 'OK') {
          throw new Error(data.status as string);
        }

        return Math.round(
          (
            data.rows as {
              elements: { duration: { value: number } }[];
            }[]
          )[0].elements[0].duration.value / 60,
        );
      })
      .catch((error) => {
        throw new BadRequestException(`error getting eta - ${error.message}`);
      });
  }
}
