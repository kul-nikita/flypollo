import { useEffect, useState } from "react";
import { isAdminEmail } from "../config/admin";
import {
  findParticipantByEmail,
  loadSavedProfile,
  registerParticipant,
  saveProfile,
} from "../lib/participant";
import { configured } from "../firebase";
import { useToast } from "../components/Toasts";

export default function Entry({ email, onBack, onAdmin, onParticipant }) {
  const [step, setStep] = useState("resolving");
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState({
    name: "",
    email: email || "",
    institution: "",
    designation: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  const normalizedEmail = (email || "").trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      setStep("resolving");
      setError("");
      try {
        if (isAdminEmail(normalizedEmail)) {
          onAdmin(normalizedEmail);
          return;
        }
        const saved = loadSavedProfile();
        if (saved && saved.email.toLowerCase() === normalizedEmail) {
          onParticipant(saved);
          return;
        }
        if (!configured) {
          throw new Error(
            "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
          );
        }
        const profile = await findParticipantByEmail(normalizedEmail);
        if (cancelled) return;
        if (profile) {
          setExisting(profile);
          setForm((current) => ({ ...current, name: profile.name || "" }));
          setStep("confirm");
        } else {
          setForm((current) => ({
            ...current,
            name: "",
            institution: "",
            designation: "",
          }));
          setStep("register");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        showToast(err.message, "error");
        setStep("register");
      }
    }
    resolve();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function confirmReturn() {
    setBusy(true);
    setError("");
    try {
      const entered = form.name.trim().toLowerCase();
      if (!entered) {
        throw new Error("Enter your full name to continue.");
      }
      if (entered !== (existing.name || "").trim().toLowerCase()) {
        throw new Error("That name doesn't match our records. Try again.");
      }
      saveProfile(existing);
      onParticipant(existing);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
      setBusy(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!configured) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      if (!form.name.trim() || !form.institution.trim() || !form.designation.trim()) {
        throw new Error("Please fill in every field to register.");
      }
      const profile = await registerParticipant(form);
      saveProfile(profile);
      onParticipant(profile);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
      setBusy(false);
    }
  }

  if (step === "resolving") {
    return (
      <div className="flow-card">
        <div className="spinner" aria-hidden="true" />
        <p className="flow-title">Checking your details…</p>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="flow-card flow-narrow">
        <h1 className="flow-heading">Welcome back</h1>
        <p className="flow-sub">
          We found a profile for <strong>{normalizedEmail}</strong>. Confirm
          your full name to continue.
        </p>
        <form className="form" onSubmit={(event) => { event.preventDefault(); confirmReturn(); }}>
          <label className="field">
            <span className="field-label">Full name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="e.g. Ada Lovelace"
              autoComplete="name"
              required
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Confirming…" : "Confirm"}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={onBack} disabled={busy}>
            Use a different email
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flow-card flow-narrow">
      <h1 className="flow-heading">Tell us about you</h1>
      <p className="flow-sub">
        Your profile saves your answers, so we can recognize you next time.
      </p>
      <form className="form" onSubmit={handleRegister}>
        <label className="field">
          <span className="field-label">Full name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="e.g. Ada Lovelace"
            autoComplete="name"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            placeholder="e.g. ada@example.org"
            autoComplete="email"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Institution</span>
          <input
            type="text"
            value={form.institution}
            onChange={(event) => updateField("institution", event.target.value)}
            placeholder="e.g. North Ridge Institute"
            required
          />
        </label>
        <label className="field">
          <span className="field-label">Designation</span>
          <input
            type="text"
            value={form.designation}
            onChange={(event) => updateField("designation", event.target.value)}
            placeholder="e.g. Resident, Teacher, Nurse"
            required
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Registering…" : "Register"}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={onBack} disabled={busy}>
          Back
        </button>
      </form>
    </div>
  );
}
