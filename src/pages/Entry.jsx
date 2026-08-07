import { useEffect, useRef, useState } from "react";
import { isAdminEmail } from "../config/admin";
import {
  findParticipantByEmail,
  loadSavedProfile,
  registerParticipant,
  saveAdminEmail,
  saveProfile,
} from "../lib/participant";
import { configured } from "../firebase";
import { useToast } from "../components/Toasts";

export default function Entry({ email, onBack, onAdmin, onParticipant }) {
  const [step, setStep] = useState("resolving");
  const [form, setForm] = useState({
    name: "",
    email: email || "",
    institution: "",
    designation: "",
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
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
          saveAdminEmail(normalizedEmail);
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
          onParticipant(profile);
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

  async function handleRegister(event) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
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
