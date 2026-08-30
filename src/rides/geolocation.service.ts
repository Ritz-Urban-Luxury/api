import { BadRequestException } from '@nestjs/common';
import config from 'src/shared/config';
import { Http } from 'src/shared/http';

type DirectionsLeg = {
  distance?: { value?: number };
  duration?: { value?: number };
  duration_in_traffic?: { value?: number };
};

type DirectionsResponse = {
  error_message?: string;
  routes?: Array<{
    legs?: DirectionsLeg[];
    overview_polyline?: {
      points?: string;
    };
  }>;
  status?: string;
};

type DistanceMatrixElement = {
  status?: string;
  distance?: { value?: number };
  duration?: { value?: number };
  duration_in_traffic?: { value?: number };
};

type DistanceMatrixResponse = {
  error_message?: string;
  rows?: Array<{
    elements?: DistanceMatrixElement[];
  }>;
  status?: string;
};

const TRAFFIC_AWARE_PARAMS = {
  departure_time: 'now',
  mode: 'driving',
  traffic_model: 'best_guess',
} as const;

const getLegDurationSeconds = (leg: DirectionsLeg) =>
  leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0;

const getMatrixDurationSeconds = (element: DistanceMatrixElement) =>
  element.duration_in_traffic?.value ?? element.duration?.value ?? 0;

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
        ...TRAFFIC_AWARE_PARAMS,
      },
    })
      .then((res) => {
        const data = res.data as DistanceMatrixResponse;
        const element = data.rows?.[0]?.elements?.[0];

        if (data.status !== 'OK' || element?.status !== 'OK') {
          throw new Error(data.error_message || data.status || 'NO_ROUTE');
        }

        return element.distance?.value ?? 0;
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
        ...TRAFFIC_AWARE_PARAMS,
      },
    })
      .then((res) => {
        const data = res.data as DistanceMatrixResponse;
        const element = data.rows?.[0]?.elements?.[0];

        if (data.status !== 'OK' || element?.status !== 'OK') {
          throw new Error(data.error_message || data.status || 'NO_ROUTE');
        }

        const durationSeconds = getMatrixDurationSeconds(element);

        return Math.max(1, Math.round(durationSeconds / 60));
      })
      .catch((error) => {
        throw new BadRequestException(`error getting eta - ${error.message}`);
      });
  }

  static async getDrivingRoute(from: [number, number], to: [number, number]) {
    if (config().turnOffGeolaction) {
      return {
        coordinates: [
          { latitude: from[0], longitude: from[1] },
          { latitude: to[0], longitude: to[1] },
        ],
        durationMinutes: 5,
        distanceMeters: 3000,
        polyline: null as string | null,
        trafficAware: false,
      };
    }

    const { mapsApiKey, mapsApiUrl } = config().google;

    try {
      const res = await Http.request({
        baseURL: mapsApiUrl,
        url: '/directions/json',
        params: {
          origin: `${from[0]},${from[1]}`,
          destination: `${to[0]},${to[1]}`,
          key: mapsApiKey,
          ...TRAFFIC_AWARE_PARAMS,
        },
      });

      const data = res.data as DirectionsResponse;
      const route = data.routes?.[0];
      const encoded = route?.overview_polyline?.points;
      const legs = route?.legs ?? [];
      const usedTraffic = legs.some(
        (leg) => typeof leg.duration_in_traffic?.value === 'number',
      );
      const durationSeconds = legs.reduce(
        (total, leg) => total + getLegDurationSeconds(leg),
        0,
      );
      const distanceMeters = legs.reduce(
        (total, leg) => total + (leg.distance?.value ?? 0),
        0,
      );

      if (data.status !== 'OK' || !encoded) {
        throw new Error(data.error_message || data.status || 'NO_ROUTE');
      }

      return {
        coordinates: GeolocationService.decodePolyline(encoded),
        durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
        distanceMeters,
        polyline: encoded,
        trafficAware: usedTraffic,
      };
    } catch (error) {
      throw new BadRequestException(
        `error getting driving route - ${(error as Error).message}`,
      );
    }
  }

  /** Decode an encoded Google polyline into lat/lng points. */
  static decodePolyline(encoded: string) {
    const coordinates: Array<{ latitude: number; longitude: number }> = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let byte: number;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      latitude += deltaLat;

      result = 0;
      shift = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      longitude += deltaLng;

      coordinates.push({
        latitude: latitude / 1e5,
        longitude: longitude / 1e5,
      });
    }

    return coordinates;
  }
}
