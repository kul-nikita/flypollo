import { useRef, useState } from "react";
import { updateParticipant } from "../lib/participant";
import { configured } from "../firebase";
import { useToast } from "../components/Toasts";

export default function Profile({ profile, onBack, onSaved }) {
  const [form, setForm] = useState({
    name: profile.name || "",
    email: profile.email || "",
    institution: profile.institution || "",
    designation: profile.designation || "",
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
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
        throw new Error("Please fill in every field.");
      }
      const updated = await updateParticipant({ ...profile, ...form });
      showToast("Profile saved.", "success", 2500);
      onSaved(updated);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
      setBusy(false);
      busyRef.current = false;
    }
  }

  const firstName = (form.name || "").split(" ")[0] || "there";

  return (
    <section className="pdash">
      <header className="pdash-head">
        <div>
          <p className="pdash-eyebrow">Participant profile</p>
          <h1 className="pdash-welcome">Your details, {firstName}</h1>
          <p className="pdash-sub">
            Update your name, institution or designation anytime.
          </p>
        </div>
        <div className="pdash-head-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onBack}
            disabled={busy}
          >
            Back to dashboard
          </button>
        </div>
      </header>

      <div className="pdash-grid">
        <div className="pdash-main">
          <div className="pdash-card">
            <h2 className="pdash-card-title">Edit profile</h2>
            <form className="form" onSubmit={handleSubmit}>
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
                  disabled
                />
                <span className="field-hint">
                  Email is your login — to change it, register with the new
                  email.
                </span>
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
              <div className="profile-form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  {busy ? "Saving…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onBack}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
