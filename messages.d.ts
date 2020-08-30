declare namespace MessageToBackground {
  export type Log = {
    action: "log";
    data: string;
  };

  export type TrackData = {
    url: string;
    host: string;
    title: string;
  };

  export type Track = {
    action: "track";
    data: TrackData;
  };

  export type EnableTracking = {
    action: "enable_tracking";
  };

  export type DisableTracking = {
    action: "disable_tracking";
  };

  export type PopupNeedsInit = {
    action: "popup_needs_init";
  };

  export type Any =
    | Log
    | Track
    | EnableTracking
    | DisableTracking
    | PopupNeedsInit;
}

declare namespace MessageToPopup {
  export type EnabledTracking = {
    action: "tracking_is_enabled";
    url: string;
  };

  export type DisabledTracking = {
    action: "tracking_is_disabled";
  };

  export type Any = DisabledTracking | EnabledTracking;
}
