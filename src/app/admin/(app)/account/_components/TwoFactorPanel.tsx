"use client";

import { useState, useTransition } from "react";
import {
  ActionMessage,
  Button,
  ConfirmDialog,
  InlineAlert,
  StatusPill,
  TextInput,
  toast,
} from "@/components/admin/ui";
import { CopyField, PendingButton, copyText, useKeepForm } from "../../_system/client";
import { confirmTotpAction, disableTotpAction, startTotpAction } from "../actions";

type Enrollment = { secret: string; uri: string };

/**
 * TOTP set-up and removal. The panel keeps the recovery codes in its own state so they stay on
 * screen after the page re-renders with 2FA enabled; they are shown only this one time.
 */
export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [starting, start] = useTransition();

  if (codes) return <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;

  if (enabled) {
    return (
      <div className="grid gap-3">
        <p className="flex items-center gap-2 text-[13.5px]">
          <StatusPill tone="ok">On</StatusPill> Sign-in asks for a code from your authenticator app.
        </p>
        <p className="text-xs text-muted">Lost your phone? Use one of your recovery codes to sign in, then set up 2FA again.</p>
        <div>
          <ConfirmDialog
            trigger="Turn off 2FA"
            title="Turn off two-factor authentication?"
            description="Your account will be protected by your password only. Your recovery codes stop working."
            confirmLabel="Turn off"
            action={disableTotpAction}
          >
            <TextInput label="Current password" name="password" type="password" autoComplete="current-password" required />
          </ConfirmDialog>
        </div>
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div className="grid gap-3">
        <p className="flex items-center gap-2 text-[13.5px]">
          <StatusPill tone="mute">Off</StatusPill> Add a second step to sign-in with an authenticator app (1Password, Google Authenticator, Aegis…).
        </p>
        <div>
          <Button
            variant="primary"
            disabled={starting}
            onClick={() =>
              start(async () => {
                const res = await startTotpAction();
                if (res.ok && res.data) setEnrollment(res.data);
                else toast.crit(res.message ?? "Could not start the set-up.");
              })
            }
          >
            {starting ? "Starting…" : "Set up 2FA"}
          </Button>
        </div>
      </div>
    );
  }

  return <EnrollForm enrollment={enrollment} onCancel={() => setEnrollment(null)} onDone={(c) => { setEnrollment(null); setCodes(c); }} />;
}

function groupSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

function EnrollForm({ enrollment, onCancel, onDone }: { enrollment: Enrollment; onCancel: () => void; onDone: (codes: string[]) => void }) {
  const { state, pending, error, onSubmit } = useKeepForm(confirmTotpAction, {
    onSuccess: (s) => {
      if (s.ok && s.data) onDone(s.data.recoveryCodes);
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <ActionMessage state={state} showSuccess={false} />
      <input type="hidden" name="secret" value={enrollment.secret} />
      <ol className="grid list-decimal gap-4 pl-5 text-[13.5px] marker:text-muted">
        <li className="grid gap-2">
          <span>
            In your authenticator app, add an account and choose <b className="font-medium">enter a setup key</b>. Type or paste this key
            (time-based):
          </span>
          <CopyField label="Setup key" value={groupSecret(enrollment.secret)} copiedMessage="Setup key copied." />
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Use a setup link instead</summary>
            <p className="mt-1.5">Some apps and password managers accept this otpauth link directly. A QR code is not shown on this screen.</p>
            <div className="mt-1.5">
              <CopyField label="otpauth link" value={enrollment.uri} copiedMessage="Setup link copied." />
            </div>
          </details>
        </li>
        <li className="grid gap-2">
          <span>Enter the 6-digit code the app shows now.</span>
          <div className="max-w-48">
            <TextInput
              label="Code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              required
              inputClassName="font-mono tracking-[0.2em]"
              error={error("code")}
            />
          </div>
        </li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <PendingButton pending={pending} pendingLabel="Checking…">
          Turn on 2FA
        </PendingButton>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="grid gap-3">
      <InlineAlert tone="warn" live="status" title="Save your recovery codes now">
        Each code signs you in once if you lose your phone. They are shown only this one time. Store them in a password manager or print them.
      </InlineAlert>
      <ul className="grid grid-cols-2 gap-1.5 rounded-control border border-line bg-panel-2 p-3 font-mono text-[13px] sm:grid-cols-2" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => copyText(text, "Recovery codes copied.")}>Copy all codes</Button>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.currentTarget.checked)} className="size-3.5 accent-accent" />
          I have saved my recovery codes
        </label>
        <Button variant="primary" disabled={!saved} onClick={onDone} className="ml-auto">
          Done
        </Button>
      </div>
    </div>
  );
}
