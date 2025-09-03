import { DataFrame, DataQueryRequest, DataFrameType, FieldType, toDataFrame } from '@grafana/data';
import { MyQuery } from 'types';

export async function runLogQLQuery(
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
      path: `/api/v1/logs/query`,
      body: {
        s: String(startTime),
        e: String(endTime),
        orgId: '65928f26-224b-4acb-8e57-9ee628164694',
        q: target.logqlOutput ?? '',
        limit: 1000,
        reverse: true,
      },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Streaming request failed for LogQL query ${target.refId}`);
  }

  let emitCount = 0;
  let lastEmit = 0;
  const shouldEmit = () => !!emit && (emitCount % 50 === 0 || performance.now() - lastEmit > 250);
  const didEmit = () => {
    lastEmit = performance.now();
  };

  const MAX_INITIAL = 1000;
  let buffer = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const VOLUME_LABEL = 'log.events';
  const volume = { timestamps: [] as number[], values: [] as number[] };

  const timestamps: number[] = [];
  const bodies: string[] = [];
  const severities: string[] = [];
  const ids: string[] = [];
  const labelsArr: any[] = [];

  const flushVolumeInto = (dst: DataFrame[]) => {
    if (volume.timestamps.length) {
      const frame = toDataFrame({
        refId: target.refId,
        name: VOLUME_LABEL,
        fields: [
          { name: 'Time', type: FieldType.time, values: volume.timestamps.slice() },
          {
            name: 'Value',
            type: FieldType.number,
            values: volume.values.slice(),
            config: { displayNameFromDS: VOLUME_LABEL },
          },
        ],
      });
      (frame.meta as any) = { preferredVisualisationType: 'graph' };
      dst.push(frame);
    }
  };

  const buildLogsFrame = (): DataFrame => {
    const frame = toDataFrame({
      refId: target.refId,
      name: 'logs',
      fields: [
        { name: 'timestamp', type: FieldType.time, values: timestamps.slice() },
        { name: 'body', type: FieldType.string, values: bodies.slice() },
        { name: 'severity', type: FieldType.string, values: severities.slice() },
        { name: 'id', type: FieldType.string, values: ids.slice() },
        { name: 'labels', type: FieldType.other, values: labelsArr.slice() },
      ],
    });
    frame.meta = {
      type: DataFrameType.LogLines,
      preferredVisualisationType: 'logs',
      custom: { limit: MAX_INITIAL },
    };
    return frame;
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
      if (!line) {
        continue;
      }

      const jsonText = line.startsWith('data:') ? line.slice(5).trim() : line;

      try {
        const parsed = JSON.parse(jsonText);
        const type = (parsed.type || '').toLowerCase();
        const msg = parsed.message ?? parsed.data ?? parsed.result ?? parsed.payload;
        if (!msg) {
          continue;
        }

        if (type === 'timeseries') {
          const labelName = (msg?.tags?.name as string) || '';
          if (labelName === VOLUME_LABEL) {
            volume.timestamps.push(msg.timestamp as number);
            volume.values.push((msg.value ?? 0) as number);
            emitCount++;
          }
        } else if (type === 'event' || type === 'result') {
          const ts = msg.timestamp as number;
          const tags = msg.tags || {};
          const body = tags['_cardinalhq.message'] || tags['log.message'] || tags['message'] || '';
          const level = tags['_cardinalhq.level'] || '';
          const id = tags['_cardinalhq.id'] || '';

          if (timestamps.length < MAX_INITIAL) {
            timestamps.push(ts);
            bodies.push(body);
            severities.push(level);
            ids.push(id);

            const labels: Record<string, any> = {};
            if (tags['_cardinalhq.message']) {
              labels['message'] = tags['_cardinalhq.message'];
            }
            if (tags['_cardinalhq.level']) {
              labels['level'] = tags['_cardinalhq.level'];
            }
            for (const [k, v] of Object.entries(tags)) {
              if (!k.startsWith('_cardinalhq.') && !k.startsWith('nlp')) {
                labels[k] = v;
              }
            }
            labelsArr.push(labels);
          } else if (emit) {
            const frame = toDataFrame({
              refId: target.refId,
              name: 'logs',
              fields: [
                { name: 'timestamp', type: FieldType.time, values: [ts] },
                { name: 'body', type: FieldType.string, values: [body] },
                { name: 'severity', type: FieldType.string, values: [level] },
                { name: 'id', type: FieldType.string, values: [id] },
                { name: 'labels', type: FieldType.other, values: [tags] },
              ],
            });
            frame.meta = {
              type: DataFrameType.LogLines,
              preferredVisualisationType: 'logs',
              custom: { limit: MAX_INITIAL },
            };
            emit([frame]);
          }

          emitCount++;
        }

        if (shouldEmit()) {
          const batch: DataFrame[] = [];
          flushVolumeInto(batch);
          if (timestamps.length > 0 && timestamps.length <= MAX_INITIAL) {
            batch.push(buildLogsFrame());
          }
          if (batch.length && emit) {
            emit(batch);
          }
          didEmit();
        }
      } catch {}
    }
  }

  const frames: DataFrame[] = [];
  flushVolumeInto(frames);
  if (timestamps.length > 0 && timestamps.length <= MAX_INITIAL) {
    frames.push(buildLogsFrame());
  }
  if (emit && frames.length) {
    emit(frames);
  }
  return frames;
}
