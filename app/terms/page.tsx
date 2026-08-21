import Link from "next/link";
import "../legal.css";
export const metadata = { title: "Terms of Use · Twofold" };
export default function Terms() {
  return (
    <div className="legalPage">
      <main>
        <nav>
          <b>Twofold</b>
          <Link href="/">Return to app</Link>
        </nav>
        <p className="effective">Effective August 21, 2026</p>
        <h1>Terms of use</h1>
        <p>
          By creating or using a Twofold account, you agree to use the service
          responsibly and only with a partner who has chosen to participate.
        </p>
        <h2>Accounts</h2>
        <p>
          Provide accurate account information, protect your password and
          private codes, and do not access another person’s account. You are
          responsible for activity performed through your account.
        </p>
        <h2>Acceptable use</h2>
        <p>
          Do not use Twofold to threaten, harass, impersonate, exploit,
          distribute unlawful material, interfere with the service, or attempt
          to access another couple’s private data.
        </p>
        <h2>User content</h2>
        <p>
          You retain responsibility for custom questions and answers you submit.
          Only add content you have permission to use. Twofold may remove
          content or restrict accounts when required for safety, security, or
          legal compliance.
        </p>
        <h2>Availability</h2>
        <p>
          The service is provided as available. Features may change, and
          temporary interruptions can occur. Twofold does not guarantee
          uninterrupted operation or preservation of data in every circumstance.
        </p>
        <h2>Game results</h2>
        <p>
          Scores and winners are for entertainment. Automated scoring may not
          interpret every creative or personal answer perfectly; player
          confirmation is used in games that require judgment.
        </p>
        <h2>Ending use</h2>
        <p>
          You may stop using the service and delete your account at any time.
          Access may be restricted for serious abuse or security threats.
        </p>
        <footer>
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
        </footer>
      </main>
    </div>
  );
}
