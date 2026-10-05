import { useSearchParams } from "react-router";

const loginErrors: Record<string, string> = {
  member_not_provisioned:
    "This Google account is not a member of the workspace. Ask an admin to add your email.",
  access_subject_mismatch: "This email is already linked to a different sign-in.",
  access_binding_conflict: "Sign-in could not be linked to your member account. Try again.",
  access_email_mismatch: "This Google account does not match the linked member.",
  google_email_unverified: "Google has not verified this email address.",
  oauth_state_invalid: "That sign-in attempt expired. Continue with Google again.",
  google_not_configured: "Google sign-in is not configured for this workspace yet.",
  google_signin_disabled: "Google sign-in is not enabled.",
  oauth_cancelled: "Google sign-in was cancelled.",
  google_signin_failed: "Google sign-in did not complete. Try again.",
  member_inactive: "This member account is not active.",
  member_binding_failed: "The member account could not be loaded. Try again.",
};

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function LoginScreen() {
  const [params] = useSearchParams();
  const errorCode = params.get("error");
  const error = errorCode ? (loginErrors[errorCode] ?? loginErrors.google_signin_failed) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 py-10">
      <section className="w-full max-w-[420px] rounded-xl border border-[#3b3b3b] bg-[#1c1c1c] px-8 py-10 shadow-[0_24px_80px_rgb(0_0_0/45%)]">
        <div className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#f59e0b] text-lg font-black text-[#18181b]">
            H
          </span>
          <h1 className="mt-4 text-[28px] font-bold tracking-tight text-[#fafafa]">Hourlark</h1>
          <p className="mt-1 text-sm text-[#a4a4a4]">Log in and get tracking</p>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-[#7f1d1d] bg-[#3f1d1d] px-3 py-2 text-sm text-[#fecaca]"
          >
            {error}
          </p>
        ) : null}

        <a
          href="/api/v1/auth/google"
          className="mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[#3b3b3b] bg-white text-sm font-semibold text-[#1f1f1f] hover:bg-[#f4f4f5]"
        >
          <GoogleMark />
          Continue with Google
        </a>

        <p className="mt-5 text-center text-xs leading-5 text-[#a4a4a4]">
          Use the Google account for your workspace email. An admin must add that email before the
          first sign-in.
        </p>
      </section>
    </main>
  );
}
