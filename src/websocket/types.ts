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
}

export type WebsocketEventType = WebsocketEvent | keyof typeof WebsocketEvent;
