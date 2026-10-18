import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { LoginScreen } from "@/web/routes/login";
import {
  ApiClientError,
  apiRequest,
  clearDevelopmentIdentity,
  DEVELOPMENT_IDENTITIES,
  getDevelopmentIdentity,
  setCsrfToken,
  setDevelopmentIdentity,
} from "@/web/lib/api";
import type { MeResponse } from "@/web/types";

const MeContext = createContext<MeResponse | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => apiRequest<MeResponse>("/me"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) =>
      !(error instanceof ApiClientError && error.status === 401) && failureCount < 1,
  });

  useEffect(() => {
    if (me.data) setCsrfToken(me.data.csrf_token);
  }, [me.data]);

  useEffect(() => {
    const channel = new BroadcastChannel("hourlark-timer");
    channel.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ["timer"] });
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    };
    return () => channel.close();
  }, [queryClient]);

  if (me.isLoading) {
    return (
      <div className="bg-surface flex min-h-screen items-center justify-center">
        <div className="text-center">
          <img
            src="/brand/hourlark-original/logo-dark.png"
            alt="Hourlark"
            width={144}
            height={138}
            className="mx-auto mb-5 h-auto w-36"
          />
          <p className="text-fg text-sm font-medium">Loading Hourlark…</p>
        </div>
      </div>
    );
  }
  if (
    me.error instanceof ApiClientError &&
    (me.error.code === "session_missing" || me.error.code === "session_invalid")
  ) {
    return <LoginScreen />;
  }
  if (me.error || !me.data) {
    const message = me.error instanceof Error ? me.error.message : "Unable to load your workspace.";
    const developmentIdentity = getDevelopmentIdentity();
    return (
      <div className="app-shell bg-surface flex min-h-screen items-center justify-center p-6">
        <div className="panel w-full max-w-lg p-8 text-center">
          <img
            src="/brand/hourlark-original/logo-dark.png"
            alt="Hourlark"
            width={144}
            height={138}
            className="mx-auto mb-5 h-auto w-36"
          />
          <h1 className="font-display text-fg text-xl font-bold">Unable to open Hourlark</h1>
          <p className="text-fg-muted mt-2 text-sm">{message}</p>
          <div className="mt-5 flex justify-center">
            <button
              className="bg-accent text-fg-inverted hover:bg-accent-hover h-9 rounded-lg px-4 text-sm font-semibold"
              onClick={() => void me.refetch()}
            >
              Try again
            </button>
          </div>

          {import.meta.env.DEV ? (
            <section className="border-stroke mt-6 border-t pt-5 text-left">
              <h2 className="text-fg text-sm font-semibold">Development account recovery</h2>
              <p className="text-fg-subtle mt-1 text-xs leading-5">
                {developmentIdentity
                  ? `This browser is currently using ${developmentIdentity}.`
                  : "This browser is using the configured default development identity."}{" "}
                Choose another seeded account or return to the configured default.
              </p>
              <button
                type="button"
                className="bg-accent text-fg-inverted hover:bg-accent-hover mt-3 h-9 w-full rounded-lg px-3 text-sm font-semibold"
                onClick={clearDevelopmentIdentity}
              >
                Use default development account
              </button>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {DEVELOPMENT_IDENTITIES.map(({ email, label }) => (
                  <button
                    type="button"
                    key={email}
                    className="border-stroke hover:bg-surface-hover rounded-lg border px-2 py-2 text-left disabled:cursor-default disabled:opacity-50"
                    disabled={email === developmentIdentity}
                    onClick={() => setDevelopmentIdentity(email)}
                  >
                    <span className="text-fg block text-xs font-semibold">{label}</span>
                    <span className="text-fg-subtle mt-0.5 block truncate text-[10px]">
                      {email}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>;
}

export function useMe(): MeResponse {
  const value = useContext(MeContext);
  if (!value) throw new Error("useMe must be used inside MeProvider");
  return value;
}
