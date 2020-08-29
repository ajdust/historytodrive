export type LogMessage = {
  action: "log";
  data: string;
};

export type TrackData = {
  url: string;
  host: string;
  title: string;
};

export type TrackingDataMessage = {
  action: "track";
  data: TrackData;
};

export type EnableTrackingMessage = {
  action: "enable_tracking";
};

export type DisableTrackingMessage = {
  action: "disable_tracking";
};

export type PopupNeedsInitMessage = {
  action: "popup_needs_init";
};

export type TrackingIsEnabledMessage = {
  action: "tracking_is_enabled";
  url: string;
};

export type TrackingIsDisabledMessage = {
  action: "tracking_is_disabled";
};

export type SentToBackgroundMessage =
  | LogMessage
  | TrackingDataMessage
  | EnableTrackingMessage
  | DisableTrackingMessage
  | PopupNeedsInitMessage;

export type SentToPopupMessage =
  | TrackingIsDisabledMessage
  | TrackingIsEnabledMessage;
