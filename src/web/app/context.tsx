import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { apiRequest, setCsrfToken } from "@/web/lib/api";
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
    return (
      <div className="app-shell flex min-h-screen items-center justify-center bg-[#0f150e] p-6">
        <div className="panel max-w-lg p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900">Unable to open IOMechs Time</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <button
            className="bg-willow-green-800 hover:bg-willow-green-900 mt-5 rounded-lg px-4 py-2 text-sm font-semibold text-white"
            onClick={() => void me.refetch()}
          >
            Try again
          </button>
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
