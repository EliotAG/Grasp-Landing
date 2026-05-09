const DWIGHT_EMAIL = "dwight.schrute@dundermifflin.example";
const JIM_EMAIL = "jim.halpert@dundermifflin.example";

const SALES_REPS = new Set([
  "andy.bernard@dundermifflin.example",
  "dwight.schrute@dundermifflin.example",
  "jim.halpert@dundermifflin.example",
  "phyllis.vance@dundermifflin.example",
  "stanley.hudson@dundermifflin.example",
]);

const WAREHOUSE = new Set([
  "darryl.philbin@dundermifflin.example",
  "glenn@dundermifflin.example",
  "hide@dundermifflin.example",
  "lonny.collins@dundermifflin.example",
  "madge.madsen@dundermifflin.example",
]);

const CUSTOMER_SERVICE = new Set(["kelly.kapoor@dundermifflin.example"]);
const ACCOUNTING = new Set([
  "angela.martin@dundermifflin.example",
  "kevin.malone@dundermifflin.example",
  "oscar.martinez@dundermifflin.example",
]);

export function buildDemoFeedbackReply(input: {
  email: string;
  name: string;
  botText: string;
  kind?: "message" | "kickoff" | "system";
}): string | null {
  const email = input.email.toLowerCase();
  if (input.kind === "kickoff") return kickoffReply(email);

  const scripted = scriptedFollowUp(email, input.botText);
  if (scripted) return scripted;

  if (!looksLikeCheckIn(input.botText)) return null;

  if (SALES_REPS.has(email)) {
    return salesReply(email);
  }
  if (WAREHOUSE.has(email)) {
    return "So far it is mostly working. The only thing I noticed is the portal is only as good as what we put in. If tracking numbers are late or ship dates change, we need a clean way to update that fast so customers do not get stale info.";
  }
  if (CUSTOMER_SERVICE.has(email)) {
    return "Honestly this helps. I can point people to the portal for basic order status instead of writing the same answer over and over. I still need a clear escalation path for angry customers, but routine stuff is easier.";
  }
  if (ACCOUNTING.has(email)) {
    return "No major issue from my side. The clearer status trail is helpful because it cuts down on random questions coming to accounting. As long as the source data stays accurate, this is a good change.";
  }

  return "Pretty smooth so far. The portal gives people a place to check the basics without asking around. I have not seen anything that needs leadership attention yet, just the usual adjustment period.";
}

function looksLikeCheckIn(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("three days in") ||
    normalized.includes("day-3") ||
    normalized.includes("day 3") ||
    normalized.includes("one week") ||
    normalized.includes("week into") ||
    normalized.includes("three weeks")
  );
}

function kickoffReply(email: string): string | null {
  if (email === JIM_EMAIL) {
    return "Makes sense. I like the idea of fewer calls about tracking numbers, especially when the answer is already in the system. My only hesitation is that some customers call because they want a person, not because they literally cannot find the tracking email. I can point them to the portal, but I do not want it to sound like I am brushing them off.";
  }
  if (email === DWIGHT_EMAIL) {
    return 'I understand the portal. I do not agree with the way this is being framed. Customer order calls are not just "routine updates." They are customer touches. A customer asks where an order is, I answer quickly, then I can ask what else they need. That is sales. If the website takes that away, I lose touches and miss chances to spot problems early.';
  }
  if (SALES_REPS.has(email)) {
    return "I can see the benefit for routine tracking questions. I want the portal to be clear that the assigned rep still owns the customer relationship and will know when a customer touchpoint needs follow-up.";
  }
  if (WAREHOUSE.has(email)) {
    return "This makes sense as long as the order data is accurate. If customers are going to see the status directly, we need to keep tracking numbers and ship dates current before the end of the shift.";
  }
  if (CUSTOMER_SERVICE.has(email)) {
    return "This helps. I can send customers to one place for routine tracking and ship-date questions, and escalate the unusual or angry ones back to the right rep or manager.";
  }
  return "Understood. Routine order-status questions start in the portal, and exceptions still go to the right person.";
}

function scriptedFollowUp(email: string, botText: string): string | null {
  const text = botText.toLowerCase();
  if (email === JIM_EMAIL) {
    if (
      text.includes("exact sentence") ||
      text.includes("what is the sentence") ||
      text.includes("what would your version")
    ) {
      return "When a customer asks for a routine tracking number or ship-date update, I will send the portal link first and add one sentence that I am still here if something looks wrong or if it is urgent.";
    }
    if (text.includes("one week") || text.includes("three weeks")) {
      return "This is working pretty well. I have been sending the portal link for basic tracking questions, and customers are using it. I still jump in for awkward delays or bigger accounts, but the small status-update emails are down.";
    }
  }

  if (email === DWIGHT_EMAIL) {
    if (
      text.includes("what would need to be true") ||
      text.includes("what would make this workable") ||
      text.includes("sales tool instead of a replacement")
    ) {
      return "Two things. One, customers should see my face and contact info in the portal so they remember I am their rep. Two, I should get a notification when one of my customers has a delayed order, a back-order, or keeps checking status. Otherwise this is not a sales tool. It is a relationship-blind lookup page.";
    }
    if (text.includes("customer example") || text.includes("one example")) {
      return "Blue Cross calls about delayed copy paper. I answer, I fix it, and I ask about their next quarterly order. If they just check a portal, that conversation never happens. That is lost revenue.";
    }
    if (
      text.includes("assigned rep's face") ||
      text.includes("assigned rep's face, name") ||
      text.includes("follow-up moments stay intact") ||
      text.includes("leadership pushed an update")
    ) {
      return "That addresses the main issue. If my face is on the portal and I get notified when one of my customers has a delay or keeps checking status, then I can use it. I will still call major accounts personally when something is delayed, but for normal tracking questions I can send the portal link.";
    }
    if (
      text.includes("what is your exact when-then") ||
      text.includes("exact when-then plan") ||
      text.includes("what will you do")
    ) {
      return "When a customer asks for routine tracking or ship-date information, I will send the portal link and remind them that I am still their rep if there is a problem or if they need to place another order.";
    }
    if (text.includes("one week") || text.includes("three weeks")) {
      return "Usage is up because the portal keeps me visible and flags the moments that still need a rep. I am sending the portal link for routine questions. Customers see me on the page, which is correct, and I still handle important accounts directly. This is acceptable.";
    }
  }

  return null;
}

function salesReply(email: string): string {
  if (email === JIM_EMAIL) {
    return "This is working pretty well. I have been sending the portal link for basic tracking questions, and customers are using it. I still jump in for awkward delays or bigger accounts, but the small status-update emails are down.";
  }
  if (email === DWIGHT_EMAIL) {
    return "Usage is up because the portal keeps me visible and flags the moments that still need a rep. I am sending the portal link for routine questions. Customers see me on the page, which is correct, and I still handle important accounts directly. This is acceptable.";
  }
  if (email === "stanley.hudson@dundermifflin.example") {
    return "It is faster for routine status questions, I will give it that. My concern is that if customers stop calling, I may not hear when they are annoyed, waiting on a delayed order, or thinking about the next purchase.";
  }
  if (email === "phyllis.vance@dundermifflin.example") {
    return "The customers who only need tracking seem fine with the link. I am a little worried about losing the small personal touches though. Sometimes a simple status question turns into a reorder or a chance to fix a relationship before it gets worse.";
  }
  return "I sent the link to a customer and it was easy enough. My hesitation is the same as the other reps: fewer customer touches can mean fewer chances to sell, spot issues early, or know when a customer needs a personal follow-up.";
}
