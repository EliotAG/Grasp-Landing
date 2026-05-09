import Link from "next/link";

export const metadata = { title: "Terms of Service" };

const EFFECTIVE = "April 21, 2026";

export default function TermsPage() {
  return (
    <article className="legal-prose">
      <div className="eyebrow">Legal</div>
      <h1>Terms of Service</h1>
      <p className="meta">Effective {EFFECTIVE}</p>

      <p>
        These Terms of Service (the <strong>&ldquo;Terms&rdquo;</strong>) govern
        your access to and use of the Grasp platform and related services (the{" "}
        <strong>&ldquo;Service&rdquo;</strong>) operated by{" "}
        <strong>Grasp Co</strong> (&ldquo;Grasp,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By creating an account,
        accessing, or using the Service, you agree to be bound by these Terms
        and by our{" "}
        <Link href="/privacy">Privacy Policy</Link>. If you are entering into
        these Terms on behalf of an organization, you represent that you have
        authority to bind that organization.
      </p>

      <h2>1. The Service</h2>
      <p>
        Grasp helps leadership teams plan, communicate, and land internal
        process and technology changes. The Service may include uploading
        organizational data, creating change plans, and coordinating
        agent-driven communication with your employees across channels such as
        email, Slack, and Microsoft Teams.
      </p>

      <h2>2. Early Access &amp; Pilot Program</h2>
      <p>
        The Service is currently offered as an early-access pilot. You
        understand that pilot features may be incomplete, may change
        materially, and may be modified or discontinued at any time with
        reasonable notice. Commercial terms, including fees and service levels,
        are set forth in the order form or written agreement executed between
        you and Grasp Co. Absent a signed order form, pilot access is provided
        free of charge and at our discretion.
      </p>

      <h2>3. Your Account</h2>
      <p>
        You must provide accurate information when creating an account and keep
        your credentials confidential. You are responsible for all activity
        under your account and for ensuring that each person who accesses the
        Service on your behalf complies with these Terms. You must notify us
        promptly at{" "}
        <a href="mailto:security@withgrasp.com">security@withgrasp.com</a> if
        you suspect unauthorized access.
      </p>

      <h2>4. Acceptable Use</h2>
      <p>You agree not to, and not to permit anyone else to:</p>
      <ul>
        <li>
          upload data you do not have the right to share, including personal
          data collected without a lawful basis;
        </li>
        <li>
          use the Service to send unlawful, misleading, discriminatory, or
          harassing communications to employees;
        </li>
        <li>
          reverse engineer, decompile, or attempt to derive the source code or
          underlying models of the Service, except to the extent that
          applicable law prohibits such restriction;
        </li>
        <li>
          probe, scan, or test the vulnerability of the Service, or circumvent
          any authentication or rate-limiting controls; or
        </li>
        <li>
          use the Service to build or train a competing product or service.
        </li>
      </ul>

      <h2>5. Customer Data</h2>
      <p>
        <strong>Customer Data</strong> means any data you or your users submit
        to the Service, including org chart uploads, change plans, and
        employee survey responses. As between you and Grasp, you own Customer
        Data. You grant us a worldwide, non-exclusive, royalty-free license to
        host, process, transmit, and display Customer Data solely as needed to
        provide and improve the Service and to comply with your written
        instructions.
      </p>
      <p>
        We do not use Customer Data to train shared or third-party foundation
        models. Aggregated and de-identified metrics may be used to monitor
        and improve the Service, provided they cannot reasonably be used to
        identify you or any individual.
      </p>

      <h2>6. Employee Confidentiality</h2>
      <p>
        Where an individual employee shares information with the Grasp agent
        (for example, through the baseline survey or a one-to-one
        conversation), that content is treated as confidential between the
        employee and the agent. Grasp will only surface aggregated or
        anonymized views of such content to your administrators, consistent
        with the product specification in effect at the time of collection.
      </p>

      <h2>7. Intellectual Property</h2>
      <p>
        The Service, including all software, models, prompts, documentation,
        and the Grasp brand, is and remains the property of Grasp Co and its
        licensors. Except for the limited right to use the Service granted
        here, no other rights are granted, express or implied.
      </p>
      <p>
        If you provide feedback, suggestions, or feature requests
        (&ldquo;Feedback&rdquo;), you grant us a perpetual, irrevocable,
        royalty-free license to use that Feedback without restriction.
      </p>

      <h2>8. Third-Party Services</h2>
      <p>
        The Service integrates with third-party platforms such as Slack,
        Microsoft Teams, Google Workspace, and email providers. Your use of
        those platforms is governed by their own terms and privacy policies,
        and Grasp is not responsible for their acts or omissions.
      </p>

      <h2>9. Fees</h2>
      <p>
        If a paid plan applies, fees, payment terms, and renewal terms are set
        forth in your order form. Unless your order form states otherwise,
        fees are non-refundable and exclusive of taxes. Late amounts may
        accrue interest at the lesser of 1.0% per month or the maximum rate
        permitted by law.
      </p>

      <h2>10. Confidentiality</h2>
      <p>
        Each party agrees to protect the other&rsquo;s non-public business
        information disclosed in connection with the Service using at least
        the same degree of care it uses to protect its own confidential
        information, and in no event less than a reasonable standard of care.
        This obligation does not apply to information that is public, already
        known, independently developed, or rightfully received from a third
        party without restriction.
      </p>

      <h2>11. Warranty Disclaimer</h2>
      <p>
        EXCEPT AS EXPRESSLY STATED IN A SIGNED AGREEMENT, THE SERVICE IS
        PROVIDED <strong>&ldquo;AS IS&rdquo;</strong> AND{" "}
        <strong>&ldquo;AS AVAILABLE.&rdquo;</strong> GRASP DISCLAIMS ALL
        WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
        WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED OR
        ERROR-FREE, OR THAT AI-GENERATED OUTPUTS WILL BE ACCURATE OR
        APPROPRIATE FOR YOUR SPECIFIC USE.
      </p>

      <h2>12. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER PARTY WILL BE LIABLE
        FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
        DAMAGES, OR FOR LOST PROFITS, REVENUE, OR DATA, ARISING OUT OF OR IN
        CONNECTION WITH THESE TERMS, WHETHER IN CONTRACT, TORT, OR OTHERWISE,
        EVEN IF ADVISED OF THE POSSIBILITY. EACH PARTY&rsquo;S AGGREGATE
        LIABILITY IS LIMITED TO THE GREATER OF (a) THE AMOUNTS YOU PAID TO
        GRASP IN THE TWELVE MONTHS PRECEDING THE EVENT GIVING RISE TO THE
        CLAIM, OR (b) USD $100.
      </p>

      <h2>13. Indemnification</h2>
      <p>
        You will defend and indemnify Grasp against any third-party claim
        arising from (a) Customer Data, (b) your use of the Service in
        violation of these Terms or applicable law, or (c) communications you
        direct the Service to send to your employees or other recipients.
      </p>

      <h2>14. Termination</h2>
      <p>
        Either party may terminate these Terms at any time on written notice
        if the other party materially breaches and fails to cure within thirty
        (30) days. We may suspend the Service immediately if your use poses a
        security or legal risk. On termination, your right to use the Service
        ends and we will delete Customer Data within sixty (60) days, except
        as required to comply with law.
      </p>

      <h2>15. Changes to the Service or Terms</h2>
      <p>
        We may update these Terms from time to time. If we make material
        changes, we will provide reasonable notice (such as via email or
        in-product notice) before they take effect. Your continued use of the
        Service after the effective date constitutes acceptance of the updated
        Terms.
      </p>

      <h2>16. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, without
        regard to its conflicts-of-laws principles. Any dispute will be
        brought exclusively in the state or federal courts located in New
        Castle County, Delaware, and each party consents to personal
        jurisdiction there.
      </p>

      <h2>17. Contact</h2>
      <p>
        Questions about these Terms? Email{" "}
        <a href="mailto:legal@withgrasp.com">legal@withgrasp.com</a> or text
        us at{" "}
        <a href="sms:8325707361">(832) 570-7361</a>.
      </p>

      <div className="legal-footer">
        Grasp Co &middot; <Link href="/privacy">Privacy Policy</Link> &middot;{" "}
        <Link href="/terms">Terms of Service</Link>
      </div>
    </article>
  );
}
