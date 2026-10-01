import { useMemo, useSyncExternalStore } from "react";

/**
 * A `next/navigation` stand-in for component tests: `useSearchParams` follows
 * `history.pushState`/`replaceState` like the Next.js App Router does.
 */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

const originalPushState = window.history.pushState.bind(window.history);
const originalReplaceState = window.history.replaceState.bind(window.history);

window.history.pushState = (...args: Parameters<History["pushState"]>) => {
  originalPushState(...args);
  notify();
};
window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
  originalReplaceState(...args);
  notify();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

/** `router.refresh()` is observable in tests through this mock. */
export const routerRefresh = { calls: 0 };

export function useRouter() {
  return {
    refresh: () => {
      routerRefresh.calls += 1;
    },
  };
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  return useMemo(() => new URLSearchParams(search), [search]);
}
