import { useState } from "react";
import { useToast } from "../components/Toasts";

function FeatureIcon({ type }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (type === "participation") {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 22h8M12 16v6" />
        <path d="M9 11l2-2 2 2 2-2" />
      </svg>
    );
  }
  if (type === "real-time") {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M2 12c3-4 6-4 9 0s6 4 9 0" />
        <path d="M2 17c3-4 6-4 9 0s6 4 9 0" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  );
}

export default function Landing({ onEnter }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  function handleSubmit(event) {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      showToast("Please enter a valid email address.", "error");
      return;
    }
    setSubmitting(true);
    onEnter(value);
  }

  return (
    <div className="landing">
      <section className="landing-hero">
        <p className="landing-eyebrow">FlyGamify</p>
        <h1>
          Make learning{" "}
          <span className="hero-accent">interactive.</span>
        </h1>
        <p className="landing-sub">
          Run live questions with your audience and see the results the moment
          they answer. FlyGamify turns any session into a real-time
          conversation.
        </p>
        <form className="entry-form" onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email to get started"
            aria-label="Email address"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck="false"
            required
          />
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={submitting}
          >
            {submitting ? "Opening…" : "Continue"}
          </button>
        </form>
        <p className="landing-note">
          No passwords, no downloads. Your email only helps us remember you.
        </p>
      </section>

      <section className="landing-features">
        <article className="feature-card">
          <span className="feature-icon feature-icon-blue">
            <FeatureIcon type="presentation" />
          </span>
          <h3>Interactive Live Learning</h3>
          <p>
            Ask questions during any session and watch the room participate in
            real time.
          </p>
        </article>
        <article className="feature-card">
          <span className="feature-icon feature-icon-teal">
            <FeatureIcon type="real-time" />
          </span>
          <h3>Real-Time Audience Participation</h3>
          <p>
            Every participant answers from their own device. No raised hands,
            no awkward silence.
          </p>
        </article>
        <article className="feature-card">
          <span className="feature-icon feature-icon-indigo">
            <FeatureIcon type="results" />
          </span>
          <h3>Instant Results</h3>
          <p>
            See answers as they happen and download clean reports the moment
            your session ends.
          </p>
        </article>
      </section>
    </div>
  );
}
