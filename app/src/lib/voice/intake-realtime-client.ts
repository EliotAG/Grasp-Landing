/**
 * Browser-side OpenAI Realtime client for the voice intake.
 *
 * Encapsulates everything that happens in the browser once we have a
 * Realtime session secret from the server:
 *
 *   - request the microphone,
 *   - establish the WebRTC peer connection,
 *   - exchange SDP with OpenAI's `/v1/realtime` endpoint,
 *   - open the `oai-events` data channel,
 *   - dispatch parsed events to caller-supplied callbacks,
 *   - bridge function-call events to the caller's `executeTool` (which is
 *     expected to POST to our /api/intake/[id]/tool route) and write the
 *     `function_call_output` reply back into the data channel,
 *   - close cleanly on `stop()`.
 *
 * The client is intentionally framework-free — the React component drives it
 * by passing handlers and calling `start` / `stop` from effects.
 */

export type IntakeRealtimeStatus =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "live"
  | "ending"
  | "ended"
  | "error";

export interface IntakeRealtimeSessionInfo {
  clientSecret: string;
  handshakeUrl: string;
  model: string;
  voice: string;
  sessionId: string;
}

export interface IntakeRealtimeHandlers {
  onStatus(status: IntakeRealtimeStatus, detail?: string): void;
  /** Final assistant transcript turn (post-response). */
  onAssistantTranscript(text: string): void;
  /** Streaming assistant transcript delta. Useful for live captions. */
  onAssistantTranscriptDelta?(delta: string): void;
  /** Final user transcript (after server-side ASR completes). */
  onUserTranscript(text: string): void;
  /** Tool result handler — must execute the tool and resolve with the JSON
   *  payload the model receives back as `function_call_output.output`. */
  executeTool(name: string, args: unknown): Promise<unknown>;
  /** Notification that a tool just ran (success or failure) — UI can use it
   *  to highlight what was just captured. */
  onToolCall?(name: string, args: unknown, result: unknown): void;
  /** Model called the `done` tool — the UI should end the session and route
   *  the leader to /review. */
  onDone?(): void;
  /** Generic error path. */
  onError(error: Error): void;
}

interface PendingFunctionCall {
  name: string;
  args: string;
}

