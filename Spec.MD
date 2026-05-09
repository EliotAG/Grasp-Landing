**Grasp**

Product Spec — Internal Alignment v1.0

For: Eliot, Akash, Eric

Executive Summary

Grasp is a continuous change management tool for small-to-midsize companies. Leadership uses it to roll out process changes — AI adoption, workflow updates, new tools, policy shifts — and Grasp runs the behind-the-scenes behavior change work across teams that makes those changes actually land.

The core insight from our research phase: most change management tooling targets the weakest intervention layer (persuasion to the conscious goal system) on the wrong unit (individual psychology rather than group dynamics), using metrics that conflate adoption with durable behavior change. What actually drives successful change, per 60+ years of empirical research, is a pipeline the industry has been citing without practicing: specific behavior specification, readiness-matched interventions, implementation-intention elicitation, trust integrity, and closed-loop response to employee concerns.

Grasp operationalizes that pipeline at a scale and cadence humans can't. It is sold to leadership and structurally serves both sides — surfacing what the workforce is actually telling the organization while helping leadership communicate and respond well. It competes on epistemic integrity, not on adoption acceleration.

The Two Things Grasp Does

**Helps leadership craft the rollout plan.** A web-based, AI-assisted planning wizard that turns "we're rolling out X" into a specific, measurable, research-backed change plan: behavior specification, affected population (from org chart), core mechanism to preserve, timeline, response cadence commitments, and a drafted announcement scored against empirical communication patterns.

