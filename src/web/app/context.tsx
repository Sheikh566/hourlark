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
      <div className="flex min-h-screen items-center justify-center bg-[#212121]">
        <div className="text-center">
          <img
            src="/brand/hourlark-original/logo-dark.png"
            alt="Hourlark"
            width={144}
            height={138}
            className="mx-auto mb-5 h-auto w-36"
          />
          <p className="text-sm font-medium text-[#fafafa]">Loading Hourlark…</p>
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
      <div className="app-shell flex min-h-screen items-center justify-center bg-[#212121] p-6">
        <div className="panel w-full max-w-lg p-8 text-center">
          <img
            src="/brand/hourlark-original/logo-dark.png"
            alt="Hourlark"
            width={144}
            height={138}
            className="mx-auto mb-5 h-auto w-36"
          />
          <h1 className="font-display text-xl font-bold text-[#fafafa]">Unable to open Hourlark</h1>
          <p className="mt-2 text-sm text-[#a4a4a4]">{message}</p>
          <div className="mt-5 flex justify-center">
            <button
              className="rounded-lg bg-[#f59e0b] px-4 py-2 text-sm font-semibold text-[#18181b] hover:bg-[#fbbf24]"
              onClick={() => void me.refetch()}
            >
              Try again
            </button>
          </div>

          {import.meta.env.DEV ? (
            <section className="mt-6 border-t border-white/10 pt-5 text-left">
              <h2 className="text-sm font-bold text-slate-200">Development account recovery</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {developmentIdentity
                  ? `This browser is currently using ${developmentIdentity}.`
                  : "This browser is using the configured default development identity."}{" "}
                Choose another seeded account or return to the configured default.
              </p>
              <button
                type="button"
                className="mt-3 w-full rounded-lg bg-[#f59e0b] px-3 py-2 text-sm font-bold text-[#18181b] hover:bg-[#fbbf24]"
                onClick={clearDevelopmentIdentity}
              >
                Use default development account
              </button>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {DEVELOPMENT_IDENTITIES.map(({ email, label }) => (
                  <button
                    type="button"
                    key={email}
                    className="rounded-lg border border-white/10 bg-white/4 px-2 py-2 text-left hover:border-white/20 hover:bg-white/7 disabled:cursor-default disabled:opacity-50"
                    disabled={email === developmentIdentity}
                    onClick={() => setDevelopmentIdentity(email)}
                  >
                    <span className="block text-xs font-semibold text-slate-200">{label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-500">
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
