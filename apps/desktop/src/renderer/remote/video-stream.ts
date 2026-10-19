import type { AppConfig } from "../../shared/ipc";

/**
 * Signal envelope over the opaque `remote:signal` channel (S15,
 * 08-REMOTE.md §4.3). Phone is the offerer; renderer answers with the
 * capture-card stream (sendonly video, no audio per S15 §5).
 */
export type VideoSignal =
  | { kind: "video-offer"; sdp: string }
  | { kind: "video-answer"; sdp: string }
  | { kind: "video-ice"; candidate: RTCIceCandidateInit | null }
  | { kind: "video-stop" };

const MAX_VIDEO_BITRATE = 6_000_000;

/** Bitrate ladder for adaptive degradation (S15 tuning). */
const BITRATE_LADDER = [6_000_000, 3_000_000, 1_500_000, 800_000, 400_000];
const STATS_INTERVAL_MS = 2000;
const CLEAN_CHECKS_TO_UPGRADE = 3;

const ICE_SERVERS: RTCIceServer[] = [
  // LAN / Tailscale connect via host candidates; STUN is a harmless fallback.
  { urls: "stun:stun.l.google.com:19302" },
];

export type VideoStreamStatus = "idle" | "connecting" | "live" | "error";

interface VideoStreamServiceDeps {
  send: (payload: unknown) => void;
  getConfig: () => Promise<AppConfig>;
  onStatus?: (status: VideoStreamStatus, detail?: string) => void;
}

/**
 * Owns the renderer side of the remote video downlink: acquires the
 * capture card on the first offer, answers the phone's WebRTC offer with a
 * sendonly video track, relays ICE, and tears the stream down on session
 * end. Never holds the camera open while no session is live.
 */
export class VideoStreamService {
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private status: VideoStreamStatus = "idle";
  private statsTimer: number | null = null;
  private levelIndex = 0;
  private cleanChecks = 0;
  private lastBytes = 0;
  private lastStatsAt = 0;

  constructor(private deps: VideoStreamServiceDeps) {}

  get isActive(): boolean {
    return this.pc !== null || this.stream !== null;
  }

  getStatus(): VideoStreamStatus {
    return this.status;
  }

  private setStatus(status: VideoStreamStatus, detail?: string): void {
    this.status = status;
    this.deps.onStatus?.(status, detail);
  }

