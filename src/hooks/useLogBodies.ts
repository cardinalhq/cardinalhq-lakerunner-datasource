import { useEffect, useState } from 'react';
import { DataSource } from '../datasource';

export function useLogBodies(
  datasource: DataSource,
  refId: string,
  version: number
): { bodies: string[]; isLoading: boolean } {
  const [bodies, setBodies] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    const arr = datasource.getCachedLogBodies(refId);
    setBodies(arr);
    setIsLoading(false);
  }, [datasource, refId, version]);

  return { bodies, isLoading };
}
