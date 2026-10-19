/**
 * S15: phone side of the remote video downlink. The phone is the WebRTC
 * offerer (recvonly); the desktop answers with the capture-card stream.
 * Signaling rides the opaque `signal` WS messages via RemoteLink.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export type VideoClientState =
  | "idle" // 未开启
  | "connecting" // 协商中
  | "live" // 画面回显
  | "no-signal" // 连接建立但无画面（NS 无输出/采集卡无信号）
  | "error";

export interface VideoClientCallbacks {
  send: (payload: unknown) => void;
  onState: (state: VideoClientState, detail?: string) => void;
}

export class VideoClient {
  private pc: RTCPeerConnection | null = null;
  private video: HTMLVideoElement | null = null;
  private send: (payload: unknown) => void = () => {};
  private onState: (state: VideoClientState, detail?: string) => void = () => {};
  private pendingIce: RTCIceCandidateInit[] = [];
  private state: VideoClientState = "idle";

  constructor(video: HTMLVideoElement | null, callbacks: VideoClientCallbacks) {
    this.video = video;
    this.send = callbacks.send;
    this.onState = callbacks.onState;
  }

  get currentState(): VideoClientState {
    return this.state;
  }

  private setState(state: VideoClientState, detail?: string): void {
    this.state = state;
    this.onState(state, detail);
  }

  /** 用户点「开启画面」：创建 offer 发给桌面端。 */
  async start(): Promise<void> {
    if (this.pc) return;
    this.setState("connecting");
    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.pc = pc;
      const transceiver = pc.addTransceiver("video", { direction: "recvonly" });

      pc.ontrack = (e) => {
        const [stream] = e.streams;
        const receiver = transceiver.receiver;
        // S15: squeeze latency — no jitter buffer on the phone receiver.
        try {
          receiver.jitterBufferTarget = 0;
        } catch {
          /* older WebKit: ignore */
        }
        if (this.video) {
          this.video.srcObject = stream ?? new MediaStream([e.track]);
          void this.video.play().catch(() => {
            /* autoplay retry after user gesture; button click already grants it */
          });
          this.watchNoSignal(e.track);
        }
      };
      pc.onicecandidate = (e) => {
        this.send({
          kind: "video-ice",
          candidate: e.candidate ? e.candidate.toJSON() : null,
        });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          // Live/no-signal decided by track arrival below.
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          this.setState("no-signal");
        } else if (pc.connectionState === "closed") {
          this.setState("idle");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send({ kind: "video-offer", sdp: pc.localDescription?.sdp ?? "" });
    } catch (err) {
      this.setState("error", err instanceof Error ? err.message : String(err));
      this.stop();
    }
  }

  /** 桌面端/WS 方向来的信令；非 video-* 载荷静默忽略。 */
  async handleSignal(payload: unknown): Promise<void> {
    if (typeof payload !== "object" || payload === null) return;
    const signal = payload as { kind?: string; sdp?: string; candidate?: unknown };
    try {
      if (signal.kind === "video-answer" && typeof signal.sdp === "string") {
        if (!this.pc || this.pc.signalingState === "stable") return;
        await this.pc.setRemoteDescription({
          type: "answer",
          sdp: signal.sdp,
        });
        for (const candidate of this.pendingIce.splice(0)) {
          await this.pc.addIceCandidate(candidate);
        }
      } else if (
        signal.kind === "video-ice" &&
        signal.candidate !== undefined &&
        signal.candidate !== null
      ) {
        const candidate = signal.candidate as RTCIceCandidateInit;
        if (!this.pc || !this.pc.remoteDescription) {
          this.pendingIce.push(candidate);
        } else {
          await this.pc.addIceCandidate(candidate);
        }
      } else if (signal.kind === "video-stop") {
        this.stop();
      }
    } catch (err) {
      this.setState("error", err instanceof Error ? err.message : String(err));
    }
  }

  stop(): void {
    this.pc?.close();
    this.pc = null;
    this.pendingIce = [];
    if (this.video) this.video.srcObject = null;
    this.setState("idle");
  }

  /** Connected but no frame for a while → 「无信号」(NS sleeping / no input). */
  private watchNoSignal(track: MediaStreamTrack): void {
    let started = false;
    const onMute = () => {
      if (!started) return;
      this.setState("no-signal");
    };
    const onUnmute = () => {
      started = true;
      this.setState("live");
    };
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    // A live track arrives unmuted but needs a first frame; give it a beat.
    window.setTimeout(() => {
      if (track.muted) this.setState("no-signal");
      else this.setState("live");
    }, 1500);
  }
}
