import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ScrollText, Mail } from 'lucide-react';

const TermsOfService = () => {
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
            <ScrollText className="h-6 w-6 text-primary" />
            <span className="font-heading font-semibold text-text-primary">Terms of Service</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-12">
          <h1 className="font-heading text-4xl sm:text-5xl tracking-tighter font-semibold text-text-primary mb-3">
            Terms of Service
          </h1>
          <p className="text-text-secondary">Last updated: February 2026</p>
        </div>

        <div className="space-y-8">
          <section>
            <p className="text-text-secondary leading-relaxed">
              These Terms of Service (&quot;Terms&quot;) govern your access to and use of the Cravitoo platform, including the web application at cravitoo.com, the Cravitoo customer mobile app, and the Cravitoo Partner mobile app (collectively, &quot;Service&quot;), operated by Cravitoo Foods Private Limited (&quot;Cravitoo&quot;, &quot;we&quot;, &quot;us&quot;). By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">1. Eligibility &amp; Accounts</h2>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li>You must be at least 18 years old and competent to contract under the Indian Contract Act, 1872.</li>
              <li>You must be an employee of a corporate organisation onboarded by Cravitoo, or a vendor/admin user invited by Cravitoo.</li>
              <li>You are responsible for keeping your login credentials confidential. Notify us immediately of any unauthorised use.</li>
              <li>Each account is personal and non-transferable. Sharing accounts is grounds for suspension.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">2. Orders &amp; Payments</h2>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li>Prices are inclusive of applicable GST unless stated otherwise. The price shown at checkout is final.</li>
              <li>Payments are processed by Razorpay, an RBI-licensed payment aggregator. Cravitoo does not store full card or UPI details.</li>
              <li>Order confirmation is sent via push notification, email, and in-app alert. Until confirmed, no contract is formed.</li>
              <li>You may cancel an order within <strong>5 minutes</strong> of placement provided the vendor has not started preparing it. Cancellation results in an automatic refund to the original payment method within 5–7 business days.</li>
              <li>After 5 minutes, cancellation is at the vendor&apos;s discretion. If the vendor cannot fulfil (e.g., out of stock, kitchen closed), a full refund is issued automatically.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">3. Pickup &amp; QR Code</h2>
            <p className="text-text-secondary leading-relaxed">
              Orders are pickup-only and must be collected from the designated counter at your registered work site within the meal period. Present the unique pickup QR code (in the app, on the Order Detail screen) at the vendor counter. Lost or unscanned QRs cannot be re-issued — please retain the order in your phone until pickup. Orders not picked up within 30 minutes of being marked &quot;Ready&quot; may be discarded by the vendor without refund (food safety).
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">4. Loyalty Points</h2>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li>You earn loyalty points on completed orders. Points have no monetary value, cannot be transferred, sold, or converted to cash.</li>
              <li>Points may be redeemed at checkout subject to a minimum redemption (currently 100 points = ₹100 off). Cravitoo may change conversion rates with 14 days&apos; notice.</li>
              <li>Points expire 12 months from the date they are credited.</li>
              <li>Cravitoo reserves the right to revoke fraudulently earned points and to terminate the loyalty programme with 30 days&apos; notice.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">5. Vendor Responsibilities</h2>
            <p className="text-text-secondary leading-relaxed mb-3">
              Vendor partners agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li>Maintain valid FSSAI, GST, and Shop &amp; Establishment registrations throughout the partnership.</li>
              <li>Honour all confirmed orders within the agreed meal period. Repeated cancellations may lead to suspension.</li>
              <li>Comply with food-safety standards and Cravitoo&apos;s quality guidelines.</li>
              <li>Use the Partner app solely for legitimate order fulfilment. Menu items and pricing are centrally managed by Cravitoo; vendors may only toggle daily availability.</li>
              <li>Settle commission and platform fees as per the signed commercial agreement.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">6. Prohibited Conduct</h2>
            <p className="text-text-secondary leading-relaxed mb-3">You agree not to:</p>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li>Use the Service for any unlawful purpose or in violation of any law.</li>
              <li>Attempt to reverse-engineer, decompile, or bypass any security feature.</li>
              <li>Submit false orders, fraudulent payments, or fake reviews.</li>
              <li>Use bots, scrapers, or automated tools without prior written consent.</li>
              <li>Impersonate any other person or entity.</li>
              <li>Upload malicious code or content that infringes intellectual-property rights.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">7. Intellectual Property</h2>
            <p className="text-text-secondary leading-relaxed">
              The Cravitoo name, logo, app design, source code, content, and trademarks are the property of Cravitoo Foods Private Limited and are protected under Indian and international intellectual-property laws. You are granted a limited, non-exclusive, non-transferable, revocable licence to use the Service for personal/internal business purposes only. Any other use requires prior written consent.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">8. Disclaimers</h2>
            <ul className="list-disc pl-6 space-y-2 text-text-secondary">
              <li>The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We do not guarantee uninterrupted access.</li>
              <li>Cravitoo is a technology platform connecting employees with vendors. The vendor — not Cravitoo — is the seller and is responsible for food quality, hygiene, and allergens.</li>
              <li>While we strive for accurate menu information (including ingredients, dietary tags, and calorie counts), the vendor is the source of truth. If you have severe allergies, confirm with the vendor directly before consuming.</li>
              <li>AI-powered recommendations are advisory; Cravitoo does not guarantee their accuracy.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">9. Limitation of Liability</h2>
            <p className="text-text-secondary leading-relaxed">
              To the maximum extent permitted by Indian law, Cravitoo&apos;s total aggregate liability arising out of or relating to these Terms or the Service shall not exceed the total amount you paid to Cravitoo in the 3 months preceding the event giving rise to the claim, or ₹10,000, whichever is greater. Cravitoo shall not be liable for any indirect, incidental, special, consequential, or punitive damages.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">10. Indemnification</h2>
            <p className="text-text-secondary leading-relaxed">
              You agree to indemnify and hold harmless Cravitoo, its officers, directors, employees, and agents from any claims, damages, losses, or expenses (including reasonable legal fees) arising out of your breach of these Terms, your misuse of the Service, or your violation of any law or rights of a third party.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">11. Termination</h2>
            <p className="text-text-secondary leading-relaxed">
              We may suspend or terminate your account at any time for breach of these Terms, suspicious activity, or non-payment. You may delete your account at any time via{' '}
              <Link to="/settings/data" className="text-primary font-semibold hover:underline">Settings → Data &amp; Privacy</Link>. Upon termination, your access to the Service ceases immediately; however, provisions of these Terms that by their nature should survive (Sections 7–13) will continue to apply.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">12. Governing Law &amp; Dispute Resolution</h2>
            <p className="text-text-secondary leading-relaxed">
              These Terms are governed by the laws of India. Any dispute shall first be attempted to be resolved through good-faith negotiation. Failing that, disputes shall be subject to the exclusive jurisdiction of the courts of Bengaluru, Karnataka. Nothing in these Terms prevents you from approaching consumer-protection authorities under the Consumer Protection Act, 2019.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-2xl font-semibold text-text-primary mb-4">13. Changes to These Terms</h2>
            <p className="text-text-secondary leading-relaxed">
              We may update these Terms occasionally. Material changes will be notified via email and in-app banner at least 14 days before they take effect. Your continued use of the Service after that date constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section className="bg-primary-light border border-primary/20 rounded-2xl p-6">
            <h2 className="font-heading text-xl font-semibold text-text-primary mb-3 flex items-center space-x-2">
              <Mail className="h-5 w-5 text-primary" />
              <span>Contact</span>
            </h2>
            <div className="text-text-secondary space-y-1">
              <p><strong className="text-text-primary">Cravitoo Foods Private Limited</strong></p>
              <p>Support: <a href="mailto:support@cravitoo.com" className="text-primary font-semibold hover:underline">support@cravitoo.com</a></p>
              <p>Legal &amp; Compliance: <a href="mailto:legal@cravitoo.com" className="text-primary font-semibold hover:underline">legal@cravitoo.com</a></p>
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

export default TermsOfService;
