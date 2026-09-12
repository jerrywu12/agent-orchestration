import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "./api";
import type { DeskState, Health, Integrations } from "./types";

export function useDesk() {
  const [state, setState] = useState<DeskState | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [integrationError, setIntegrationError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const requestId = useRef(0);
  const inflight = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    inflight.current = true;
    try {
      const result = await api<DeskState>("/state");
      if (id === requestId.current && mounted.current) {
        setState(result);
        setError("");
        setLastUpdated(Date.now());
        setAuthRequired(false);
      }
    } catch (failure) {
      if (id === requestId.current && mounted.current) {
        if (failure instanceof ApiError && failure.status === 401)
          setAuthRequired(true);
        else setError(errorMessage(failure));
      }
    } finally {
      if (id === requestId.current) inflight.current = false;
    }
  }, []);

  const refreshIntegrations = useCallback(async () => {
    try {
      const result = await api<Integrations>("/integrations");
      if (mounted.current) {
        setIntegrations(result);
        setIntegrationError("");
      }
    } catch (failure) {
      if (mounted.current) setIntegrationError(errorMessage(failure));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unauthorized = () => setAuthRequired(true);
    window.addEventListener("agent-desk:unauthorized", unauthorized);
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden && !inflight.current) void refresh();
    }, 4000);
    const focus = () => {
      if (!inflight.current) void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      requestId.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("agent-desk:unauthorized", unauthorized);
    };
  }, [refresh]);

  useEffect(() => {
    if (!state || authRequired) return;
    void refreshIntegrations();
    void api<Health>("/health")
      .then((value) => {
        if (mounted.current) setHealth(value);
      })
      .catch(() => {});
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshIntegrations();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [!!state, authRequired, refreshIntegrations]);

  return {
    state,
    integrations,
    health,
    error,
    integrationError,
    authRequired,
    lastUpdated,
    refresh,
    refreshIntegrations,
    async login(token: string) {
      await api("/login", "POST", { token });
      await refresh();
    },
    async logout() {
      await api("/logout", "POST");
      setAuthRequired(true);
      setState(null);
    },
  };
}
