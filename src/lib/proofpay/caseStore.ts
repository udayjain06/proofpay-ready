import { useSyncExternalStore } from "react";
import type { CaseRecord } from "./types";
import { CASES, getCase as getSeedCase } from "./seed";

/**
 * User-created cases (from the "New Case" upload flow) live alongside the
 * seeded demo scenarios. Same useSyncExternalStore pattern as store.ts.
 */

const LOCAL_STORAGE_KEY = "proofpay:user-cases:v1";
/** Cap on stored raw text per document — keeps localStorage small; full text stays in memory for the session. */
const PERSISTED_RAW_TEXT_LIMIT = 400;

interface UserCaseStoreShape {
  cases: Record<string, CaseRecord>;
  order: string[];
}

const store: UserCaseStoreShape = { cases: {}, order: [] };
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUserCasesVersion() {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

function persist() {
  try {
    const trimmed = store.order.map((id) => {
      const c = store.cases[id]!;
      return {
        ...c,
        documents: c.documents.map((d) => ({
          ...d,
          rawText: d.rawText.slice(0, PERSISTED_RAW_TEXT_LIMIT),
        })),
      };
    });
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Best-effort only — a full session-only fallback is fine if storage is unavailable or full.
  }
}

export function loadPersistedCases() {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return;
    const parsed: CaseRecord[] = JSON.parse(raw);
    for (const c of parsed) {
      store.cases[c.id] = c;
      if (!store.order.includes(c.id)) store.order.unshift(c.id);
    }
    emit();
  } catch {
    // Corrupt or unavailable storage — start fresh rather than block the app.
  }
}

export function addCase(record: CaseRecord) {
  store.cases[record.id] = record;
  store.order = [record.id, ...store.order.filter((id) => id !== record.id)];
  persist();
  emit();
}

export function getUserCases(): CaseRecord[] {
  return store.order.map((id) => store.cases[id]).filter((c): c is CaseRecord => Boolean(c));
}

/** All cases — user-created first, then the seeded demo scenarios. */
export function getAllCases(): CaseRecord[] {
  return [...getUserCases(), ...CASES];
}

/** Looks up a case across both user-created and seeded cases. */
export function getCase(id: string): CaseRecord | undefined {
  return store.cases[id] ?? getSeedCase(id);
}
