export class GeolocationService {
  static async getDistance(_from: [number, number], _to: [number, number]) {
    // TODO: use a geolocation service provider
    return Promise.resolve(25100);
  }
}
