# SSE Stream Heartbeat Handling Spec

## Status
Accepted

## Goal
Ensure datasource SSE consumers remain stable when `heartbeat` messages appear:
- before first data/result message
- between data/result messages
- after terminal `done` or `end` messages

## Scope
Applies to all SSE parsing paths in this datasource:
- frontend streaming query parsers
- backend plugin streaming query parsers

## Non-Goals
- Changing upstream API event formats
- Replacing SSE transport
- Defining heartbeat intervals/retry policies

## Event Model
SSE messages are parsed from `data:` lines as JSON with a `type` field.

Known event types:
- `result` or `timeseries`: carries data points
- `heartbeat`: keep-alive/no-op
- `done` or `end`: terminal event
- unknown types: ignored unless explicitly supported later

## Required Behavior
1. `heartbeat` MUST be treated as a no-op in every stream phase.
2. `heartbeat` MUST NOT create frames, mutate accumulated series/log buffers, or raise errors.
3. `done`/`end` MUST terminate processing promptly.
4. Once `done`/`end` is observed, consumers MUST finalize and return current results without waiting for EOF.
5. Any events received after `done`/`end` (including `heartbeat`) MUST NOT affect returned results.
6. Unknown/non-data types MUST be ignored safely.
7. Malformed JSON payloads MUST be skipped without failing the whole stream.

## Stream State Machine
States:
- `OPEN`: stream active, collecting data
- `TERMINAL_SEEN`: `done` or `end` observed
- `CLOSED`: results finalized and returned

Transitions:
- `OPEN` + `heartbeat` => `OPEN` (no-op)
- `OPEN` + `result|timeseries` => `OPEN` (append data)
- `OPEN` + `done|end` => `TERMINAL_SEEN`
- `TERMINAL_SEEN` => `CLOSED` (flush/finalize/return)

Notes:
- EOF before terminal event is allowed; finalize with whatever data is collected.
- EOF after terminal event should not change output.

## Error Handling
- Transport/read errors before completion: surface as stream/read error (existing behavior).
- Parse errors for individual SSE lines: continue processing subsequent messages.

## Test Requirements
At minimum, for each SSE parser path, include tests that verify:
1. `heartbeat` before first `result` does not fail and does not create data.
2. `heartbeat` between `result` messages does not alter count/order/values.
3. `heartbeat` after `done`/`end` does not block completion and does not alter output.
4. `done`/`end` causes immediate completion without requiring socket EOF.

## Acceptance Criteria
- Query responses are identical with and without inserted `heartbeat` messages.
- No hangs/timeouts caused by post-terminal heartbeat traffic.
- Existing successful parsing of `result`/`timeseries` remains unchanged.
- Regression tests cover pre-data, in-stream, and post-terminal heartbeat cases.
