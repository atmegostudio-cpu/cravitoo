import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Mail } from 'lucide-react';

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border-light">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2 text-text-secondary hover:text-text-primary transition-colors" data-testid="back-to-home">
            <ArrowLeft className="h-5 w-5" />
            <span>Back to Home</span>
          </Link>
          <div className="flex items-center space-x-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="font-heading font-semibold text-text-primary">Privacy Policy</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-12">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-3">
            Privacy Policy
          </h1>
          <p className="text-text-secondary">Last updated: February 2026</p>
        </div>

        <div className="prose prose-orange max-w-none space-y-8">
          <section>
            <p className="text-text-secondary leading-relaxed">
              Cravitoo Foods Private Limited (&quot;Cravitoo&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the Cravitoo platform — a corporate food-ordering and cafeteria-management ecosystem comprising the cravitoo.com web application, the Cravitoo customer mobile app, and the Cravitoo Partner mobile app (collectively, the &quot;Service&quot;). This Privacy Policy explains what personal data we collect, how we use it, with whom we share it, and the rights you have under India&apos;s Digital Personal Data Protection Act, 2023 (DPDP Act), the EU General Data Protection Regulation (GDPR) (where applicable), and other applicable laws.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">1. Information We Collect</h2>
            <div className="space-y-4 text-text-secondary leading-relaxed">
              <div>
                <h3 className="font-semibold text-text-primary mb-2">1.1 Account Information</h3>
                <p>When you register, we collect your name, email address, phone number, employer/corporate affiliation, work site, role, and a password (which is stored as a one-way bcrypt hash — we cannot retrieve it).</p>
              </div>
              <div>
                <h3 className="font-semibold text-text-primary mb-2">1.2 Order &amp; Payment Information</h3>
                <p>For each order, we collect items ordered, prices, quantity, vendor, delivery type, pickup time, ratings/reviews, and payment status. Card and UPI details are processed by our PCI-DSS-compliant payment partner (Razorpay) and are never stored on Cravitoo servers — we only retain the last 4 digits and a payment reference ID for reconciliation.</p>
              </div>
              <div>
                <h3 className="font-semibold text-text-primary mb-2">1.3 Vendor Onboarding Documents</h3>
                <p>For vendor partners only: GST certificate, PAN card, FSSAI license, Shop &amp; Establishment certificate, bank details (cancelled cheque), and optional MSME/Insurance documents. These are stored encrypted and used solely for compliance verification.</p>
              </div>
              <div>
                <h3 className="font-semibold text-text-primary mb-2">1.4 Device &amp; Usage Data</h3>
                <p>Device identifier, OS version, app version, IP address (for security/fraud prevention), Expo push notification token, and crash logs. Usage analytics include screens viewed, features used, and session duration.</p>
              </div>
              <div>
                <h3 className="font-semibold text-text-primary mb-2">1.5 Camera &amp; Photos (Mobile Only)</h3>
                <p>The Cravitoo Partner app requests camera access to scan customer pickup QR codes. Cravitoo customer app requests camera/photo access only when you choose to upload a profile picture. Camera frames are processed locally on your device and never uploaded.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">2. How We Use Your Data</h2>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li>To provide, operate, and improve the Service — process your orders, generate pickup QR codes, deliver real-time order updates.</li>
              <li>To enable authentication and prevent unauthorised access — brute-force lockout, JWT tokens, secure sessions.</li>
              <li>To process payments via Razorpay and issue refunds.</li>
              <li>To send transactional notifications (order confirmed, ready for pickup, refund processed) via push notifications and in-app alerts.</li>
              <li>To generate AI-powered food recommendations, demand forecasts, and wastage analyses for vendors. These features use the GPT-5.2 model via the Emergent LLM service; only aggregated, non-identifying signals are sent — never your name, email, or phone.</li>
              <li>To comply with legal obligations, including India&apos;s DPDP Act, GST returns, and FSSAI record-keeping requirements.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">3. Where We Store Your Data</h2>
            <p className="text-text-secondary leading-relaxed">
              Personal data of Indian residents is stored on MongoDB Atlas servers located in <strong>Mumbai (ap-south-1, India)</strong>. Encrypted backups are retained for 30 days. Push notification tokens are stored alongside your account record. Uploaded documents (KYC) are stored in encrypted object storage and access-restricted to authenticated Cravitoo administrators on a least-privilege basis.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">4. Who We Share Your Data With</h2>
            <div className="space-y-3 text-text-secondary leading-relaxed">
              <p><strong className="text-text-primary">Vendor partners</strong>: Your name, order items, and pickup QR are shared with the vendor fulfilling your order. They do not see your email, phone, or payment details.</p>
              <p><strong className="text-text-primary">Corporate / Site Admins</strong>: Your aggregated order activity (count, spend, sponsorship eligibility) is visible to your employer&apos;s admins for reporting. Individual order items are not exposed in admin dashboards.</p>
              <p><strong className="text-text-primary">Payment processor (Razorpay)</strong>: Required transaction metadata only.</p>
              <p><strong className="text-text-primary">Cloud / infrastructure providers</strong>: MongoDB Atlas (India region), Expo (push delivery), Resend (transactional email), and Emergent LLM (AI features). All providers are bound by data-processing agreements.</p>
              <p><strong className="text-text-primary">We never sell your personal data</strong> to third parties for advertising or any other purpose.</p>
            </div>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">5. Data Retention</h2>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li><strong>Active accounts</strong>: Retained until you request deletion.</li>
              <li><strong>Inactive accounts</strong>: Anonymised after 24 months of inactivity (orders kept for tax/audit but stripped of personal identifiers).</li>
              <li><strong>Order records</strong>: 7 years (Indian GST &amp; Companies Act requirements).</li>
              <li><strong>Vendor KYC documents</strong>: Duration of partnership + 7 years post-termination.</li>
              <li><strong>Payment records</strong>: 7 years (RBI/PCI-DSS requirements).</li>
              <li><strong>Server access logs</strong>: 90 days.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">6. Your Rights (DPDP Act 2023 &amp; GDPR)</h2>
            <p className="text-text-secondary leading-relaxed mb-4">
              You have the following rights at any time:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li><strong>Right to access</strong>: Download a copy of all personal data we hold about you.</li>
              <li><strong>Right to correction</strong>: Update inaccurate or incomplete data via your Profile screen.</li>
              <li><strong>Right to erasure (&quot;right to be forgotten&quot;)</strong>: Request deletion of your account and personal data. Tax-mandated order records will be anonymised, not deleted.</li>
              <li><strong>Right to grievance redressal</strong>: Contact our Data Protection Officer (below).</li>
              <li><strong>Right to nominate</strong>: Under the DPDP Act, you may nominate a person to exercise your rights in case of death or incapacity. Email us to set this up.</li>
              <li><strong>Right to withdraw consent</strong>: You may withdraw consent for non-essential processing (marketing, recommendations) without affecting account access.</li>
            </ul>
            <p className="text-text-secondary leading-relaxed mt-4">
              To exercise these rights in-app, visit{' '}
              <Link to="/settings/data" className="text-primary font-semibold hover:underline" data-testid="data-settings-link">
                Settings → Data &amp; Privacy
              </Link>{' '}
              after logging in. Requests are processed within 30 days as required by the DPDP Act.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">7. Security</h2>
            <p className="text-text-secondary leading-relaxed">
              We employ industry-standard security measures: TLS 1.3 encryption in transit, encryption at rest, bcrypt password hashing (cost 12), JWT-based session management, brute-force lockout after 5 failed logins, role-based access control, and server-side validation on every endpoint. Despite these measures, no system is 100% secure. In the event of a data breach affecting your personal data, we will notify the Data Protection Board of India and affected users within 72 hours, as required by the DPDP Act.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">8. Children</h2>
            <p className="text-text-secondary leading-relaxed">
              Cravitoo is a B2B service intended for users 18 years and older. We do not knowingly collect data from individuals under 18. If you believe we have inadvertently collected data from a minor, please contact us immediately and we will delete it.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">9. Cookies</h2>
            <p className="text-text-secondary leading-relaxed">
              The web app uses two essential, first-party HttpOnly cookies (<code className="px-1.5 py-0.5 rounded bg-background text-text-primary text-sm">access_token</code>, <code className="px-1.5 py-0.5 rounded bg-background text-text-primary text-sm">refresh_token</code>) for authentication. These are strictly necessary for the Service to function and do not require consent. We do <strong>not</strong> use third-party advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">10. Changes to This Policy</h2>
            <p className="text-text-secondary leading-relaxed">
              We may update this Privacy Policy occasionally. Material changes will be notified by email and via an in-app banner at least 14 days before they take effect. The &quot;Last updated&quot; date at the top of this page always reflects the current version.
            </p>
          </section>

          <section className="bg-primary-light border border-primary/20 rounded-2xl p-6">
            <h2 className="font-heading text-xl font-semibold text-text-primary mb-3 flex items-center space-x-2">
              <Mail className="h-5 w-5 text-primary" />
              <span>Contact / Grievance Redressal</span>
            </h2>
            <div className="text-text-secondary space-y-1">
              <p><strong className="text-text-primary">Data Protection Officer</strong></p>
              <p>Cravitoo Foods Private Limited</p>
              <p>Email: <a href="mailto:privacy@cravitoo.com" className="text-primary font-semibold hover:underline">privacy@cravitoo.com</a></p>
              <p>Grievance Officer (DPDP Act): <a href="mailto:grievance@cravitoo.com" className="text-primary font-semibold hover:underline">grievance@cravitoo.com</a></p>
              <p className="mt-3 text-sm">Response time: Within 30 days as required by the DPDP Act 2023.</p>
            </div>
          </section>
        </div>
      </div>

      <footer className="bg-card border-t border-border-light mt-16">
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-text-secondary">
          <p>© 2026 Cravitoo Foods Private Limited. All rights reserved.</p>
          <div className="flex space-x-6">
            <Link to="/privacy" className="hover:text-primary">Privacy</Link>
            <Link to="/terms" className="hover:text-primary">Terms</Link>
            <a href="mailto:support@cravitoo.com" className="hover:text-primary">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PrivacyPolicy;
