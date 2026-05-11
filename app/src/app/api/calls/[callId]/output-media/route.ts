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
    :root {
      --canvas: #faf9f6;
      --canvas2: #f4f3ef;
      --canvas3: #efeee8;
      --ink: #111111;
      --muted: #5f625d;
      --grasp: #2e7d32;
      --grasp2: #4caf50;
      --leaf: #7fb069;
      --gold: #d7b36a;
      --sky: #a0afd7;
      --panel: rgba(255, 255, 255, 0.66);
      --shadow: rgba(36, 53, 31, 0.16);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--canvas);
      color: var(--ink);
      font-family: "DM Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    body {
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 78% 18%, rgba(76, 175, 80, 0.18), transparent 28%),
        radial-gradient(circle at 18% 78%, rgba(160, 175, 215, 0.18), transparent 30%),
        radial-gradient(circle at 52% 35%, rgba(215, 179, 106, 0.13), transparent 34%),
        linear-gradient(165deg, var(--canvas) 0%, var(--canvas2) 50%, var(--canvas3) 100%);
    }

    body::before {
      content: "";
      position: fixed;
      inset: -20%;
      pointer-events: none;
      background-image:
        linear-gradient(115deg, transparent 0 48%, rgba(46, 125, 50, 0.055) 48% 49%, transparent 49%),
        repeating-linear-gradient(-38deg, transparent 0 26px, rgba(17, 17, 17, 0.035) 26px 27px);
      mask-image: radial-gradient(ellipse 72% 62% at 50% 48%, transparent 0 24%, black 70%);
      opacity: 0.72;
    }

    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.04;
      mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size: 256px 256px;
    }

    .scene {
      position: relative;
      width: min(1120px, calc(100vw - 56px));
      height: min(640px, calc(100vh - 56px));
      min-height: 520px;
      display: grid;
      grid-template-columns: 0.9fr 1.1fr;
      align-items: center;
      gap: clamp(28px, 5vw, 72px);
      padding: clamp(34px, 5vw, 62px);
      border: 1px solid rgba(46, 125, 50, 0.13);
      border-radius: 44px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, 0.8), rgba(250, 249, 246, 0.48)),
        radial-gradient(circle at 85% 15%, rgba(76, 175, 80, 0.11), transparent 32%);
      box-shadow:
        0 42px 110px rgba(36, 53, 31, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.7);
      isolation: isolate;
    }

    .scene::before {
      content: "";
      position: absolute;
      inset: 18px;
      border-radius: 34px;
      border: 1px solid rgba(46, 125, 50, 0.07);
      pointer-events: none;
    }

    .brand {
      position: absolute;
      top: 32px;
      left: 38px;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      z-index: 3;
    }

    .brand svg { width: 32px; height: 32px; overflow: visible; }

    .brand-word {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 34px;
      line-height: 1;
      letter-spacing: -0.055em;
      transform: translateY(-1px);
    }

    .copy {
      position: relative;
      z-index: 2;
      padding-top: 34px;
      max-width: 420px;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 8px 13px;
      border-radius: 999px;
      background: rgba(46, 125, 50, 0.08);
      color: var(--grasp);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      border: 1px solid rgba(46, 125, 50, 0.12);
    }

    .eyebrow-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--grasp2);
      box-shadow: 0 0 0 6px rgba(76, 175, 80, 0.12);
    }

    h1 {
      margin: 22px 0 16px;
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(48px, 6.8vw, 86px);
      line-height: 0.94;
      font-weight: 400;
      letter-spacing: -0.07em;
      color: var(--ink);
    }

    .subhead {
      margin: 0;
      color: var(--muted);
      font-size: clamp(17px, 2vw, 22px);
      line-height: 1.45;
      letter-spacing: -0.015em;
    }

    .status-card {
      margin-top: 32px;
      display: inline-flex;
      align-items: center;
      gap: 12px;
      min-width: 300px;
      padding: 14px 17px;
      border-radius: 22px;
      background: var(--panel);
      border: 1px solid rgba(17, 17, 17, 0.08);
      box-shadow: 0 18px 48px rgba(36, 53, 31, 0.11);
      backdrop-filter: blur(12px);
    }

    .status-glyph {
      position: relative;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(46, 125, 50, 0.1);
      display: grid;
      place-items: center;
      flex: 0 0 auto;
    }

    .status-glyph::before,
    .status-glyph::after {
      content: "";
      position: absolute;
      border-radius: 50%;
      border: 1px solid rgba(46, 125, 50, 0.28);
      inset: 8px;
      animation: statusPulse 2.4s ease-out infinite;
    }

    .status-glyph::after { animation-delay: 1.2s; }

    .status-seed {
      width: 10px;
      height: 15px;
      border-radius: 10px 10px 10px 2px;
      background: linear-gradient(145deg, var(--grasp2), var(--grasp));
      transform: rotate(38deg);
    }

    #status {
      margin: 0;
      color: #3b3d38;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .bot-stage {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 500px;
      z-index: 2;
    }

    .halo {
      position: absolute;
      width: min(420px, 42vw);
      height: min(420px, 42vw);
      border-radius: 50%;
      background:
        radial-gradient(circle, rgba(76, 175, 80, 0.24), rgba(76, 175, 80, 0.08) 36%, transparent 67%),
        conic-gradient(from 120deg, rgba(46, 125, 50, 0.22), rgba(215, 179, 106, 0.18), rgba(160, 175, 215, 0.16), rgba(46, 125, 50, 0.22));
      filter: blur(2px);
      opacity: 0.8;
      animation: haloBreathe 5.2s ease-in-out infinite;
    }

    .ring {
      position: absolute;
      width: 330px;
      height: 330px;
      border-radius: 50%;
      border: 1px solid rgba(46, 125, 50, 0.18);
      transform: rotate(-12deg);
      opacity: 0.7;
    }

    .ring.r2 {
      width: 410px;
      height: 250px;
      border-color: rgba(215, 179, 106, 0.26);
      transform: rotate(18deg);
    }

    .ring.r3 {
      width: 250px;
      height: 410px;
      border-color: rgba(160, 175, 215, 0.2);
      transform: rotate(38deg);
    }

    .bot {
      position: relative;
      width: 236px;
      height: 300px;
      filter: drop-shadow(0 28px 34px rgba(36, 53, 31, 0.19));
      animation: botFloat 4.8s ease-in-out infinite;
      transform-origin: center bottom;
    }

    .sprout {
      position: absolute;
      left: 50%;
      top: 3px;
      width: 4px;
      height: 62px;
      border-radius: 999px;
      background: linear-gradient(var(--grasp2), var(--grasp));
      transform: translateX(-50%);
      transform-origin: bottom center;
      animation: sproutSway 4.8s ease-in-out infinite;
    }

    .leaf {
      position: absolute;
      top: 8px;
      width: 58px;
      height: 34px;
      border-radius: 34px 34px 34px 4px;
      background: linear-gradient(145deg, #72bf78, var(--grasp2) 50%, var(--grasp));
      box-shadow: inset -10px -8px 18px rgba(46, 125, 50, 0.18);
      transform-origin: 8px 28px;
    }

    .leaf.left {
      right: 115px;
      transform: rotate(196deg);
      animation: leafLeft 5.4s ease-in-out infinite;
    }

    .leaf.right {
      left: 117px;
      transform: rotate(-16deg);
      animation: leafRight 5.4s ease-in-out infinite;
    }

    .body {
      position: absolute;
      left: 50%;
      top: 62px;
      width: 206px;
      height: 218px;
      transform: translateX(-50%);
      border-radius: 54px 54px 64px 64px;
      background:
        radial-gradient(circle at 24% 14%, rgba(255, 255, 255, 0.98), transparent 28%),
        linear-gradient(155deg, #ffffff 0%, #f6f4ed 54%, #e9eadf 100%);
      border: 1px solid rgba(46, 125, 50, 0.14);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.95),
        inset 0 -22px 36px rgba(46, 125, 50, 0.06),
        0 26px 54px rgba(36, 53, 31, 0.16);
    }

    .face {
      position: absolute;
      left: 50%;
      top: 43px;
      width: 144px;
      height: 96px;
      transform: translateX(-50%);
      border-radius: 35px;
      background:
        linear-gradient(180deg, rgba(250, 255, 247, 0.95), rgba(218, 238, 214, 0.82)),
        radial-gradient(circle at 80% 20%, rgba(76, 175, 80, 0.18), transparent 45%);
      border: 1px solid rgba(46, 125, 50, 0.16);
      box-shadow: inset 0 0 24px rgba(76, 175, 80, 0.1);
    }

    .eye {
      position: absolute;
      top: 33px;
      width: 16px;
      height: 20px;
      border-radius: 50%;
      background: var(--grasp);
      box-shadow: 0 0 0 7px rgba(76, 175, 80, 0.12);
      animation: blink 7s ease-in-out infinite;
    }

    .eye.left { left: 36px; }
    .eye.right { right: 36px; }

    .mouth {
      position: absolute;
      left: 50%;
      bottom: 20px;
      display: flex;
      align-items: center;
      gap: 4px;
      height: 19px;
      transform: translateX(-50%);
    }

    .bar {
      display: block;
      width: 5px;
      height: 7px;
      border-radius: 999px;
      background: var(--grasp);
      opacity: 0.75;
      transform-origin: center;
    }

    .cheek {
      position: absolute;
      top: 64px;
      width: 18px;
      height: 8px;
      border-radius: 999px;
      background: rgba(215, 179, 106, 0.28);
    }

    .cheek.left { left: 18px; }
    .cheek.right { right: 18px; }

    .belly {
      position: absolute;
      left: 50%;
      bottom: 32px;
      width: 96px;
      height: 42px;
      transform: translateX(-50%);
      border-radius: 999px;
      background: rgba(46, 125, 50, 0.08);
      border: 1px solid rgba(46, 125, 50, 0.1);
    }

    .belly::before {
      content: "";
      position: absolute;
      left: 21px;
      top: 12px;
      width: 54px;
      height: 16px;
      border-radius: 16px 16px 16px 2px;
      border: 2px solid rgba(46, 125, 50, 0.44);
      border-left: 0;
      border-bottom: 0;
      transform: rotate(-9deg);
    }

    .arm {
      position: absolute;
      top: 139px;
      width: 46px;
      height: 86px;
      border-radius: 28px;
      background: linear-gradient(180deg, #f8f7f1, #e7e9dc);
      border: 1px solid rgba(46, 125, 50, 0.12);
      z-index: -1;
    }

    .arm.left {
      left: -15px;
      transform: rotate(13deg);
      transform-origin: top right;
    }

    .arm.right {
      right: -15px;
      transform: rotate(-13deg);
      transform-origin: top left;
    }

    .shadow {
      position: absolute;
      bottom: 86px;
      width: 250px;
      height: 36px;
      border-radius: 50%;
      background: rgba(36, 53, 31, 0.12);
      filter: blur(8px);
      animation: shadowBreathe 4.8s ease-in-out infinite;
    }

    .state-listening .eye { height: 22px; }
    .state-listening .ring { animation: listenRing 4.6s ease-in-out infinite; }
    .state-listening .r2 { animation-delay: 0.35s; }
    .state-listening .r3 { animation-delay: 0.7s; }

    .state-speaking .halo {
      animation: speakHalo 1.1s ease-in-out infinite;
      opacity: 1;
    }

    .state-speaking .ring {
      animation: speakRing 1.25s ease-out infinite;
      border-color: rgba(46, 125, 50, 0.34);
    }

    .state-speaking .r2 { animation-delay: 0.2s; }
    .state-speaking .r3 { animation-delay: 0.4s; }

    .state-speaking .bar:nth-child(1) { animation: talkBar 0.52s ease-in-out infinite; }
    .state-speaking .bar:nth-child(2) { animation: talkBar 0.46s ease-in-out infinite 0.06s; }
    .state-speaking .bar:nth-child(3) { animation: talkBar 0.58s ease-in-out infinite 0.1s; }
    .state-speaking .bar:nth-child(4) { animation: talkBar 0.44s ease-in-out infinite 0.02s; }
    .state-speaking .bar:nth-child(5) { animation: talkBar 0.54s ease-in-out infinite 0.14s; }

    .state-connecting .bot,
    .state-ending .bot {
      animation-duration: 5.8s;
    }

    .state-connecting .status-glyph::before,
    .state-connecting .status-glyph::after {
      animation-duration: 1.6s;
    }

    .state-ending .scene {
      filter: saturate(0.86);
    }

    .state-ending .halo {
      opacity: 0.45;
      animation-duration: 7s;
    }

    .state-error .status-card {
      border-color: rgba(170, 89, 29, 0.24);
      background: rgba(255, 246, 232, 0.78);
    }

    .state-error .status-seed {
      background: #b95b2f;
    }

    .state-error .halo {
      background: radial-gradient(circle, rgba(185, 91, 47, 0.18), transparent 64%);
    }

    @keyframes statusPulse {
      from { transform: scale(0.6); opacity: 0.6; }
      to { transform: scale(2.4); opacity: 0; }
    }

    @keyframes haloBreathe {
      0%, 100% { transform: scale(0.96) rotate(0deg); opacity: 0.72; }
      50% { transform: scale(1.04) rotate(8deg); opacity: 0.9; }
    }

    @keyframes speakHalo {
      0%, 100% { transform: scale(1) rotate(0deg); }
      50% { transform: scale(1.08) rotate(12deg); }
    }

    @keyframes listenRing {
      0%, 100% { transform: rotate(-12deg) scale(0.98); opacity: 0.45; }
      50% { transform: rotate(-7deg) scale(1.03); opacity: 0.75; }
    }

    @keyframes speakRing {
      0% { transform: rotate(-12deg) scale(0.82); opacity: 0.75; }
      100% { transform: rotate(-12deg) scale(1.18); opacity: 0; }
    }

    @keyframes botFloat {
      0%, 100% { transform: translateY(0) rotate(-0.5deg); }
      50% { transform: translateY(-12px) rotate(0.5deg); }
    }

    @keyframes shadowBreathe {
      0%, 100% { transform: scale(0.92); opacity: 0.12; }
      50% { transform: scale(1.08); opacity: 0.18; }
    }

    @keyframes sproutSway {
      0%, 100% { transform: translateX(-50%) rotate(-2deg); }
      50% { transform: translateX(-50%) rotate(3deg); }
    }

    @keyframes leafLeft {
      0%, 100% { transform: rotate(196deg) translateY(0); }
      50% { transform: rotate(203deg) translateY(-2px); }
    }

    @keyframes leafRight {
      0%, 100% { transform: rotate(-16deg) translateY(0); }
      50% { transform: rotate(-23deg) translateY(-2px); }
    }

    @keyframes blink {
      0%, 45%, 49%, 100% { transform: scaleY(1); }
      47% { transform: scaleY(0.12); }
    }

    @keyframes talkBar {
      0%, 100% { height: 7px; transform: translateY(0); }
      50% { height: 22px; transform: translateY(-2px); }
    }

    @media (max-width: 820px) {
      .scene {
        grid-template-columns: 1fr;
        height: auto;
        min-height: calc(100vh - 40px);
        padding: 88px 28px 34px;
        gap: 18px;
      }
      .copy {
        text-align: center;
        margin: 0 auto;
      }
      .status-card {
        min-width: 0;
        width: 100%;
        max-width: 360px;
        justify-content: center;
      }
      .bot-stage { min-height: 380px; }
      .bot { transform: scale(0.86); }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
    }
  </style>
</head>
<body class="state-connecting">
  <main class="scene" aria-label="Grasp voice agent">
    <div class="brand" aria-label="Grasp">
      <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M32 56C32 56 30 44 31 36C32 28 32 24 32 24" stroke="#2E7D32" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M32 28C34 22 40 12 54 6C52 14 46 26 32 28Z" fill="#4CAF50"/>
        <path d="M32 28C36 20 44 12 54 6" stroke="#2E7D32" stroke-width="1.2" opacity="0.3"/>
        <path d="M31 36C28 30 20 20 8 14C10 24 20 34 31 36Z" fill="#2E7D32"/>
        <path d="M31 36C26 28 18 20 8 14" stroke="#2E7D32" stroke-width="1.2" opacity="0.2"/>
      </svg>
      <div class="brand-word">grasp</div>
    </div>

    <section class="copy">
      <div class="eyebrow"><span class="eyebrow-dot"></span><span id="mode">Connecting</span></div>
      <h1>Here with you.</h1>
      <p class="subhead">A Grasp voice agent is listening carefully, then speaking only when it has something useful to say.</p>
      <div class="status-card" role="status" aria-live="polite">
        <div class="status-glyph"><span class="status-seed"></span></div>
        <p id="status">Starting...</p>
      </div>
    </section>

    <section class="bot-stage" aria-hidden="true">
      <div class="halo"></div>
      <div class="ring r1"></div>
      <div class="ring r2"></div>
      <div class="ring r3"></div>
      <div class="shadow"></div>
      <div class="bot">
        <div class="sprout"></div>
        <div class="leaf left"></div>
        <div class="leaf right"></div>
        <div class="body">
          <div class="arm left"></div>
          <div class="arm right"></div>
          <div class="face">
            <span class="eye left"></span>
            <span class="eye right"></span>
            <span class="cheek left"></span>
            <span class="cheek right"></span>
            <div class="mouth">
              <span class="bar"></span>
              <span class="bar"></span>
              <span class="bar"></span>
              <span class="bar"></span>
              <span class="bar"></span>
            </div>
          </div>
          <div class="belly"></div>
        </div>
      </div>
    </section>
  </main>
  <script>
    const callId = ${callIdJson};
    const token = ${tokenJson};
    const statusEl = document.getElementById("status");
    const modeEl = document.getElementById("mode");
    let speakingTimer = null;

    const stateLabels = {
      connecting: "Connecting",
      listening: "Listening",
      speaking: "Speaking",
      ending: "Wrapping up",
      error: "Needs attention"
    };

    function setVisualState(state, message) {
      document.body.className = "state-" + state;
      if (modeEl) modeEl.textContent = stateLabels[state] || state;
      if (message) statusEl.textContent = message;
      console.log("[grasp-output]", state, message || "");
    }

    function setStatus(value) {
      statusEl.textContent = value;
      console.log("[grasp-output]", value);
    }

    function markSpeaking() {
      setVisualState("speaking", "Speaking with you...");
      if (speakingTimer) clearTimeout(speakingTimer);
      speakingTimer = setTimeout(() => {
        setVisualState("listening", "Listening closely...");
      }, 900);
    }

    function markListening() {
      if (speakingTimer) clearTimeout(speakingTimer);
      speakingTimer = null;
      setVisualState("listening", "Listening closely...");
    }

    async function main() {
      setVisualState("connecting", "Opening meeting audio...");
      const meetingStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      setVisualState("connecting", "Creating realtime session...");
      const sessionRes = await fetch("/api/calls/" + encodeURIComponent(callId) + "/realtime-session?token=" + encodeURIComponent(token), { method: "POST" });
      if (!sessionRes.ok) throw new Error("session failed: " + sessionRes.status + " " + await sessionRes.text());
      const session = await sessionRes.json();

      setVisualState("connecting", "Connecting voice...");
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("aria-hidden", "true");
      document.body.appendChild(audio);
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
        if (
          payload.type === "response.audio.delta" ||
          payload.type === "response.audio_transcript.delta" ||
          payload.type === "response.output_audio.delta" ||
          payload.type === "response.text.delta"
        ) {
          markSpeaking();
          return;
        }
        if (
          payload.type === "response.audio.done" ||
          payload.type === "response.output_audio.done" ||
          payload.type === "response.done"
        ) {
          markListening();
          return;
        }
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

      setVisualState("listening", "Listening closely...");
      dc.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));
    }

    async function handleToolCall(dc, callIdFromModel, name, argsString, pc, meetingStream, audio) {
      let result;
      if (name === "end_call") {
        setVisualState("ending", "Ending the call...");
        const res = await fetch("/api/calls/" + encodeURIComponent(callId) + "/end-call?token=" + encodeURIComponent(token), { method: "POST" });
        result = res.ok ? await res.json() : { ok: false, error: await res.text() };
        try { meetingStream.getTracks().forEach((track) => track.stop()); } catch {}
        try { pc.close(); } catch {}
        try { audio.srcObject = null; } catch {}
        setVisualState("ending", "Call ended. Thanks for talking.");
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
      setVisualState("error", err && err.message ? err.message : "Voice output failed");
    });
  </script>
</body>
</html>`;
}
