/**
 * Timeline project file IPC channels (S5). Open/save go through main
 * `dialog` + fs so the renderer never touches the filesystem directly.
 * Playback channels (play/pause/seek) belong to S6.
 */
export const ProjectChannels = {
  open: "project:open",
  save: "project:save",
} as const;

/**
 * Timeline playback channels (S6). `timeline:*` is bidirectional load/play/
 * pause/stop/seek; `playback:time` is M→R head position throttled to 30–60fps
 * (01-SYSTEM-ARCHITECTURE.md §6).
 */
export const TimelineChannels = {
  load: "timeline:load",
  play: "timeline:play",
  pause: "timeline:pause",
  stop: "timeline:stop",
  seek: "timeline:seek",
  stateChanged: "timeline:stateChanged",
  playbackTime: "playback:time",
} as const;