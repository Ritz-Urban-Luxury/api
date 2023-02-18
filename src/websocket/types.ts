export enum WebsocketEvent {
  RideRequest = 'RideRequest',
  DriversBusy = 'DriversBusy',
  ConnectingToDriver = 'ConnectingToDriver',
  TripStarted = 'TripStarted',
  TripCancelled = 'TripCancelled',
}

export type WebsocketEventType = WebsocketEvent | keyof typeof WebsocketEvent;