**Manages feedback and action items during the rollout.** A conversational agent in Teams/Zoom that checks in with affected employees (daily text tapering over ~30 days, voice at strategic moments), captures three-dimensional response (what they think, what they feel, what they're doing), surfaces concerns with characterization to leadership, carries leadership responses back to employees, and tracks whether commitments are being kept.

Pilot Targets

- **[unifiedcommunications.com](http://unifiedcommunications.com) (primary):** AV integrator, ~90 employees, continuous process improvement culture. Buyer: CEO and COO. This is the cleanest signal for product-market fit.
- **Four real estate firms (10–100 employees):** Portfolio of a business owner Eliot knows; pilots in exchange for AI adoption help. Pilots skew toward AI adoption as the inaugural change but will cover other process changes as well.

Target company profile for commercial scaling post-pilot: 50–150 employees, hierarchical enough that management-by-walking-around no longer scales, small enough that leadership still has visibility into team dynamics.

Pilot Success Metric

Leadership at a pilot company runs several process changes through Grasp over the pilot period. At 30 days post each change, the leadership dashboard shows specific people actually doing the new process (via self-report), reasonable trust and acceptability signals, and flags the specific individuals who are off-track at the manager-bypassing granularity that makes the tool useful in the first place. CEO and COO say it delivered that.

Timeline

Two to three weeks to MLP, one builder with AI tooling.

Product Detail

Grasp has two surfaces and one connecting data layer.

- **Web app:** leadership lives here. Org chart management, change planning, reporting dashboards, response management, survey admin.
- **Conversational agent:** employees live here. Lives in Teams or Zoom chat depending on which platform the pilot company uses. Voice capability for initial kickoff calls and high-concern re-engagement.
- **Shared state:** the change-plan object created in the web app is what the agent executes against. Responses, surveys, and interaction data flow back up to the web app for leadership visibility.

One-Time Onboarding (per company)

Step 1: Admin loads the org chart

During pilot setup, the founder-as-admin uploads the organizational structure through the web app — team names, member names, manager relationships, email addresses matching the company's Teams/Zoom directory. CSV upload or structured form, whichever is faster to build. This becomes ground truth for the agent: who's on which team, who reports to whom, how to reach each person in Teams/Zoom.

Post-MLP this becomes SSO-based auto-sync. For the pilot, manual upload is fine and actually preferable — forces a conversation with leadership about how they think about team structure.

Step 2: Agent introduces itself to each employee

The agent sends a first message to each employee in Teams/Zoom. The framing is deliberately not "newest team member" (too peer-coded, creates trust cliff when employee realizes it reports to leadership). Instead: honest tool framing, warm in tone, explicit about function and about what happens to what the employee says.

Target message shape:

*"Hi [name] — I'm Grasp. Leadership at [company] has brought me in to support process changes here. Over time, when there's a new change rolling out that affects you, I'll check in briefly — mostly by message, sometimes by voice — to see how it's landing, answer questions, and make sure your input reaches the people who can act on it."*

*"What you tell me gets summarized and shared with leadership in aggregate — patterns across teams, common concerns, things needing a response. Individual details stay private unless you ask me to bring something up directly. If you raise a concern, I'll make sure leadership sees it and responds within the timeframe they've committed to."*

*"You can skip any check-in, tell me something's off-topic, or pause me anytime. Before we get going, I'd like to understand a bit about how you work and how you tend to experience change — takes about 10 minutes, link below."*

Step 3: Employee completes the baseline survey

Survey lives in the web app, accessed via a link from the agent's introduction message. 25–30 items, ~10 minutes. Four dimensions:

- **Change disposition (Oreg's RTC Scale, 17 items):** routine seeking, emotional reaction to imposed change, short-term focus, cognitive rigidity. Tells Grasp how this person tends to experience change in general.
- **Motivation orientation (Deci & Ryan causality short form, ~12 items):** autonomy vs. control vs. impersonal orientation. Tells Grasp how to frame communications with this person — rationale-and-choice for autonomy-oriented, structure-and-expectation for control-oriented.
- **Working preferences:** preferred communication channel (text vs. voice), ideal time of day for check-ins, a rough sense of current workload. Reduces friction in how Grasp reaches out.
- **Prior change experience:** brief self-report on changes they've been through and how those went. This is trust-history data at the individual level — someone with three failed rollouts behind them is in a different starting position than a new hire.

Explicitly not included: Big Five, neuroticism, wellbeing/mental health items, anything that looks like HR psych screening. The survey is scoped to change-relevant traits, not general psychological profiling, to keep it tightly bounded and privacy-defensible.

**Critical framing on privacy:** survey data is private to the agent–employee relationship. It informs how Grasp interacts with this person. It is never surfaced to leadership as individual data. Aggregate distribution patterns ("this team skews high-RTC") may be shown if relevant, but the individual profiles stay with the agent. This boundary is stated clearly to employees at the start of the survey and is load-bearing for trust.

One-and-done in v1. Annual retake is a v2 question we defer, consistent with our actual business horizon.

Per-Change Workflow

Leadership initiates a change. Grasp runs the behavior change work over ~30 days. V1 is sequential — one active change at a time per company. Concurrency is v2.

Step 1: Leadership opens the planning wizard (web app)

AI-assisted wizard walks the leader through creating a change-plan object. Designed to take 20–30 minutes for a meaningful change, less for small ones. The wizard is opinionated about what a change plan must contain because the research is clear about what's load-bearing:

- **Behavior specification (Atkins et al. standard).** The wizard refuses vague outcomes like "drive CRM adoption." It forces who-does-what-when-where-how-often-with-whom. In practice this is specified per stakeholder group (see below) — a rollout usually has multiple related behaviors rather than one. This is the most leveraged step in the entire workflow — without it, nothing downstream can measure against anything real.
- **Stakeholder groups and how each is affected.** The wizard does not collect a flat list of "affected employees." It forces leadership to identify distinct stakeholder groups, label them, and specify how each is affected and why. A CRM rollout might have: sales reps (primary behavior change — they log interactions in the new system), sales managers (coaching and enforcement — they review logs and address gaps), operations (downstream consumers — they rely on CRM data quality for their reports), IT (support and troubleshooting — they answer technical questions). Each group is drawn from the org chart and gets a short description of their role in this change.
- **Why this granularity matters:** different stakeholder groups need different behaviors from the rollout, different check-in content, different framings of the core mechanism, and generate different types of concerns worth surfacing. A cognitive objection from a sales manager ("this slows down coaching conversations") is different from the same surface words from a sales rep ("this slows down my logging") — different drivers, different responses. Flat "affected population" collapses this distinction and degrades everything downstream. Grasp tailors check-ins, implementation intention elicitation, and reporting per stakeholder group, not just per team.
- **Behavior specification per stakeholder group.** Each group gets its own who-does-what-when-where-how-often specification. The CRM example: sales reps log each customer interaction within 24 hours; sales managers review their team's log weekly and coach on gaps; operations pulls reports from the new system rather than the old one by week two; IT triages support tickets via the new ticketing flow. These are four related but distinct behavior specifications, each measurable on its own.
- **Timeline.** Kickoff date and target adoption date. Default 30 days, adjustable.
- **Core mechanism.** What about this change cannot be lost in telephone? CFIR's core-vs-adaptable-periphery distinction applied at the single-rollout level. This is what Grasp preserves across teams regardless of how local delivery adapts.
- **Response cadence commitment.** When Grasp surfaces a concern from an employee, leadership commits to responding within a specific window (48 hours, 1 week, whatever fits). This commitment is tracked. If leadership misses it, Grasp surfaces that as a red flag — broken commitments destroy trust faster than any other single thing per the 60-year empirical review.
- **Announcement drafting.** The wizard helps the leader compose the initial communication. AI-assisted generation, but the leader owns the content. Drafts are scored against three empirical checks: Deci & Ryan three-factor internalization (rationale + acknowledgment-of-downside + choice framing); Bridges four P's (Purpose, Picture, Plan, Part to Play); loss-aversion reframing (gains made concrete, losses acknowledged honestly). Wizard flags gaps and suggests revisions; leader approves final.
- **Training materials (optional).** Leader uploads any training docs, SOPs, policy documents, FAQs relevant to this change. PDF, DOCX, markdown. These become the agent's RAG knowledge base for answering employee questions during the rollout. Scoped to this specific change — no cross-contamination with prior changes.

Output of the wizard: a change-plan object that the agent executes against. Also: the initial announcement communication is sent to affected employees either by the leader directly or on their behalf — this is a choice in the wizard.

Step 2: Kickoff — agent contacts each affected employee

Day zero: agent messages each affected employee with the change announcement and references the commitment leadership has made. For employees whose baseline survey indicates voice preference, offers voice kickoff; for others, offers it optionally. Most employees will get a voice kickoff because it's the single highest-value interaction of the rollout.

**Initial 5-minute voice call per employee.** Purpose: establish relationship for this specific change, elicit implementation intention (per Gollwitzer — the single highest-leverage behavioral intervention in the research: "when X happens, I will do Y"), capture three-dimensional response baseline (cognitive/emotional/behavioral), surface initial concerns. Voice earns its cost here because spoken commitments feel more committal than typed ones and because nuance in emotional response is higher fidelity in voice than in text.

Employees who decline voice get the same content in structured text exchange. More turns, but same information.

Step 3: Ongoing check-ins during the change window

Text check-ins daily through week one, tapering to every other day in week two, and lighter (twice a week) through weeks three and four. Each check-in is short — one or two questions, 30-second interactions. Content adapts to the employee's survey-derived profile (autonomy-oriented vs. control-oriented framing; high-RTC employees get more space and less push).

Check-in content rotates across:

Check-in content rotates across:

- Adoption check via non-leading questions ("walk me through how you handled [the thing] yesterday") rather than leading yes/no ("are you using the new process?"). Self-report is noisy but non-leading questions produce less social-desirability bias. The specific behavior being asked about is the one specified for this employee's stakeholder group, not a generic "new process" reference.
- Concern surfacing ("anything getting in the way?").
- Three-dimensional response sampling (light touches on cognitive, emotional, behavioral — not all three every time).
- Implementation intention follow-through ("you said you'd start doing X after the Tuesday standup — how'd that go?"). This is a proactive reminder of the user's own commitment, not a push toward something they didn't agree to.

Voice re-engagement is triggered when something flags as high-concern: strong negative emotional signal, unresolved objection, surveyed-profile mismatch with observed behavior. A human-like check-in at those moments protects against the Abbas et al. "rigidity" failure mode where a text-only agent insists on its cadence regardless of what the employee is going through.

Step 4: Reactive Q&A throughout

Separately from proactive check-ins, employees can ask the agent questions about the change at any time. Agent answers from the uploaded training docs using RAG, with citations ("per section 3 of the onboarding guide..."). When it can't answer confidently from the docs, it says so rather than generating — this prevents the Abbas "hallucinated capabilities" failure mode that destroys trust across all agent functions.

Unanswered questions are queued for leadership. Clustering logic: if three or more employees ask the same unanswered question, it surfaces in the leadership dashboard as a training gap ("multiple people are asking how to handle returns in the new process — consider adding to training materials"). Individual unanswered questions are browsable by leadership but don't push a notification — signal over noise.

Privacy framing for Q&A data: what any given employee asks about is summarized in aggregate for leadership, not attributed to them individually. Explicitly stated when employees first use the Q&A feature.

Step 5: Leadership monitoring (web app)

Leadership dashboard shows the active change with:

- Per-change adoption rate overall (self-reported behavior completion, with noise framing for small populations).
- Per-stakeholder-group breakdown (how each defined stakeholder group is tracking against their specific behavior specification). This is the primary slice because different groups are doing different behaviors — a flat "adoption rate" across groups is usually misleading.
- Per-team breakdown within each stakeholder group (e.g., how each sales team is tracking on the rep behavior; how each ops team is tracking on the consumer behavior).
- Per-person flagging for off-track individuals — the specific names. This is the "skip the manager level" feature that makes Grasp useful: "two people on this team aren't aware" is directly visible to leadership rather than filtered through management telephone.
- Trust and sentiment deltas across the change window, sliced by stakeholder group, presented with appropriate noise framing for small samples. Directional signal, not false-precision numbers.
- Surfaced concerns with three-dimensional characterization (cognitive disagreement vs. emotional processing vs. behavioral signal), stakeholder-group attribution (which group raised it), and response status.
- Training gap signals (clustered unanswered questions), with stakeholder-group attribution where the pattern differs by group.
- Response cadence tracker — is leadership keeping the commitments it made?

Step 6: Response loop

Leadership reviews surfaced concerns in the web app and responds within the committed cadence. Response can be written directly (agent carries it back to the employee), delegated to a manager (agent routes accordingly), or handled offline (leader marks resolved and writes what happened).

When the agent carries a response back to an employee, it's framed transparently: "your concern was raised to leadership, here's what they said." Closed loop: the employee knows their voice reached the right place and got acknowledged. This is the core trust-building mechanism and probably Grasp's primary differentiator from survey-and-dashboard tools.

Response cadence tracking is first-class. If leadership misses their commitment, a red-flag indicator appears on the dashboard and persists across the rollout. Accumulated misses across multiple rollouts surface as a structural issue in the long-term reporting, because trust damage from broken commitments compounds.

Step 7: 30-day report and close

At the end of the change window, leadership gets a summary report in the web app covering adoption rates, per-team and per-person breakdowns, trust/sentiment trajectories over the month, outstanding concerns, training gaps identified, and response-cadence adherence. This is the artifact CEO and COO point to when asking whether Grasp delivered.

The change moves to a "completed" state. Outstanding concerns are either resolved or carried forward with visibility. Leadership can initiate the next change whenever they're ready.

Manager Layer

Managers are not bypassed; they're augmented. The agent talks directly to employees for data collection (this is the core value — no telephone loss), but managers see their team's status in a dedicated view and participate in the response loop.

Manager view shows: their team's adoption rates, individual status for their direct reports, surfaced concerns from their team, and response tracking for items assigned to them. They can respond to their team's concerns through the agent (which carries the response back) or handle it in person (marking resolved in the dashboard). Notifications when someone on their team flags as off-track.

This preserves the principal-support relationship (Oreg-Vakola-Armenakis identified direct-manager support as one of the four most consistent predictors of change outcomes) while still giving leadership the manager-bypassing visibility that makes the product uniquely valuable.

Between Changes

Grasp is quiet between changes. The standing relationship with each employee persists — Grasp doesn't re-introduce itself at each new rollout, and survey data, preferences, and history carry forward. But there is no baseline cadence, no general wellbeing check-in, no proactive interaction outside an active change. Leadership decides when to initiate the next change and Grasp wakes up.

This is a deliberate design choice. Continuous presence with active cadence risks drifting into wellbeing monitoring territory, which is not what we're building and would erode the trust that makes the product work. The continuous framing is about the tool being an ongoing subscription serving many changes over time, not about the agent being continuously active in employees' inboxes.

Personalization Within the Honesty Principle

Grasp personalizes interactions using employee baseline data (RTC, causality orientation, communication preferences) plus in-flight observation (prior check-in responses, objection patterns, survey-indicated trust history). Same rollout, different framings for different employees. Autonomy-oriented employees get rationale-and-choice framing; control-oriented get structure-and-expectation. High-RTC employees get more advance notice, slower cadence, more routine preservation.

The operating principle, resolved in our conversation: personalization is transparent and bidirectional. The agent's characterization of an employee's objection (for example: "cognitively skeptical of the change itself" vs. "emotionally processing the timing, change content itself is fine") is surfaced to leadership as context and available to the employee if they ask. Agent responses to employees reflect the fuller characterization rather than only surface content.

**What Grasp does:** characterizes objections using research-backed frameworks; surfaces characterization transparently to leadership; responds to employees in a way that reflects the actual driver rather than only surface words; adapts communication style to employee profile; flags when surface objections likely mask something underneath (tiredness, exclusion from decision, loss processing) so leadership sees the full picture.

**What Grasp does not do:** generate covert persuasive content tuned to individual psychological profiles without surfacing the analysis; A/B test persuasion variants against employee segments; optimize message impact in a way the employee cannot see or inquire about. The Salvi finding (AI personalization creates a persuasive asymmetry humans cannot match) means this line is principled, not preference.

The test we agreed on: does this feature make employees less likely to tell the agent what they actually think? If yes, don't build it. If no, it's in. Transparent personalization passes this test because the employee knows the analysis is happening and knows it's shared both ways.

Ethical Commitments

These are design commitments for Grasp, not marketing positioning. They shape what we say yes and no to when pilot customers ask for things.

- Grasp does not generate persuasive content on behalf of leadership. It scores and flags leadership drafts against research-backed checks. Leadership writes the content.
- Proactivity is restricted to user-originated commitments (your own implementation intentions), workflow-boundary prompts at clear completion moments, leader-initiated cadences, and critical-incident surfacings. No proactive nudging toward things the user hasn't committed to.
- The agent communicates uncertainty, cites sources, and does not promise capabilities it doesn't have (memory, reminders, future actions). Hallucinated capabilities destroy trust across all functions.
- Personalization is transparent and bidirectional. Agent analysis is available to both leadership and employees. No covert persuasion-tuning.
- Survey data is private to the agent–employee relationship. Never surfaced to leadership as individual data.
- Employees can pause, skip, or opt out of check-ins at any time without social cost. Rigidity (Abbas et al. failure mode) is specifically designed against — the agent reads the room and backs off when the employee is slammed, upset, or declining.

Non-Goals for V1

Everything below is deliberately cut for MLP scope. Naming them explicitly prevents scope creep from "but surely we need…" during the build.

- Concurrent rollouts. Sequential only in v1.
- Change detection (agent inferring unannounced changes from workplace signals). Leadership-initiated only.
- SSO-based org chart sync. Manual CSV upload.
- Workflow telemetry integration (CRM APIs, ticketing systems, etc.). Self-report only.
- Full COM-B/TDF/BCT diagnostic pipeline surfaced to leadership. We measure relevant pieces in the background for learning but don't expose the full research stack.
- Habit formation curves, Kotter stage assessment, culture type diagnosis, Proctor's eight-outcome measurement. Valuable v2 additions.
- Survey retake. One-and-done in v1.
- Multi-org shared agent. Each pilot company gets its own Grasp deployment.
- Wellbeing/mental health monitoring, Big Five, neuroticism. Explicitly out of scope; not a v2 either — not what we build.
- Baseline cadence between active changes. Agent is quiet between rollouts.
- Leadership-directed persuasion optimization at individual-employee level using psychological data. Ethical commitment, not scope cut.

Technical Notes

This section covers what we need to know about integrations and AI components to build the product. It is not a full engineering spec — it's the set of technical decisions and dependencies the three of us should share a mental model of.

Teams Integration

Proactive messaging

Microsoft 365 Agents SDK bot, installed tenant-wide by each pilot admin via Teams Admin Center app setup policy. This avoids Graph install permissions that would otherwise require tenant-admin approval per install. The admin publishes the Grasp bot into the tenant and scopes it to the relevant users or groups.

Once installed, the bot can send proactive messages (1:1 DMs) to employees without prior user interaction. This is what lets the agent initiate kickoff messages and check-ins rather than only responding when spoken to.

Calendar and meeting scheduling

Graph Calendar API with a dedicated service account per pilot using delegated Calendars.ReadWrite permissions. This avoids tenant-wide application permissions that security teams will balk at. The service account acts on behalf of a leadership-designated identity that has calendar access to employees.

Used for: booking the 5-minute kickoff calls per employee, optional check-in voice calls if reactive scheduling is needed, and surfacing "this is on your calendar for Tuesday" to the employee via their normal calendar view rather than only via the bot.

Voice agent on calls

[Recall.ai](http://Recall.ai) for meeting join plus Output Media (bot speaks back), piped through OpenAI Realtime API mini for the STT+LLM+TTS loop. This is the stack from the original architecture spec and holds up. Approximate cost: $1,500/month total for six pilots of 100 users doing weekly 5-minute check-ins.

At our likely actual voice usage (initial 5-minute kickoff per affected employee per rollout, plus voice re-engagement for high-concern cases), costs run well under that ceiling. Closer to $300–600/month in aggregate across the pilot set assuming each rollout affects a subset of employees and voice happens maybe twice per affected employee per rollout.

Voice earns its cost specifically where spoken interaction produces higher-fidelity data than text: initial relationship establishment, implementation intention elicitation (spoken commitments feel more committal), and nuanced emotional or objection-characterization moments. Text carries the ongoing check-in load.

Zoom Integration

Proactive messaging

Zoom Team Chat app built with Zoom Apps SDK plus Chatbot framework. Bot gets installed via the Zoom Marketplace or private-listed for pilots, receives events when users add it, and sends proactive messages via the Zoom Chatbot API. Admin installs org-wide through the Zoom Admin portal — similar friction to the Teams flow.

Calendar and meeting scheduling

Zoom's Meetings API (POST /users/{userId}/meetings) to create scheduled meetings with auto-generated join URLs, combined with Google Calendar API or Microsoft Graph Calendar API to put the event on attendees' calendars. Zoom itself doesn't own the calendar layer — most Zoom-first companies run on Google Workspace or Microsoft 365 for calendar, so we integrate with whichever they use.

Worth noting: most of the AV integrator and real estate pilot companies are likely Microsoft 365 shops given the business-software patterns in those industries. We should verify which platform each pilot is on before the build, because it determines which integration we need working first.

Voice agent on calls

[Recall.ai](http://Recall.ai) works identically for Zoom (it's actually their strongest platform) plus OpenAI Realtime API mini. Same architecture, same cost profile as Teams. Zoom's browser/bot join experience is more mature than Teams, so expect slightly fewer edge cases.

AI Components

Planning wizard (web app)

LLM-backed conversational form. User types in plain language what they're rolling out; wizard extracts behavior specification (who/what/when/where), proposes affected population from org chart (user confirms/adjusts), suggests core mechanism language, drafts announcement communication. Each drafted communication is evaluated against three scoring passes (Deci & Ryan three-factor, Bridges four P's, loss-aversion reframing) and the wizard surfaces specific gaps with suggested revisions.

Model choice: Claude Sonnet or GPT-4o class. Nothing about this workflow needs frontier-level reasoning; it needs good structured output, reliable scoring against explicit rubrics, and clean conversational UX. Prompt engineering is more load-bearing than model selection.

Caching and state: each change plan is persisted as a structured object. The wizard generates the structure once; subsequent edits are targeted rather than regenerating the whole plan.

Agent conversational layer

Text interactions: standard LLM chat with tool use for (a) structured data capture (survey responses, check-in data, objections), (b) RAG over training documents for reactive Q&A, (c) carrying context from prior interactions with this employee (prior check-ins, survey data, history in this rollout).

Voice interactions: OpenAI Realtime API mini for low-latency STT+LLM+TTS loop. Turn-taking is a known challenge per the PITCH paper — the agent should wait longer than feels natural before responding to avoid cutting off mid-thought messages. Specifically build in a longer silence threshold on voice than the default Realtime API provides.

Memory: Grasp needs durable per-employee state — who they are, survey results, preferences, history of interactions, current status in each change. This lives in our database, not in the model context. The model is hydrated with relevant state at each interaction and persists updates back to the database. No reliance on model memory (which does not exist reliably and promising it to employees would be the Abbas hallucinated-capability failure mode).

RAG over training documents

Training docs are uploaded per change, embedded, and stored in a vector index scoped to that change. Employee asks a question → semantic retrieval from the change-scoped index → LLM generates answer with explicit citations ("per section 3 of the onboarding guide..."). When retrieval confidence is low or the question falls outside the document scope, the agent says so explicitly and queues the question as a training-gap signal.

Stack: standard RAG tooling — either Pinecone/Weaviate for the vector layer plus an orchestration layer, or a lighter solution like LlamaIndex if latency and cost allow. Given small per-change document sets (probably 10–100 pages per rollout), lightweight is fine; we don't need enterprise-scale retrieval infrastructure for the pilot.

Objection characterization

When an employee raises a concern during a check-in, the agent classifies it along Piderit's three dimensions (cognitive, emotional, behavioral) and attempts to identify likely underlying drivers beyond surface content (tiredness, exclusion from decision, loss processing, genuine substantive disagreement). This is an LLM classification task with structured output, run against the raw text of the employee's message plus their recent interaction history.

Output is structured: primary dimension, confidence, likely drivers, suggested leadership response path. Surfaced transparently to leadership. The classification is not used to generate covert persuasion; it is used to help leadership understand what's actually being said and to help the agent respond in a way that addresses the actual thing rather than only the surface content.

Response quality and cost

Rough load estimate for an MLP pilot with six companies at ~50 affected employees per rollout:

- Planning wizard: ~5 interactions per rollout × several rollouts per pilot per month. Low volume, reasonable per-interaction token count. Cheap.
- Agent text check-ins: ~50 employees × daily tapering to weekly = roughly 300 interactions per rollout per company. Six companies running one rollout each per month = ~1,800 agent interactions monthly. Each interaction is short (30–60 seconds equivalent of text). Manageable at standard LLM rates.
- Agent voice interactions: ~50 kickoff calls per rollout at 5 minutes each = ~250 minutes per company per rollout. At the [Recall.ai](http://Recall.ai) + Realtime API Mini cost basis, this is where the meaningful infrastructure spend lives.
- RAG queries: user-driven, hard to estimate, but low per-query cost.

Total AI infrastructure cost for the pilot set is estimable at $1,500–3,000/month depending on actual usage patterns and voice re-engagement rates. This is pilot economics, not productized-pricing economics.

Data Storage and Privacy

Three categories of data with different handling:

- **Org chart data:** straightforward employee records. Standard encryption at rest and in transit. SOC 2 type stuff; pilot customers will ask.
- **Change plans and leadership-visible data:** adoption rates, team-level signals, individual off-track flags, surfaced concerns, response tracking. Visible to leadership by design. Per-employee change status, not baseline survey.
- **Employee survey data and interaction history:** private to the agent-employee relationship. Never surfaced to leadership as individual data. Used by the agent for personalization and to inform the characterizations surfaced in aggregate. Accessible to the employee on request.

This last category is the load-bearing trust boundary. We need it to be technically enforced, not just policy enforced — survey data lives in a database partition the leadership dashboard cannot query. If we cut corners here and leadership can "accidentally" see individual survey data, the product loses its structural integrity and the sensemaking-partner positioning collapses.

Suggested Build Sequence

Not a sprint plan — just a sensible order to avoid blocking dependencies.

- Web app skeleton with auth, org chart upload, and the change-plan object data model. Nothing else works without this.
- Planning wizard — can be built against a single platform integration (pick Zoom first given maturity advantage, or whichever platform the first-confirmed pilot uses).
- Employee onboarding flow — agent introduction message, link to baseline survey, survey completion flow in web app.
- Agent text check-in loop — proactive messaging, structured data capture, three-dimensional response sampling. This is the heart of the execution layer.
- Voice kickoff call integration — [Recall.ai](http://Recall.ai) plus Realtime API. Can be cut to text-only for first demo if time is tight.
- Reactive Q&A with RAG over training docs.
- Leadership dashboard — aggregation, per-team/per-person views, surfaced concerns, response tracking.
- Response loop — leadership responds in dashboard, agent carries response back to employee.
- Manager view — derivative of the leadership dashboard with scoped data.
- Second platform integration — whichever of Teams/Zoom came second in step 2.

For the 2–3 week MLP: steps 1–4 and 7–8 are non-negotiable. Step 5 (voice) can start as text-only and add voice in week 2–3. Step 6 (RAG Q&A) can be simpler than full retrieval initially (static FAQ from the docs). Step 9 (manager view) can be deferred to immediately post-launch. Step 10 (second platform) depends entirely on which pilots are using which platform.

Open Technical Questions to Resolve Before Build Starts

- Which platform (Teams or Zoom) is each pilot company on? This determines build order.
- What's the specific per-pilot deployment pattern? One Grasp instance per pilot company, or one instance multi-tenanted across pilots? Multi-tenant is cleaner ops but has more startup complexity.
- What's our data hosting story for pilots that will ask? SOC 2 is probably not required for pilot customers but is a real question for the first post-pilot customer.
- Voice cost sensitivity: do we cap voice usage per employee per rollout, or let it happen as needed? Affects margin predictability.
- How do we handle the first pilot integration hiccup ([Recall.ai](http://Recall.ai) bot not joining, Teams permission denied, survey not completing)? We need a support-escalation pattern because these will happen and "Eliot manually debugs" doesn't scale past pilot 1.

