"use client";

import * as React from "react";

/**
 * Returns `value` after it has stayed unchanged for `delayMs`.
 * Used to debounce search input before it triggers a server request.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
