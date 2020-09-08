declare namespace Shared {
  export type TrackData = {
    timestamp: string;
    title: string;
    host: string;
    url: string;
    userAgent: string;
  };

  export type Tag = {
    enabled: boolean;
    text: string;
  };
}

declare namespace MessageToBackground {
  export type Log = {
    action: "log";
    data: string;
  };

  export type Track = {
    action: "track";
    data: Shared.TrackData;
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

  export type SetTags = {
    action: "set_tags";
    tags: Shared.Tag[];
  };

  export type Any =
    | Log
    | Track
    | EnableTracking
    | DisableTracking
    | PopupNeedsInit
    | SetTags;
}

declare namespace MessageToPopup {
  export type EnabledTracking = {
    action: "tracking_is_enabled";
    url: string;
    tags: Shared.Tag[];
  };

  export type DisabledTracking = {
    action: "tracking_is_disabled";
    error: string | undefined;
  };

  export type Any = DisabledTracking | EnabledTracking;
}
