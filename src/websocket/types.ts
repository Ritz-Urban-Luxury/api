export enum WebsocketEvent {
  RideRequestCancelled = 'RideRequestCancelled',
  RideRequest = 'RideRequest',
  DriversBusy = 'DriversBusy',
  ConnectingToDriver = 'ConnectingToDriver',
  TripStarted = 'TripStarted',
  TripCancelled = 'TripCancelled',
  NewMessage = 'NewMessage',
  RideLocation = 'RideLocation',
  UnprocessableEntity = 'UnprocessableEntity',
  RideETA = 'RideETA',
  DriverArrival = 'DriverArrival',
  TripInProgress = 'TripInProgress',
  TripEnded = 'TripEnded',
  PaymentFailed = 'PaymentFailed',
}

export type WebsocketEventType = WebsocketEvent | keyof typeof WebsocketEvent;

export interface RideLocationEventPayload {
  accuracy?: number;
  tripId: string;
  rideId: string;
  lat: number;
  lon: number;
  heading?: number;
  recordedAt: string;
  sequence?: number;
  speed?: number;
  updatedAt: string;
}
