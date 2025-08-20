import { useEffect, useState } from 'react';
import { DataSource } from '../datasource';

export function useLogFingerprints(
  datasource: DataSource,
  refId: string
): { fingerprints: string[]; bodies: string[]; isLoading: boolean } {
  const [fingerprints, setFingerprints] = useState<string[]>([]);
  const [bodies, setBodies] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);

    const update = () => {
      const fps = datasource.getFingerprints(refId);
      const bds = datasource.getBodies(refId);
      setFingerprints(fps);
      setBodies(bds);
      setIsLoading(false);
    };

    update();
    const interval = setInterval(update, 1000);

    return () => clearInterval(interval);
  }, [datasource, refId]);

  return { fingerprints, bodies, isLoading };
}
