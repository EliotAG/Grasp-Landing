import { NextResponse } from "next/server";

import { verifyRecallRealtimeWebhookToken } from "@/lib/voice/realtime-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;
  const token = new URL(req.url).searchParams.get("token");
  if (!token || !verifyRecallRealtimeWebhookToken(callId, token)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response(renderOutputMediaHtml(callId, token), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function renderOutputMediaHtml(callId: string, token: string): string {
  const callIdJson = JSON.stringify(callId);
  const tokenJson = JSON.stringify(token);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grasp Voice Agent</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #020617; color: white; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { display: grid; place-items: center; }
    .card { width: min(720px, calc(100vw - 48px)); border: 1px solid rgba(255,255,255,.12); border-radius: 28px; background: rgba(255,255,255,.08); padding: 40px; text-align: center; box-shadow: 0 24px 80px rgba(0,0,0,.45); }
    .kicker { color: #a5f3fc; text-transform: uppercase; letter-spacing: .3em; font-size: 13px; }
    h1 { margin: 16px 0 12px; font-size: 40px; line-height: 1.05; }
    #status { color: #cbd5e1; font-size: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">Grasp voice agent</div>
    <h1>Listening in Teams</h1>
    <p id="status">Starting...</p>
  </div>
  <script>
    const callId = ${callIdJson};
    const token = ${tokenJson};
    const statusEl = document.getElementById("status");
    const setStatus = (value) => { statusEl.textContent = value; console.log("[grasp-output]", value); };

    async function main() {
      setStatus("Opening meeting audio...");
      const meetingStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      setStatus("Creating realtime session...");
      const sessionRes = await fetch("/api/calls/" + encodeURIComponent(callId) + "/realtime-session?token=" + encodeURIComponent(token), { method: "POST" });
      if (!sessionRes.ok) throw new Error("session failed: " + sessionRes.status + " " + await sessionRes.text());
      const session = await sessionRes.json();

      setStatus("Connecting to OpenAI Realtime...");
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      const audio = document.createElement("audio");
      audio.autoplay = true;
      pc.ontrack = (event) => {
        const stream = event.streams && event.streams[0];
        if (stream) {
          audio.srcObject = stream;
          audio.play().catch((err) => console.error("[grasp-output] audio play failed", err));
        }
      };
      for (const track of meetingStream.getTracks()) pc.addTrack(track, meetingStream);

      const dc = pc.createDataChannel("oai-events");
      const pendingToolCalls = new Map();
      const dcOpen = new Promise((resolve, reject) => {
        dc.onopen = resolve;
        dc.onerror = () => reject(new Error("data channel failed"));
      });
      dc.onmessage = (event) => {
        console.log("[openai-event]", event.data);
        let payload;
        try { payload = JSON.parse(event.data); } catch { return; }
        if (payload.type === "response.function_call_arguments.delta" && payload.call_id && payload.name) {
          const current = pendingToolCalls.get(payload.call_id) || { name: payload.name, args: "" };
          current.args += payload.delta || "";
          pendingToolCalls.set(payload.call_id, current);
          return;
        }
        if (payload.type === "response.function_call_arguments.done" && payload.call_id && payload.name) {
          const current = pendingToolCalls.get(payload.call_id) || { name: payload.name, args: "" };
          const args = payload.arguments || current.args || "{}";
          pendingToolCalls.delete(payload.call_id);
          handleToolCall(dc, payload.call_id, payload.name, args, pc, meetingStream, audio).catch((err) => {
            console.error("[grasp-output] tool failed", err);
          });
        }
      };

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(session.handshakeUrl, {
        method: "POST",
        headers: { Authorization: "Bearer " + session.clientSecret, "Content-Type": "application/sdp" },
        body: offer.sdp || ""
      });
      if (!sdpRes.ok) throw new Error("SDP exchange failed: " + sdpRes.status + " " + await sdpRes.text());
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
      await dcOpen;

      setStatus("Live. Speaking through Teams.");
      dc.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));
    }

    async function handleToolCall(dc, callIdFromModel, name, argsString, pc, meetingStream, audio) {
      let result;
      if (name === "end_call") {
        setStatus("Ending call...");
        const res = await fetch("/api/calls/" + encodeURIComponent(callId) + "/end-call?token=" + encodeURIComponent(token), { method: "POST" });
        result = res.ok ? await res.json() : { ok: false, error: await res.text() };
        try { meetingStream.getTracks().forEach((track) => track.stop()); } catch {}
        try { pc.close(); } catch {}
        try { audio.srcObject = null; } catch {}
        setStatus("Call ended.");
      } else {
        result = { ok: false, error: "Unknown tool: " + name };
      }

      if (dc.readyState === "open") {
        dc.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callIdFromModel,
            output: JSON.stringify(result)
          }
        }));
      }
    }

    main().catch((err) => {
      console.error(err);
      setStatus(err && err.message ? err.message : "Voice output failed");
    });
  </script>
</body>
</html>`;
}
