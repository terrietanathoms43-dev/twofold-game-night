import Link from "next/link";
import "../legal.css";
export const metadata = { title: "Privacy Policy · Twofold" };
export default function Privacy() {
  return (
    <div className="legalPage">
      <main>
        <nav>
          <b>Twofold</b>
          <Link href="/">Return to app</Link>
        </nav>
        <p className="effective">Effective August 21, 2026</p>
        <h1>Privacy policy</h1>
        <p>
          Twofold is a private game-night service for two linked accounts. This
          policy explains the information the service stores and how it is used.
        </p>
        <h2>Information stored</h2>
        <ul>
          <li>
            Account email and sign-in provider information managed through
            Supabase Authentication.
          </li>
          <li>
            Your display name, selected avatar, linked couple identifier,
            private invite and room codes.
          </li>
          <li>
            Selected games, answers, custom questions, scores, winners,
            achievements, and game-night history.
          </li>
          <li>
            Basic technical records required for security, error diagnosis, and
            service reliability.
          </li>
        </ul>
        <h2>How information is used</h2>
        <p>
          Information is used only to authenticate accounts, connect two
          partners, synchronize gameplay, calculate results, maintain
          statistics, prevent misuse, and operate the service.
        </p>
        <h2>Private answers</h2>
        <p>
          Answers are restricted to the two members of the linked couple. During
          supported secret-answer games, one partner’s answer remains hidden
          until both answers are locked. No internet service can promise
          absolute security, so avoid entering highly sensitive information.
        </p>
        <h2>Service providers</h2>
        <p>
          Twofold uses Supabase for authentication and database services, Vercel
          for hosting, Google for optional sign-in, and GitHub for application
          source and deployment integration. Their processing is governed by
          their respective policies.
        </p>
        <h2>Retention and deletion</h2>
        <p>
          Game history remains until the account data is deleted. You can
          permanently delete your account and associated couple-space data from
          Profile → Account Security. Deletion cannot be undone.
        </p>
        <h2>Your choices</h2>
        <p>
          You may change your display name, avatar, email, and password, delete
          custom questions, or delete your account from the application.
        </p>
        <h2>Policy changes</h2>
        <p>
          Material updates will be reflected here with a new effective date.
        </p>
        <LegalFooter />
      </main>
    </div>
  );
}
function LegalFooter() {
  return (
    <footer>
      <Link href="/terms">Terms</Link>
      <Link href="/support">Support & data requests</Link>
    </footer>
  );
}
