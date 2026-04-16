import { useState, useEffect, useRef } from "react";

/* ── Scroll-reveal hook ── */
function useOnScreen(ref, threshold = 0.15) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true); },
      { threshold },
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref, threshold]);
  return visible;
}

function Reveal({ children, delay = 0, style = {} }) {
  const ref = useRef();
  const vis = useOnScreen(ref);
  return (
    <div
      ref={ref}
      style={{
        opacity: vis ? 1 : 0,
        transform: vis ? "translateY(0)" : "translateY(24px)",
        transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Inline SVG icons ── */
const ICON_PATHS = {
  email: (
    <>
      <rect x="4" y="7" width="32" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M4 10l16 11 16-11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
    </>
  ),
  chat: (
    <>
      <rect x="4" y="6" width="28" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 28l-4 6v-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="14" cy="17" r="1.5" fill="currentColor" />
      <circle cx="21" cy="17" r="1.5" fill="currentColor" />
      <circle cx="28" cy="17" r="1.5" fill="currentColor" />
    </>
  ),
  clipboard: (
    <>
      <rect x="10" y="4" width="20" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <rect x="7" y="8" width="26" height="28" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <line x1="14" y1="18" x2="26" y2="18" stroke="currentColor" strokeWidth="2" />
      <line x1="14" y1="23" x2="26" y2="23" stroke="currentColor" strokeWidth="2" />
      <line x1="14" y1="28" x2="22" y2="28" stroke="currentColor" strokeWidth="2" />
    </>
  ),
  refresh: (
    <>
      <path d="M34 20a14 14 0 01-25.8 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6 20a14 14 0 0125.8-7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8.2 27.5l-2.5 5 5.5-1.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M31.8 12.5l2.5-5-5.5 1.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  chart: (
    <>
      <rect x="4" y="4" width="32" height="32" rx="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <rect x="10" y="20" width="5" height="10" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="17.5" y="14" width="5" height="16" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="25" y="10" width="5" height="20" rx="1" fill="currentColor" opacity="0.7" />
    </>
  ),
  target: (
    <>
      <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="20" cy="20" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="20" cy="20" r="3" fill="currentColor" />
      <line x1="20" y1="2" x2="20" y2="8" stroke="currentColor" strokeWidth="2" />
      <line x1="20" y1="32" x2="20" y2="38" stroke="currentColor" strokeWidth="2" />
      <line x1="2" y1="20" x2="8" y2="20" stroke="currentColor" strokeWidth="2" />
      <line x1="32" y1="20" x2="38" y2="20" stroke="currentColor" strokeWidth="2" />
    </>
  ),
  check: (
    <>
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 20l5.5 5.5L28 14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  x: (
    <>
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M14 14l12 12M26 14l-12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  linkedin: (
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" fill="currentColor" />
  ),
};

function Icon({ type, size = 40 }) {
  return (
    <svg viewBox={type === "linkedin" ? "0 0 24 24" : "0 0 40 40"} style={{ width: size, height: size }} fill="none">
      {ICON_PATHS[type]}
    </svg>
  );
}

function SproutLogo({ size = 24, muted = false }) {
  const light = muted ? "#ccc" : "#4CAF50";
  const dark = muted ? "#bbb" : "#2E7D32";
  return (
    <svg viewBox="0 0 64 64" fill="none" style={{ width: size, height: size }}>
      <path d="M35 26C41 18 49 10 54 6C51 17 43 27 35 32Z" fill={light} />
      <path d="M29 35C23 29 15 21 10 16C14 27 23 35 29 39Z" fill={dark} />
      <line x1="32" y1="56" x2="32" y2="22" stroke={dark} strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="56" r="5" fill={dark} />
    </svg>
  );
}

/* ── Shared styles ── */
const FONT = {
  serif: "'Newsreader', serif",
  sans: "'DM Sans', system-ui, -apple-system, sans-serif",
};

const COLORS = {
  green: "#2E7D32",
  red: "#C62828",
  greenLight: "#66BB6A",
  redLight: "#E57373",
  text: "#111",
  muted: "#666",
  faint: "#999",
  bg: "#FAF9F6",
};

const STEPS = [
  { step: "01", title: "Describe the rollout", desc: "What tool, how many people, which departments, when you go live. Connect your email and Slack.", sub: "Takes 5 minutes. Grasp asks the questions a change management consultant would — then uses your answers to shape every communication.", color: "#4A7C59" },
  { step: "02", title: "Review and approve", desc: "Grasp generates the full campaign — every email, Slack message, manager briefing, and survey. You review, edit, approve.", sub: "This is the only step that requires your time. Average review: 20 minutes. Then you're done.", color: "#5B7B9D" },
  { step: "03", title: "Grasp runs it", desc: "The campaign executes autonomously. Emails send on schedule. Slack messages post. Manager kits deliver. Follow-ups trigger.", sub: "Connects to Outlook, Gmail, Slack, or Teams. Sends as you or as a dedicated channel. Every message timed, targeted, tracked.", color: "#8B6E4E" },
  { step: "04", title: "Grasp adapts", desc: "Monitors engagement across every channel. Teams that aren't responding get different messaging, different timing, different approach.", sub: "If engineering opens everything but sales ignores it all, Grasp shifts strategy for sales automatically. You get a weekly readiness briefing.", color: "#7B6B8D" },
];

const FEATURES = [
  { icon: "email", title: "Email sequences", desc: "Department-specific drip campaigns that build understanding over weeks — not a single blast.", color: "#4A7C59" },
  { icon: "chat", title: "Slack & Teams", desc: "Channel posts, DMs to key stakeholders, threaded Q&A — posted at exactly the right moment.", color: "#5B7B9D" },
  { icon: "clipboard", title: "Manager briefing kits", desc: "Talking points and FAQ docs delivered to every manager before their team hears a word.", color: "#8B6E4E" },
  { icon: "refresh", title: "Adaptive follow-ups", desc: "People who haven't engaged get different messaging — different angle, different channel, different time.", color: "#7B6B8D" },
  { icon: "chart", title: "Sentiment tracking", desc: "Automated pulse surveys. Real-time dashboard showing buy-in by department, team, and role.", color: "#4A7C59" },
  { icon: "target", title: "Resistance response", desc: "Detects pushback and responds with tailored messaging for each person's specific concern.", color: "#5B7B9D" },
];

const WITHOUT = [
  "One company-wide email announces the change",
  "Managers blindsided with questions they can't answer",
  "Employees hear about it through rumors first",
  "Single training session two days before go-live",
  "Adoption hits 20% after three months",
  "CFO asks why 400 licenses are collecting dust",
];

const WITH = [
  "Targeted emails to each department — why this matters to them",
  "Managers get talking points before anyone asks questions",
  "Employees hear from their direct manager first",
  "Skeptics get personalized follow-ups for their objections",
  "Engagement tracked in real-time — you see who's bought in",
  "By go-live, the groundwork has been running for weeks",
];

const COMPARISON_ROWS = [
  { row: "Cost", c1: "$0 up front, $$$$ in waste", c2: "$50K – $200K", c3: "$500/mo" },
  { row: "Time to first message", c1: "—", c2: "4–10 weeks", c3: "Same day" },
  { row: "Personalized by dept.", c1: "No", c2: "Sometimes", c3: "Always" },
  { row: "Adapts to engagement", c1: "No", c2: "Manually", c3: "Automatically" },
  { row: "Runs autonomously", c1: "—", c2: "No", c3: "Yes" },
  { row: "Multi-channel", c1: "—", c2: "Email only", c3: "All channels" },
];

const SCENARIOS = [
  { tool: "Microsoft Copilot", pain: "400 licenses x $30/user. Adoption: 15%.", cost: "$122K/yr wasted" },
  { tool: "Salesforce migration", pain: "Reps stay in spreadsheets. Pipeline visibility: zero.", cost: "6-month recovery" },
  { tool: "ERP rollout", pain: "Finance resists for months. Dual systems, double errors.", cost: "$200K+ in delays" },
];

const TEAM = [
  {
    name: "Akash Jain",
    role: "Co-Founder & CEO",
    photo: "/Akash.jpeg",
    bio: "Penn M&T (Wharton + Engineering). Strategy consultant for 3+ years in life sciences. Background in marketing, operations management, and chemical engineering.",
    linkedin: "https://www.linkedin.com/in/akash120/",
  },
  {
    name: "Eliot Herbst",
    role: "Co-Founder & CTO",
    photo: "/Eliot.jpeg",
    bio: "Software Engineering at Amazon, a16z-backed Halliday, and former CTO of a $50M IT VAR. Built software for Zoom, Microsoft.",
    linkedin: "https://www.linkedin.com/in/eliot-herbst-016b77164/",
  },
  {
    name: "Arik Li",
    role: "Co-Founder",
    photo: "/Arik.jpg",
    bio: "Wharton (Entrepreneurship & Innovation). Healthcare investment banking at BofA. Growth investing at H.I.G. Capital.",
    linkedin: "https://www.linkedin.com/in/ricky-w-li/",
  },
];

/* ── Reusable section label ── */
function SectionLabel({ children }) {
  return (
    <p style={{ fontSize: 12, fontWeight: 700, color: COLORS.faint, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 12px", textAlign: "center", fontFamily: FONT.sans }}>
      {children}
    </p>
  );
}

function SectionHeading({ children }) {
  return (
    <h2 style={{ fontFamily: FONT.serif, fontSize: "clamp(28px, 3.5vw, 40px)", fontWeight: 300, margin: "0 0 48px", textAlign: "center", lineHeight: 1.2, letterSpacing: "-0.02em" }}>
      {children}
    </h2>
  );
}

function Divider() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 48px" }}>
      <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent)" }} />
    </div>
  );
}

/* ── Main App ── */
export default function App() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [hoveredStep, setHoveredStep] = useState(null);

  const scrollToCta = () => document.getElementById("cta")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div style={{ fontFamily: FONT.sans, color: COLORS.text, position: "relative", overflow: "hidden" }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500&family=DM+Sans:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Noise texture */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999, opacity: 0.025, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`, backgroundRepeat: "repeat", backgroundSize: "256px 256px" }} />

      {/* Background */}
      <div style={{ position: "fixed", inset: 0, background: "linear-gradient(175deg, #FAFAF7 0%, #F4F3EF 40%, #EFEEE8 100%)", zIndex: -2 }} />
      <div style={{ position: "fixed", top: "-30%", right: "-15%", width: "70vw", height: "70vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(200,210,190,0.15) 0%, transparent 70%)", zIndex: -1 }} />
      <div style={{ position: "fixed", bottom: "-20%", left: "-10%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(190,195,210,0.1) 0%, transparent 70%)", zIndex: -1 }} />

      {/* ─── Nav ─── */}
      <nav className="nav-padding" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SproutLogo size={26} />
          <span style={{ fontFamily: FONT.serif, fontSize: 26, fontWeight: 400, letterSpacing: "-0.03em" }}>grasp</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: FONT.sans, fontSize: 12, fontWeight: 500, color: COLORS.muted, position: "relative", top: -2 }}>
            Text us
          </span>
          <svg width="24" height="20" viewBox="0 0 24 20" fill="none" style={{ position: "relative", top: 2 }}>
            <path d="M4 2C8 4 14 10 18 16" stroke={COLORS.muted} strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <path d="M14 14L18 16L16 11" stroke={COLORS.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <a
            href="sms:9196015897"
            style={{ fontFamily: FONT.sans, fontSize: 15, fontWeight: 600, color: COLORS.text, letterSpacing: "-0.01em", textDecoration: "none" }}
          >
            (919) 601-5897
          </a>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="section-padding" style={{ maxWidth: 860, margin: "0 auto", padding: "100px 48px 80px", textAlign: "center" }}>
        <Reveal>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(46,125,50,0.08)", color: COLORS.green, fontSize: 12, fontWeight: 600, padding: "5px 16px", borderRadius: 100, marginBottom: 28, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS.green }} />
            Now in early access
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <h1 style={{ fontFamily: FONT.serif, fontSize: "clamp(42px, 5.5vw, 68px)", fontWeight: 300, lineHeight: 1.08, margin: "0 0 24px", letterSpacing: "-0.035em" }}>
            You approve the plan.<br />
            <span style={{ fontStyle: "italic", fontWeight: 400 }}>Grasp runs the rollout.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.16}>
          <p style={{ fontSize: 17, color: COLORS.muted, lineHeight: 1.75, margin: "0 auto 44px", maxWidth: 540, fontWeight: 400 }}>
            An AI agent that builds and executes the entire internal communication campaign for your technology rollouts — emails, Slack, manager briefings, follow-ups — autonomously.
          </p>
        </Reveal>
        <Reveal delay={0.24}>
          <div className="hero-buttons" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={scrollToCta}
              style={{ background: "#111", color: COLORS.bg, border: "none", padding: "15px 36px", borderRadius: 100, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT.sans, transition: "transform 0.15s ease, box-shadow 0.2s ease", boxShadow: "0 2px 20px rgba(0,0,0,0.08)" }}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              Join the waitlist
            </button>
            <button
              onClick={() => window.open("https://calendly.com/akashjain-grasp/30min", "_blank")}
              style={{ background: "rgba(255,255,255,0.6)", color: "#333", border: "1px solid rgba(0,0,0,0.1)", padding: "15px 36px", borderRadius: 100, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: FONT.sans, backdropFilter: "blur(8px)", transition: "all 0.2s ease" }}
            >
              Book a call
            </button>
          </div>
        </Reveal>
      </section>

      <Divider />

      {/* ─── Before / After ─── */}
      <section className="section-padding" style={{ maxWidth: 960, margin: "0 auto", padding: "80px 48px" }}>
        <Reveal>
          <SectionLabel>The pattern you already know</SectionLabel>
          <SectionHeading>
            Every rollout fails the <span style={{ fontStyle: "italic" }}>same</span> way.
          </SectionHeading>
        </Reveal>

        <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* Without Grasp */}
          <Reveal delay={0.1}>
            <div style={{ background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)", borderRadius: 20, border: "1px solid rgba(0,0,0,0.05)", padding: "36px 32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <div style={{ color: COLORS.red }}><Icon type="x" /></div>
                <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.red, textTransform: "uppercase", letterSpacing: "0.08em" }}>Without Grasp</span>
              </div>
              {WITHOUT.map((t, i) => (
                <Reveal key={i} delay={0.12 + i * 0.04}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0" }}>
                    <span style={{ color: COLORS.redLight, fontSize: 10, marginTop: 5, flexShrink: 0 }}>●</span>
                    <span style={{ fontSize: 14, color: COLORS.muted, lineHeight: 1.55 }}>{t}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </Reveal>

          {/* With Grasp */}
          <Reveal delay={0.15}>
            <div style={{ background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)", borderRadius: 20, border: "1px solid rgba(0,0,0,0.05)", padding: "36px 32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <div style={{ color: COLORS.green }}><Icon type="check" /></div>
                <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.green, textTransform: "uppercase", letterSpacing: "0.08em" }}>With Grasp</span>
              </div>
              {WITH.map((t, i) => (
                <Reveal key={i} delay={0.17 + i * 0.04}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0" }}>
                    <span style={{ color: COLORS.greenLight, fontSize: 10, marginTop: 5, flexShrink: 0 }}>●</span>
                    <span style={{ fontSize: 14, color: "#555", lineHeight: 1.55 }}>{t}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section className="section-padding" style={{ maxWidth: 960, margin: "0 auto", padding: "60px 48px 80px" }}>
        <Reveal>
          <SectionLabel>How it works</SectionLabel>
          <SectionHeading>
            Set it up once. Grasp handles <span style={{ fontStyle: "italic" }}>everything</span>.
          </SectionHeading>
        </Reveal>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 700, margin: "0 auto" }}>
          {STEPS.map((s, i) => (
            <Reveal key={i} delay={i * 0.08}>
              <div
                className="step-row"
                onMouseEnter={() => setHoveredStep(i)}
                onMouseLeave={() => setHoveredStep(null)}
                style={{
                  display: "flex", gap: 28, padding: "32px 24px",
                  borderTop: i > 0 ? "1px solid rgba(0,0,0,0.05)" : "none",
                  borderRadius: 16, transition: "background 0.3s ease",
                  background: hoveredStep === i ? "rgba(255,255,255,0.4)" : "transparent",
                  cursor: "default",
                }}
              >
                <div className="step-number" style={{ fontSize: 48, fontFamily: FONT.serif, fontWeight: 300, color: s.color, opacity: 0.4, lineHeight: 1, minWidth: 56, textAlign: "right", letterSpacing: "-0.04em" }}>
                  {s.step}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, color: "#222" }}>{s.title}</div>
                  <div style={{ fontSize: 15, color: "#444", lineHeight: 1.65, marginBottom: 6 }}>{s.desc}</div>
                  <div style={{ fontSize: 13, color: COLORS.faint, lineHeight: 1.6 }}>{s.sub}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── What Grasp sends ─── */}
      <section className="section-padding" style={{ maxWidth: 960, margin: "0 auto", padding: "60px 48px 80px" }}>
        <Reveal>
          <h2 style={{ fontFamily: FONT.serif, fontSize: "clamp(26px, 3vw, 36px)", fontWeight: 300, margin: "0 0 8px", textAlign: "center", letterSpacing: "-0.02em" }}>
            Everything a change team delivers.
          </h2>
          <p style={{ fontSize: 14, color: COLORS.faint, textAlign: "center", margin: "0 0 44px" }}>
            Executed autonomously, across every channel your team uses.
          </p>
        </Reveal>

        <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {FEATURES.map((f, i) => (
            <Reveal key={i} delay={i * 0.06}>
              <div
                style={{
                  background: "rgba(255,255,255,0.45)", backdropFilter: "blur(12px)",
                  borderRadius: 16, border: "1px solid rgba(0,0,0,0.04)",
                  padding: "28px 24px", transition: "transform 0.2s ease, box-shadow 0.2s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.04)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ color: f.color, marginBottom: 14 }}><Icon type={f.icon} /></div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "#222" }}>{f.title}</div>
                <div style={{ fontSize: 13, color: "#777", lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ─── Comparison table ─── */}
      <section className="section-padding" style={{ maxWidth: 860, margin: "0 auto", padding: "60px 48px 80px" }}>
        <Reveal>
          <div style={{ background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)", borderRadius: 20, border: "1px solid rgba(0,0,0,0.05)", overflow: "hidden" }}>
            <table className="comparison-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ padding: "20px 24px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.08em", width: "30%" }} />
                  <th style={{ padding: "20px 24px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.06em", width: "23.3%" }}>Do nothing</th>
                  <th style={{ padding: "20px 24px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.06em", width: "23.3%" }}>Consultants</th>
                  <th style={{ padding: "20px 24px", textAlign: "center", fontSize: 12, fontWeight: 700, color: COLORS.green, textTransform: "uppercase", letterSpacing: "0.06em", width: "23.3%", background: "rgba(46,125,50,0.04)" }}>Grasp</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                    <td style={{ padding: "14px 24px", fontSize: 13, fontWeight: 600, color: "#555" }}>{r.row}</td>
                    <td style={{ padding: "14px 24px", textAlign: "center", fontSize: 13, color: "#bbb" }}>{r.c1}</td>
                    <td style={{ padding: "14px 24px", textAlign: "center", fontSize: 13, color: "#999" }}>{r.c2}</td>
                    <td style={{ padding: "14px 24px", textAlign: "center", fontSize: 13, color: COLORS.green, fontWeight: 600, background: "rgba(46,125,50,0.04)" }}>{r.c3}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      {/* ─── Your next rollout ─── */}
      <section className="section-padding" style={{ maxWidth: 960, margin: "0 auto", padding: "60px 48px 80px" }}>
        <Reveal>
          <div style={{ background: "#111", borderRadius: 24, padding: "56px 52px", color: "white", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: "-50%", right: "-20%", width: "60%", height: "120%", borderRadius: "50%", background: "radial-gradient(circle, rgba(74,124,89,0.15) 0%, transparent 70%)" }} />
            <div style={{ position: "absolute", bottom: "-30%", left: "-10%", width: "40%", height: "80%", borderRadius: "50%", background: "radial-gradient(circle, rgba(91,123,157,0.1) 0%, transparent 70%)" }} />

            <h2 style={{ fontFamily: FONT.serif, fontSize: "clamp(26px, 3vw, 36px)", fontWeight: 300, margin: "0 0 10px", textAlign: "center", position: "relative", letterSpacing: "-0.02em" }}>
              Your next rollout is coming.
            </h2>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", textAlign: "center", margin: "0 auto 36px", maxWidth: 460, position: "relative" }}>
              Whether it's Copilot, a CRM migration, or an AI tool your CEO just bought — the adoption problem is the same.
            </p>

            <div className="scenario-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, position: "relative" }}>
              {SCENARIOS.map((p, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: "22px 20px", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.9)", marginBottom: 8 }}>{p.tool}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, marginBottom: 8 }}>{p.pain}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.redLight }}>{p.cost}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ─── Team ─── */}
      <section className="section-padding" style={{ maxWidth: 960, margin: "0 auto", padding: "60px 48px 80px" }}>
        <Reveal>
          <SectionLabel>The team</SectionLabel>
          <SectionHeading>
            Built by people who've <span style={{ fontStyle: "italic" }}>lived</span> the problem.
          </SectionHeading>
        </Reveal>

        <div className="grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, maxWidth: 800, margin: "0 auto" }}>
          {TEAM.map((member, i) => (
            <Reveal key={i} delay={i * 0.08}>
              <div style={{
                background: "rgba(255,255,255,0.5)", backdropFilter: "blur(12px)",
                borderRadius: 20, border: "1px solid rgba(0,0,0,0.05)",
                padding: "32px 24px", textAlign: "center",
                transition: "transform 0.2s ease, box-shadow 0.2s ease",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.04)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <img
                  src={member.photo}
                  alt={member.name}
                  style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", margin: "0 auto 16px" }}
                />
                <div style={{ fontSize: 17, fontWeight: 600, color: "#222", marginBottom: 2 }}>{member.name}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.green, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>{member.role}</div>
                <div style={{ fontSize: 13, color: "#777", lineHeight: 1.6, marginBottom: 14 }}>{member.bio}</div>
                <a
                  href={member.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#555", fontSize: 13, fontWeight: 500, textDecoration: "none", transition: "color 0.2s ease" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.green)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
                >
                  <Icon type="linkedin" size={16} />
                  LinkedIn
                </a>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.3}>
          <p style={{ fontSize: 13, color: "#bbb", textAlign: "center", marginTop: 32, fontStyle: "italic", fontFamily: FONT.serif }}>
            From Penn. Got tired of watching good software die from bad rollouts.
          </p>
        </Reveal>
      </section>

      {/* ─── Founder quote ─── */}
      <section className="section-padding" style={{ maxWidth: 640, margin: "0 auto", padding: "40px 48px 60px", textAlign: "center" }}>
        <Reveal>
          <div style={{ width: 48, height: 1, background: "#ddd", margin: "0 auto 32px" }} />
          <p style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 300, fontStyle: "italic", color: "#444", lineHeight: 1.7, margin: "0 0 16px", letterSpacing: "-0.01em" }}>
            "I've been the CTO who sends the announcement email, runs one training, and watches adoption flatline. I kept saying 'next time we'll do the communication part right.' We never did. So I built the thing that does it for you."
          </p>
        </Reveal>
      </section>

      {/* ─── CTA ─── */}
      <section id="cta" className="section-padding" style={{ maxWidth: 560, margin: "0 auto", padding: "60px 48px 120px", textAlign: "center" }}>
        <Reveal>
          <h2 style={{ fontFamily: FONT.serif, fontSize: "clamp(30px, 4vw, 42px)", fontWeight: 300, margin: "0 0 10px", letterSpacing: "-0.03em" }}>
            Stop managing rollouts.<br />
            <span style={{ fontStyle: "italic" }}>Let Grasp run them.</span>
          </h2>
          <p style={{ fontSize: 15, color: "#888", margin: "0 0 32px" }}>Early access is open now.</p>

          {!submitted ? (
            <div>
              <div style={{ display: "flex", gap: 8, maxWidth: 420, margin: "0 auto 18px" }}>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && email) setSubmitted(true); }}
                  style={{
                    flex: 1, padding: "15px 18px", borderRadius: 100,
                    border: "1px solid rgba(0,0,0,0.1)", fontSize: 14, outline: "none",
                    background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)",
                    fontFamily: FONT.sans,
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.25)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.1)")}
                />
                <button
                  onClick={() => { if (email) setSubmitted(true); }}
                  style={{
                    background: "#111", color: COLORS.bg, border: "none", padding: "15px 30px",
                    borderRadius: 100, fontSize: 14, fontWeight: 600, cursor: "pointer",
                    whiteSpace: "nowrap", fontFamily: FONT.sans, transition: "transform 0.15s ease",
                  }}
                  onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
                  onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                >
                  Join waitlist
                </button>
              </div>
              <button
                onClick={() => window.open("https://calendly.com/akashjain-grasp/30min", "_blank")}
                style={{ background: "transparent", color: COLORS.faint, border: "none", fontSize: 13, cursor: "pointer", padding: 8, fontWeight: 500 }}
              >
                or book a 15-minute call →
              </button>
            </div>
          ) : (
            <div style={{ background: "rgba(46,125,50,0.06)", borderRadius: 16, padding: 28, maxWidth: 420, margin: "0 auto", border: "1px solid rgba(46,125,50,0.1)" }}>
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>You're on the list.</div>
              <div style={{ fontSize: 14, color: "#777" }}>We'll reach out soon with early access.</div>
            </div>
          )}
        </Reveal>
      </section>

      {/* ─── Footer ─── */}
      <footer style={{ borderTop: "1px solid rgba(0,0,0,0.05)", padding: "28px 48px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <SproutLogo size={18} muted />
          <span style={{ fontFamily: FONT.serif, fontSize: 18, color: "#ccc", letterSpacing: "-0.02em" }}>grasp</span>
        </div>
        <div style={{ fontSize: 11, color: "#ddd", marginTop: 4, letterSpacing: "0.02em" }}>
          The AI agent that runs your technology rollout campaigns.
        </div>
      </footer>
    </div>
  );
}
