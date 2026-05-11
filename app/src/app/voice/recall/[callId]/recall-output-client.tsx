"use client";

import { useEffect, useState } from "react";

interface RecallOutputClientProps {
  callId: string;
  token: string;
}

interface SessionResponse {
  clientSecret: string;
  handshakeUrl: string;
}

export function RecallOutputClient({ callId, token }: RecallOutputClientProps) {
  const [status, setStatus] = useState("starting");

  useEffect(() => {
    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    let meetingStream: MediaStream | null = null;
    let outputAudio: HTMLAudioElement | null = null;

    async function start() {
      try {
        setStatus("opening meeting audio");
        meetingStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) return;

        setStatus("creating realtime session");
        const sessionRes = await fetch(
          `/api/calls/${encodeURIComponent(callId)}/realtime-session?token=${encodeURIComponent(token)}`,
          { method: "POST" },
        );
        if (!sessionRes.ok) {
          throw new Error(
            `session failed: ${sessionRes.status} ${await sessionRes.text()}`,
          );
        }
        const session = (await sessionRes.json()) as SessionResponse;

        setStatus("connecting to realtime voice");
        pc = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        outputAudio = document.createElement("audio");
        outputAudio.autoplay = true;
        pc.ontrack = (event) => {
          const [stream] = event.streams;
          if (stream && outputAudio) outputAudio.srcObject = stream;
        };

        for (const track of meetingStream.getTracks()) {
          pc.addTrack(track, meetingStream);
        }

        const dc = pc.createDataChannel("oai-events");
        const dcOpen = new Promise<void>((resolve, reject) => {
          dc.onopen = () => resolve();
          dc.onerror = () => reject(new Error("data channel failed"));
        });

        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(session.handshakeUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        });
        if (!sdpRes.ok) {
          throw new Error(`SDP exchange failed: ${sdpRes.status}`);
        }
        await pc.setRemoteDescription({
          type: "answer",
          sdp: await sdpRes.text(),
        });
        await dcOpen;

        setStatus("live");
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: { modalities: ["audio", "text"] },
          }),
        );
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "voice output failed");
      }
    }

    void start();

    return () => {
      cancelled = true;
      meetingStream?.getTracks().forEach((track) => track.stop());
      pc?.close();
      if (outputAudio) outputAudio.srcObject = null;
    };
  }, [callId, token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-white">
      <div className="rounded-3xl border border-white/10 bg-white/10 px-8 py-7 text-center shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-200">
          Grasp voice agent
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Listening in Teams</h1>
        <p className="mt-4 max-w-md text-sm text-slate-200">
          Status: {status}
        </p>
      </div>
    </main>
  );
}