export class IntakeRealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private status: IntakeRealtimeStatus = "idle";
  private pendingByCallId = new Map<string, PendingFunctionCall>();

  constructor(private handlers: IntakeRealtimeHandlers) {}

  getStatus(): IntakeRealtimeStatus {
    return this.status;
  }

  /**
   * Start the session: ask for mic, open RTCPeerConnection, exchange SDP,
   * wait for the data channel to open, and kick off the greeting.
   */
  async start(info: IntakeRealtimeSessionInfo): Promise<void> {
    if (this.status !== "idle" && this.status !== "ended") {
      throw new Error(`Cannot start in status=${this.status}`);
    }

    try {
      this.setStatus("requesting-mic");
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.setStatus("connecting");
      const pc = new RTCPeerConnection({
        // Default ICE config is fine for OpenAI Realtime; their relay handles
        // the rest. Adding STUN servers explicitly doesn't hurt.
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.pc = pc;

      // Remote audio: attach a hidden <audio> element so the model's voice
      // plays through the user's default output device.
      const audio = document.createElement("audio");
      audio.autoplay = true;
      this.audioElement = audio;
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) audio.srcObject = stream;
      };

      // Mic upstream.
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }

      // Data channel for events.
      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onmessage = (event) => this.onDataChannelMessage(event);
      const dcOpen = new Promise<void>((resolve, reject) => {
        dc.onopen = () => resolve();
        dc.onerror = (event) => {
          // RTCErrorEvent in Safari, plain Event in some Chrome builds.
          const detail =
            "error" in event &&
            event.error instanceof Error
              ? event.error.message
              : "data channel error";
          reject(new Error(detail));
        };
      });

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "failed" || state === "disconnected") {
          this.setStatus("error", `webrtc ${state}`);
        }
      };

      // SDP handshake with OpenAI.
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
      });
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(info.handshakeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${info.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp ?? "",
      });
      if (!sdpResponse.ok) {
        const text = await sdpResponse.text().catch(() => "");
        throw new Error(
          `SDP exchange failed: ${sdpResponse.status} ${text.slice(0, 200)}`,
        );
      }
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      await dcOpen;

      this.setStatus("live");

      // Kick the agent off so it greets first instead of waiting for a user
      // turn — much smoother as an intro.
      this.send({
        type: "response.create",
        response: { modalities: ["audio", "text"] },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setStatus("error", error.message);
      this.handlers.onError(error);
      // Best-effort cleanup so a failed start doesn't pin the mic.
      this.cleanup();
      throw error;
    }
  }

  /** Close the session and release the microphone. Idempotent. */
  stop(): void {
    if (this.status === "idle" || this.status === "ended") {
      this.cleanup();
      return;
    }
    this.setStatus("ending");
    try {
      this.send({ type: "session.update", session: {} });
    } catch {
      // best effort
    }
    this.cleanup();
    this.setStatus("ended");
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private cleanup() {
    try {
      this.dc?.close();
    } catch {
      /* noop */
    }
    try {
      this.pc?.getSenders().forEach((sender) => {
        try {
          sender.track?.stop();
        } catch {
          /* noop */
        }
      });
      this.pc?.close();
    } catch {
      /* noop */
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* noop */
        }
      }
    }
    if (this.audioElement) {
      try {
        this.audioElement.srcObject = null;
      } catch {
        /* noop */
      }
    }
    this.dc = null;
    this.pc = null;
    this.localStream = null;
    this.audioElement = null;
    this.pendingByCallId.clear();
  }

  private setStatus(status: IntakeRealtimeStatus, detail?: string) {
    this.status = status;
    this.handlers.onStatus(status, detail);
  }

  private send(payload: unknown) {
    if (!this.dc || this.dc.readyState !== "open") return;
    this.dc.send(JSON.stringify(payload));
  }

  private onDataChannelMessage(event: MessageEvent) {
    let parsed: RealtimeEvent | null = null;
    try {
      parsed = JSON.parse(event.data) as RealtimeEvent;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;

    switch (parsed.type) {
      case "response.audio_transcript.delta": {
        if (typeof parsed.delta === "string") {
          this.handlers.onAssistantTranscriptDelta?.(parsed.delta);
        }
        return;
      }
      case "response.audio_transcript.done": {
        if (typeof parsed.transcript === "string") {
          this.handlers.onAssistantTranscript(parsed.transcript);
        }
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        if (typeof parsed.transcript === "string") {
          this.handlers.onUserTranscript(parsed.transcript);
        }
        return;
      }
      case "response.function_call_arguments.delta": {
        const callId = parsed.call_id;
        const name = parsed.name;
        if (!callId || !name) return;
        const existing = this.pendingByCallId.get(callId);
        if (existing) {
          existing.args += parsed.delta ?? "";
        } else {
          this.pendingByCallId.set(callId, {
            name,
            args: parsed.delta ?? "",
          });
        }
        return;
      }
      case "response.function_call_arguments.done": {
        const callId = parsed.call_id;
        const name = parsed.name;
        if (!callId || !name) return;
        const buffered = this.pendingByCallId.get(callId);
        const argsString = parsed.arguments ?? buffered?.args ?? "{}";
        this.pendingByCallId.delete(callId);
        void this.handleFunctionCall(callId, name, argsString);
        return;
      }
      case "error": {
        const message =
          parsed.error?.message ?? parsed.message ?? "Realtime error";
        this.handlers.onError(new Error(message));
        return;
      }
      default:
        return;
    }
  }

  private async handleFunctionCall(
    callId: string,
    name: string,
    argsString: string,
  ) {
    let args: unknown = {};
    try {
      args = argsString.length > 0 ? JSON.parse(argsString) : {};
    } catch {
      args = { _parseError: argsString };
    }

    let result: unknown;
    try {
      result = await this.handlers.executeTool(name, args);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : "Tool failed" };
    }

    this.handlers.onToolCall?.(name, args, result);

    // Hand the result back to the model and ask for the next turn so it can
    // continue the conversation in response to the tool output.
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    this.send({
      type: "response.create",
      response: { modalities: ["audio", "text"] },
    });

    // Special-case the `done` tool — the model has just signalled the
    // conversation is over, so we hoist the UI cue immediately rather than
    // waiting for the closing turn to finish playing.
    if (name === "done") {
      this.handlers.onDone?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Wire types (loose). The Realtime API is heavily versioned, so we only type
// the fields we read — anything we don't care about stays `unknown`.
// ---------------------------------------------------------------------------

interface RealtimeEvent {
  type: string;
  delta?: string;
  transcript?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  message?: string;
  error?: { message?: string };
}
