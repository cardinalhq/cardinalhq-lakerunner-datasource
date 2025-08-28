import { useEffect, useState } from 'react';
import { DataSource } from '../datasource';

const FAST_MS = 1000;
const SLOW_MS = 5 * 60 * 1000;
function arraysEqual(a: string[], b: string[]) {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function useLogFingerprints(
  datasource: DataSource,
  refId: string
): { fingerprints: string[]; bodies: string[]; isLoading: boolean } {
  const [fingerprints, setFingerprints] = useState<string[]>([]);
  const [bodies, setBodies] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const hasData = (fps: string[], bds: string[]) => fps.length > 0 || bds.length > 0;

    const schedule = (delay: number) => {
      if (cancelled) {
        return;
      }
      timer = setTimeout(tick, delay);
    };

    const tick = () => {
      if (cancelled) {
        return;
      }
      const fps = datasource.getFingerprints(refId);
      const bds = datasource.getBodies(refId);

      if (cancelled) {
        return;
      }
      if (isLoading && hasData(fps, bds)) {
        setIsLoading(false);
      }

      setFingerprints((prev) => (arraysEqual(prev, fps) ? prev : fps));
      setBodies((prev) => (arraysEqual(prev, bds) ? prev : bds));

      const nextDelay = hasData(fps, bds) ? SLOW_MS : FAST_MS;
      schedule(nextDelay);
    };

    setIsLoading(true);
    tick();

    const onFocus = () => {
      if (cancelled) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      tick();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      window.removeEventListener('focus', onFocus);
    };
  }, [datasource, isLoading, refId]);

  return { fingerprints, bodies, isLoading };
}
