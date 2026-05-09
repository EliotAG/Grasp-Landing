import Link from "next/link";

export const metadata = { title: "Privacy Policy" };

const EFFECTIVE = "April 21, 2026";

export default function PrivacyPage() {
  return (
    <article className="legal-prose">
      <div className="eyebrow">Legal</div>
      <h1>Privacy Policy</h1>
      <p className="meta">Effective {EFFECTIVE}</p>

      <p>
        This Privacy Policy describes how <strong>Grasp Co</strong>{" "}
        (&ldquo;Grasp,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;) collects, uses, and shares information when you
        use the Grasp platform and related services (the{" "}
        <strong>&ldquo;Service&rdquo;</strong>). It also describes your
        choices. Capitalized terms not defined here have the meaning given in
        our <Link href="/terms">Terms of Service</Link>.
      </p>

      <h2>A note on our business model</h2>
      <p>
        Grasp is a business-to-business product. Our customer is your
        organization, and your administrators decide which data to upload and
        which employees the Grasp agent talks to. We do not sell personal
        information, we do not use Customer Data to train shared or
        third-party foundation models, and we do not show ads.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Account information</h3>
      <p>
        When you or a teammate create an account, we collect your name, work
        email address, and, if you sign in with Google, your Google profile
        identifier and avatar URL.
      </p>

      <h3>Organization data</h3>
      <p>
        When an administrator uploads an organization chart, we receive
        employee names, work email addresses, titles, manager relationships,
        and any additional fields in the upload. We process this data on
        behalf of your organization as described in our{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>

      <h3>Change plans and agent conversations</h3>
      <p>
        We store the change plans your administrators create and the
        messages, survey responses, and outcomes generated as the agent
        communicates with employees across channels you have connected.
      </p>

      <h3>Technical information</h3>
      <p>
        Like most web applications, we automatically log IP address,
        approximate location derived from IP, user-agent, timestamps, and
        product events (for example, &ldquo;change plan created&rdquo;). We
        use a small number of strictly necessary cookies and session tokens
        to keep you signed in.
      </p>

      <h2>2. How we use information</h2>
      <ul>
        <li>
          <strong>Operate the Service.</strong> Authenticating you,
          generating change plans, sending messages to employees through
          channels you have authorized, and producing administrator reports.
        </li>
        <li>
          <strong>Improve the Service.</strong> Debugging, monitoring, and
          measuring product performance. We use aggregated or de-identified
          metrics only.
        </li>
        <li>
          <strong>Communicate with you.</strong> Service announcements,
          security notices, and, if you opt in, product updates. You can opt
          out of marketing messages at any time.
        </li>
        <li>
          <strong>Comply with law.</strong> Responding to lawful requests and
          enforcing our Terms of Service.
        </li>
      </ul>

      <h2>3. Employee confidentiality</h2>
      <p>
        When an individual employee answers the baseline survey or
        corresponds with the Grasp agent, the free-text content of that
        exchange is treated as confidential between that employee and the
        agent. Administrators see aggregated sentiment, rollout readiness,
        and risks &mdash; not individual verbatim responses, unless the
        employee explicitly asks the agent to escalate a specific concern to
        a named person.
      </p>

      <h2>4. How we share information</h2>
      <p>
        We share information only in the limited ways described below.
      </p>
      <ul>
        <li>
          <strong>With your organization.</strong> Your administrators can
          access account and usage data for your workspace, subject to the
          confidentiality rules above.
        </li>
        <li>
          <strong>With service providers (sub-processors).</strong> We use a
          small number of vendors to run the Service, including cloud
          hosting, database hosting, authentication, email delivery, error
          monitoring, and AI model providers. A current list is available on
          request at{" "}
          <a href="mailto:privacy@withgrasp.com">privacy@withgrasp.com</a>.
        </li>
        <li>
          <strong>With channels you connect.</strong> Slack, Microsoft Teams,
          Google Workspace, and similar integrations receive only the data
          needed to deliver messages you have asked the agent to send.
        </li>
        <li>
          <strong>For legal reasons.</strong> If required by law, subpoena,
          or to protect the rights, property, or safety of Grasp, our
          customers, or the public.
        </li>
        <li>
          <strong>Business transfers.</strong> If Grasp Co is involved in a
          merger, acquisition, financing, or sale of assets, information may
          be transferred as part of that transaction, subject to this
          Privacy Policy.
        </li>
      </ul>

      <h2>5. Data retention</h2>
      <p>
        We retain Customer Data for as long as your organization uses the
        Service, plus up to sixty (60) days after termination for backup
        cycles to complete, unless a longer retention period is required by
        law or you request earlier deletion. Account and authentication logs
        are retained for up to twelve (12) months for security purposes.
      </p>

      <h2>6. Security</h2>
      <p>
        We encrypt data in transit with TLS and at rest using industry
        standard encryption provided by our cloud and database vendors.
        Access to production systems is limited to employees who need it to
        operate the Service, and is protected by single sign-on and
        hardware-backed second factors. No system is perfectly secure, and
        we will notify affected customers without undue delay if we become
        aware of a breach that affects Customer Data.
      </p>

      <h2>7. International transfers</h2>
      <p>
        Grasp Co is headquartered in the United States and our primary
        infrastructure is located in the United States. If you access the
        Service from outside the United States, you understand that your
        information will be transferred to and processed in the United
        States.
      </p>

      <h2>8. Your choices and rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct,
        delete, or export your personal information, and to object to or
        restrict certain processing. To exercise these rights, email{" "}
        <a href="mailto:privacy@withgrasp.com">privacy@withgrasp.com</a>. If
        you are an employee of a Grasp customer, we will generally forward
        your request to your administrator, who acts as the controller of
        your data, and support them in responding.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is designed for workplace use and is not directed to
        children under 16. We do not knowingly collect personal information
        from children. If you believe a child has provided us with personal
        information, please contact us and we will delete it.
      </p>

      <h2>10. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. If we make
        material changes, we will provide reasonable notice (such as via
        email or in-product notice) before they take effect and update the
        &ldquo;Effective&rdquo; date above.
      </p>

      <h2>11. Contact</h2>
      <p>
        Privacy questions? Email{" "}
        <a href="mailto:privacy@withgrasp.com">privacy@withgrasp.com</a>,
        write us at Grasp Co, 1007 N Orange St, 4th Floor, Wilmington, DE
        19801, or text us at{" "}
        <a href="sms:8325707361">(832) 570-7361</a>.
      </p>

      <div className="legal-footer">
        Grasp Co &middot; <Link href="/privacy">Privacy Policy</Link>{" "}
        &middot; <Link href="/terms">Terms of Service</Link>
      </div>
    </article>
  );
}
