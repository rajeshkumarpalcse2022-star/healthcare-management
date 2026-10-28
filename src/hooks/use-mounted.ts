import * as React from "react";

const subscribe = () => () => {};

/**
 * SSR-safe "has the component mounted in the browser?" check.
 * Returns false during server render and on the first client render,
 * then flips to true without triggering a hydration mismatch.
 */
export function useMounted(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
