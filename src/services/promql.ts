import { DataFrame, DataQueryRequest, FieldType, toDataFrame } from '@grafana/data';
import { MyQuery } from 'types';

export async function runPromQLQuery(
  dataSourceId: number,
  target: MyQuery,
  range: DataQueryRequest['range'],
  signal: AbortSignal,
  emit?: (frames: DataFrame[]) => void
) {
  const startTime = range.from.valueOf();
  const endTime = range.to.valueOf();

  const response = await fetch(`/api/datasources/${dataSourceId}/resources/proxy-promql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `/api/v1/metrics/query`,
      body: {
        s: String(startTime),
        e: String(endTime),
        orgId: '65928f26-224b-4acb-8e57-9ee628164694', // TODO: This should go away
        q: target.promqlOutput,
      },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Streaming request failed for query ${target.refId}`);
  }

  let emitCount = 0;
  let lastEmit = 0;
  const shouldEmit = () => !!emit && (emitCount % 50 === 0 || performance.now() - lastEmit > 250);
  const didEmit = () => {
    lastEmit = performance.now();
  };

  let buffer = '';
  const frameData: Record<string, { timestamps: number[]; values: number[] }> = {};

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const flushMetricFramesInto = (dst: DataFrame[]) => {
    for (const [label, series] of Object.entries(frameData)) {
      const ref = target.refId;

      const frame = toDataFrame({
        refId: ref,
        name: label,
        fields: [
          { name: 'Time', type: FieldType.time, values: series.timestamps.slice() },
          {
            name: 'Value',
            type: FieldType.number,
            values: series.values.slice(),
            config: {
              displayNameFromDS: label,
            },
          },
        ],
      });

      (frame.meta as any) = { preferredVisualisationType: 'graph' };
      dst.push(frame);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed.type !== 'result') {
          continue;
        }
        const point = parsed.data?.default;
        if (!point) {
          continue;
        }

        const ts = point.timestamp;
        const val = point.value?.num ?? 0;
        const tags = point.tags ?? {};

        const labelParts: string[] = [];
        Object.entries(tags).forEach(([key, value]) => {
          labelParts.push(`${key}=${value}`);
        });
        const label = labelParts.length ? labelParts.join(', ') : (target.metricName as string);

        if (!frameData[label]) {
          frameData[label] = { timestamps: [], values: [] };
        }

        frameData[label].timestamps.push(ts);
        frameData[label].values.push(val);

        emitCount++;

        if (shouldEmit()) {
          const batch: DataFrame[] = [];
          flushMetricFramesInto(batch);
          if (batch.length) {
            emit!(batch);
          }
          didEmit();
        }
      } catch (err) {
        // noop
      }
    }
  }

  const frames: DataFrame[] = [];
  flushMetricFramesInto(frames);
  if (emit && frames.length) {
    emit(frames);
  }

  return frames;
}
