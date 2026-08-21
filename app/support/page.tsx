import Link from "next/link";
import "../legal.css";
export const metadata = { title: "Support · Twofold" };
export default function Support() {
  return (
    <div className="legalPage">
      <main>
        <nav>
          <b>Twofold</b>
          <Link href="/">Return to app</Link>
        </nav>
        <h1>Support and data requests</h1>
        <h2>Account access</h2>
        <p>
          Use “Forgot password?” on the sign-in screen if you cannot access your
          account. Email and password changes are available in Profile → Account
          Security.
        </p>
        <h2>Delete your data</h2>
        <p>
          Open Profile → Account Security → Delete my account and data. After
          entering the confirmation phrase, your profile, linked couple space,
          custom questions, scores, and history are permanently deleted.
        </p>
        <h2>Report a technical problem</h2>
        <p>
          Include the page you were using, what you expected, what happened,
          your device/browser, and a screenshot that does not expose passwords,
          private codes, or personal answers.
        </p>
        <p>
          <a
            href="https://github.com/terrietanathoms43-dev/twofold-game-night/issues/new"
            target="_blank"
            rel="noreferrer"
          >
            Open a Twofold support report on GitHub
          </a>
        </p>
        <h2>Safety</h2>
        <p>
          Never share your password. Treat couple and room codes as private. If
          someone obtained a code unexpectedly, cancel the active room and
          create a new one.
        </p>
        <footer>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </footer>
      </main>
    </div>
  );
}
