import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";
import type { AgentCapacity } from "./types";

interface CapacitySnapshot {
  agents: AgentCapacity[];
  refreshing: boolean;
}

export function useAgentCapacity() {
  const [snapshot, setSnapshot] = useState<CapacitySnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const mounted = useRef(false);
  const requestNumber = useRef(0);
  const inflight = useRef(false);
  const read = useCallback(async (refresh = false) => {
    const number = ++requestNumber.current;
    inflight.current = true;
    setLoading(true);
    try {
      const next = await api<CapacitySnapshot>(
        refresh ? "/agents/status/refresh" : "/agents/status",
        refresh ? "POST" : "GET",
      );
      if (!mounted.current || number !== requestNumber.current) return;
      setSnapshot(next);
      setCheckedAt(Date.now());
      setError("");
    } catch (failure) {
      if (mounted.current && number === requestNumber.current) {
        setError(errorMessage(failure));
        setCheckedAt(Date.now());
      }
    } finally {
      if (number === requestNumber.current) {
        inflight.current = false;
        if (mounted.current) setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void read();
    return () => {
      mounted.current = false;
      requestNumber.current += 1;
    };
  }, [read]);
  useEffect(() => {
    const timer = window.setInterval(
      () => {
        setCheckedAt(Date.now());
        if (!document.hidden && !inflight.current) void read();
      },
      snapshot?.refreshing ? 2000 : 30000,
    );
    return () => window.clearInterval(timer);
  }, [read, snapshot?.refreshing]);
  return {
    agents: snapshot?.agents || [],
    error,
    loading,
    refreshing: snapshot?.refreshing || false,
    checkedAt,
    refresh: () => read(true),
  };
}
