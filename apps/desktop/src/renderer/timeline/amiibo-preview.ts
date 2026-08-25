import type { Project } from "@ns2-studio/timeline-model";

/**
 * S10 播放预览提示：给定工程与当前播放头位置，返回「下一个将切换的 Amiibo 槽位」。
 * 纯函数，无 DOM / 无状态，便于单测。
 */
export interface AmiiboHint {
  slot: number;
  atMs: number;
}

export function nextAmiiboHint(
  project: Project,
  positionMs: number,
): AmiiboHint | null {
  let best: AmiiboHint | null = null;
  for (const track of project.tracks) {
    if (track.type !== "amiibo") continue;
    for (const clip of track.clips) {
      // startMs 即编译后的触发时刻（compile 语义：边沿）。
      if (clip.startMs > positionMs && (best === null || clip.startMs < best.atMs)) {
        best = { slot: clip.slot, atMs: clip.startMs };
      }
    }
  }
  return best;
}