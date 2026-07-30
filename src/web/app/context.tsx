import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import {
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
  });

  useEffect(() => {
    if (me.data) setCsrfToken(me.data.csrf_token);
  }, [me.data]);

  useEffect(() => {
    const channel = new BroadcastChannel("iomechs-time-timer");
    channel.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ["timer"] });
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    };
    return () => channel.close();
  }, [queryClient]);

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f150e]">
        <div className="text-center">
          <div className="bg-light-green-500 mx-auto mb-3 h-10 w-10 animate-pulse rounded-xl" />
          <p className="text-frosted-mint-200 text-sm font-medium">Loading IOMechs Time…</p>
        </div>
      </div>
    );
  }
  if (me.error || !me.data) {
    const message = me.error instanceof Error ? me.error.message : "Unable to load your workspace.";
    const developmentIdentity = getDevelopmentIdentity();
    return (
      <div className="app-shell flex min-h-screen items-center justify-center bg-[#0f150e] p-6">
        <div className="panel w-full max-w-lg p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900">Unable to open IOMechs Time</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <div className="mt-5 flex justify-center">
            <button
              className="bg-willow-green-800 hover:bg-willow-green-900 rounded-lg px-4 py-2 text-sm font-semibold text-white"
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
                className="bg-light-green-500 text-light-green-950 hover:bg-light-green-400 mt-3 w-full rounded-lg px-3 py-2 text-sm font-bold"
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
