"use client";

import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import type { Dataset, ConfigEntry } from "@/types";
import { useData } from "./DataContext";
import { useAuth } from "./AuthContext";
import { useUI } from "./UIContext";
import { DEFAULT_CONFIG as LIB_DEFAULT_CONFIG } from "@/lib/config";

interface ConfigContextValue {
  updateConfig: (key: string, value: string) => void;
  getConfig: (key: string) => string | undefined;
  config: ConfigEntry[];
  cloudSyncEnabled: boolean;
  toggleCloudSync: () => void;
  triggerSync: () => Promise<void>;
  lastSyncAt: string | null;
}

const ConfigCtx = createContext<ConfigContextValue | null>(null);

const DEFAULT_CONFIG = LIB_DEFAULT_CONFIG;

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data, updateDataset } = useData();
  const { canPerm } = useAuth();
  const { toast } = useUI();

  const config = useMemo(() => {
    const merged = [...DEFAULT_CONFIG];
    data.config.forEach(c => {
      const idx = merged.findIndex(m => m.key === c.key);
      if (idx >= 0) merged[idx] = c;
      else merged.push(c);
    });
    return merged;
  }, [data.config]);

  const getConfig = useCallback((key: string) => config.find(c => c.key === key)?.value, [config]);

  const updateConfig = useCallback((key: string, value: string) => {
    if (!canPerm("CONFIG_WRITE" as any)) { toast("No permission to change settings", "error"); return; }
    updateDataset(prev => ({ ...prev, config: [...prev.config.filter(c => c.key !== key), { key, value, description: config.find(c => c.key === key)?.description ?? key, category: config.find(c => c.key === key)?.category ?? "General" }] }));
    toast("Setting saved", "success");
  }, [canPerm, config, updateDataset, toast]);

  const cloudSyncEnabled = data.config.find(c => c.key === "cloudSyncEnabled")?.value === "true";
  const lastSyncAt = data.config.find(c => c.key === "lastSyncAt")?.value ?? null;

  const toggleCloudSync = useCallback(() => {
    if (!canPerm("CONFIG_WRITE" as any)) { toast("No permission", "error"); return; }
    const next = !cloudSyncEnabled;
    updateDataset(prev => ({ ...prev, config: [...prev.config.filter(c => c.key !== "cloudSyncEnabled"), { key: "cloudSyncEnabled", value: String(next), description: "Cloud Sync Enabled", category: "General" }] }));
    toast(`Cloud sync ${next ? "enabled" : "disabled"}`, "success");
  }, [canPerm, cloudSyncEnabled, updateDataset, toast]);

  const triggerSync = useCallback(async () => {
    if (!canPerm("DATA_SYNC" as any)) { toast("No permission", "error"); return; }
    toast("Sync triggered (stub)", "info");
    updateDataset(prev => ({ ...prev, config: [...prev.config.filter(c => c.key !== "lastSyncAt"), { key: "lastSyncAt", value: new Date().toISOString(), description: "Last Sync", category: "General" }] }));
  }, [canPerm, updateDataset, toast]);

  return (
    <ConfigCtx.Provider value={{ updateConfig, getConfig, config, cloudSyncEnabled, toggleCloudSync, triggerSync, lastSyncAt }}>
      {children}
    </ConfigCtx.Provider>
  );
}

export function useConfig() {
  const v = useContext(ConfigCtx);
  if (!v) throw new Error("useConfig must be used within ConfigProvider");
  return v;
}