  /** Entry point for every payload arriving via `remote:signal` (M→R). */
  async handleSignal(payload: unknown): Promise<void> {
    if (typeof payload !== "object" || payload === null) return;
    const signal = payload as Partial<VideoSignal>;
    try {
      if (signal.kind === "video-offer" && typeof signal.sdp === "string") {
        await this.handleOffer(signal.sdp);
      } else if (
        signal.kind === "video-ice" &&
        this.pc &&
        signal.candidate !== undefined
      ) {
        await this.pc.addIceCandidate(signal.candidate);
      } else if (signal.kind === "video-stop") {
        // Phone closed its player: release the capture card, don't echo.
        this.teardown();
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.setStatus("error", detail);
      this.deps.send({ kind: "video-stop" } satisfies VideoSignal);
      this.teardown();
    }
  }

  /** Session ended (client left / watchdog): release everything. */
  stop(notify = true): void {
    if (!this.isActive && this.status === "idle") return;
    if (notify) this.deps.send({ kind: "video-stop" } satisfies VideoSignal);
    this.teardown();
  }

  private teardown(): void {
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.pc?.close();
    this.pc = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.levelIndex = 0;
    this.cleanChecks = 0;
    this.lastBytes = 0;
    this.setStatus("idle");
  }

  private async acquireStream(): Promise<MediaStream> {
    if (this.stream) return this.stream;
    const config = await this.deps.getConfig();
    const deviceId = config.remote.videoDeviceId;
    const video: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ video });
    return this.stream;
  }

  private async handleOffer(sdp: string): Promise<void> {
    this.setStatus("connecting");
    const stream = await this.acquireStream();

    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    for (const track of stream.getVideoTracks()) {
      track.contentHint = "motion";
      pc.addTrack(track, stream);
    }

    pc.onicecandidate = (e) => {
      this.deps.send({
        kind: "video-ice",
        candidate: e.candidate ? e.candidate.toJSON() : null,
      } satisfies VideoSignal);
    };
    pc.oniceconnectionstatechange = () => {
      this.deps.onStatus?.(
        this.status === "live" ? "live" : "connecting",
        `ICE ${pc.iceConnectionState}`,
      );
    };
    pc.onconnectionstatechange = () => {
      this.deps.onStatus?.(
        this.status === "live" ? "live" : "connecting",
        `PC ${pc.connectionState}`,
      );
      if (pc.connectionState === "connected") {
        this.setStatus("live");
      } else if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed" ||
        pc.connectionState === "disconnected"
      ) {
        this.setStatus("idle");
      }
    };

    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.deps.send({
      kind: "video-answer",
      sdp: pc.localDescription?.sdp ?? "",
    } satisfies VideoSignal);

    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length
        ? params.encodings
        : [{}];
      params.encodings[0]!.maxBitrate = BITRATE_LADDER[this.levelIndex]!;
      await sender.setParameters(params).catch(() => {
        /* some stacks reject pre-connect setParameters; bitrate falls back */
      });
      this.startStatsLoop(sender);
    }
  }

  /**
   * Adaptive degradation (S15): on lossy paths (DERP relay / 4G) a fixed
   * 6Mbps stream congests, queues seconds of latency and stalls. Watch
   * sender stats and step down/up the encoder bitrate accordingly.
   */
  private startStatsLoop(sender: RTCRtpSender): void {
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.lastBytes = 0;
    this.lastStatsAt = Date.now();
    this.statsTimer = window.setInterval(() => {
      void this.checkStats(sender);
    }, STATS_INTERVAL_MS);
  }

  private async checkStats(sender: RTCRtpSender): Promise<void> {
    if (!this.pc || this.pc.connectionState !== "connected") return;
    try {
      const stats = await sender.getStats();
      let outbound: { bytesSent: number; retransmittedPacketsSent?: number; packetsSent?: number } | null = null;
      let inbound: { fractionLost?: number; roundTripTime?: number } | null = null;
      stats.forEach((report) => {
        if (report.type === "outbound-rtp" && report.kind === "video") {
          outbound = report as typeof outbound;
        } else if (report.type === "remote-inbound-rtp" && report.kind === "video") {
          inbound = report as typeof inbound;
        }
      });
      if (!outbound) return;
      const now = Date.now();
      const dt = (now - this.lastStatsAt) / 1000;
      this.lastStatsAt = now;
      if (dt <= 0) return;

      const bytes = (outbound as { bytesSent: number }).bytesSent;
      const actualBps = this.lastBytes ? ((bytes - this.lastBytes) * 8) / dt : 0;
      this.lastBytes = bytes;

      const loss = (inbound as { fractionLost?: number } | null)?.fractionLost ?? 0;
      const rtt = ((inbound as { roundTripTime?: number } | null)?.roundTripTime ?? 0) * 1000;
      // Congested when the encoder cannot push its target or loss/RTT spike.
      const target = BITRATE_LADDER[this.levelIndex]!;
      const starving = actualBps > 0 && actualBps < target * 0.55;
      const degraded = loss > 0.05 || rtt > 400 || starving;

      if (degraded && this.levelIndex < BITRATE_LADDER.length - 1) {
        this.levelIndex += 1;
        this.cleanChecks = 0;
        await this.applyBitrate(sender);
      } else if (!degraded && loss < 0.01 && rtt < 200) {
        this.cleanChecks += 1;
        if (
          this.cleanChecks >= CLEAN_CHECKS_TO_UPGRADE &&
          this.levelIndex > 0
        ) {
          this.levelIndex -= 1;
          this.cleanChecks = 0;
          await this.applyBitrate(sender);
        }
      } else {
        this.cleanChecks = 0;
      }

      const detail = `码率 ${(BITRATE_LADDER[this.levelIndex]! / 1e6).toFixed(1)} Mbps · 丢包 ${(loss * 100).toFixed(0)}%${rtt ? ` · RTT ${rtt.toFixed(0)}ms` : ""}`;
      this.deps.onStatus?.(this.status === "live" ? "live" : "connecting", detail);
    } catch {
      /* stats unavailable on some platforms; keep current level */
    }
  }

  private async applyBitrate(sender: RTCRtpSender): Promise<void> {
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0]!.maxBitrate = BITRATE_LADDER[this.levelIndex]!;
      params.degradationPreference = "maintain-framerate";
      await sender.setParameters(params);
    } catch {
      /* pre-connect rejections are fine; the level applies on next link */
    }
  }
}
