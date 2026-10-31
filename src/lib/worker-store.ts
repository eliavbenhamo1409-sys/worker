"use client";

/**
 * Worker-app helpers layered on top of the shared data store:
 * the remembered worker, recent customers and delivery-note photo uploads.
 * Nothing here touches store.tsx.
 */

import { useCallback, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase/client";
import { useData } from "@/lib/store";

const WORKER_KEY = "worker.id";
const CUSTOMERS_KEY = "worker.customers";
const MAX_CUSTOMERS = 8;

/** Storage bucket for photographed delivery notes. Must exist in the Supabase project. */
export const DELIVERY_NOTES_BUCKET = "delivery-notes";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode etc. — the choice just won't persist */
  }
  listeners.forEach((cb) => cb());
}
/** Read a localStorage key as external-store state (null until mounted on the client). */
function useStoredValue(key: string): { value: string | null; hydrated: boolean } {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return { value, hydrated };
}

/** The worker chosen on this phone (validated against the live workers list). */
export function useCurrentWorker() {
  const { state, worker } = useData();
  const { value: id, hydrated } = useStoredValue(WORKER_KEY);
  const choose = useCallback((workerId: string | null) => {
    write(WORKER_KEY, workerId);
  }, []);
  const current = worker(id);
  return {
    worker: current && current.active ? current : undefined,
    ready: hydrated && state.status !== "loading",
    workers: state.workers.filter((w) => w.active),
    choose,
  };
}

function parseCustomers(raw: string | null): string[] {
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Customers recently typed in the deliver flow, most recent first. */
export function useRecentCustomers() {
  const { value: raw } = useStoredValue(CUSTOMERS_KEY);
  const list = parseCustomers(raw);
  const remember = useCallback((name: string) => {
    const n = name.trim();
    if (!n) return;
    const prev = parseCustomers(read(CUSTOMERS_KEY));
    const next = [n, ...prev.filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, MAX_CUSTOMERS);
    write(CUSTOMERS_KEY, JSON.stringify(next));
  }, []);
  return { recent: list, remember };
}

/** Upload a delivery-note photo; resolves to the storage path, or throws. */
export async function uploadDeliveryNote(file: File, supplierId: string): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${supplierId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase().storage.from(DELIVERY_NOTES_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Upload a photographed customer receipt (deliver flow); same bucket, under deliveries/. */
export async function uploadDeliveryReceipt(file: File, workerId: string): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `deliveries/${workerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase().storage.from(DELIVERY_NOTES_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Storage bucket for fault photos (public read). Must exist in the Supabase project. */
export const FAULT_PHOTOS_BUCKET = "fault-photos";

/** Upload a fault photo; resolves to the storage path, or throws. */
export async function uploadFaultPhoto(file: File, workerId: string): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${workerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase().storage.from(FAULT_PHOTOS_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Public URL of a fault photo stored by `uploadFaultPhoto`. */
export function faultPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase().storage.from(FAULT_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}
