import { useCallback, useEffect, useState } from "react";

interface ResourceState<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

/**
 * One loader for every screen: fetch on mount, refetch when `key` changes,
 * expose `reload` for after a write. Stale responses are discarded so a slow
 * request for yesterday cannot overwrite a fast one for today.
 */
export function useResource<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<ResourceState<T>>({ loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));

    load()
      .then((data) => {
        if (active) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ loading: false, error: error instanceof Error ? error.message : "요청이 실패했습니다." });
      });

    return () => {
      active = false;
    };
    // `load` is rebuilt on every render by callers; `key` is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}
