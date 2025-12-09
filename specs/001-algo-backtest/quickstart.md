# Quickstart: Algorithm Backtesting Integration

This guide walks you through spinning up the Chansey stack, launching historical or live replay backtests, and
monitoring telemetry for troubleshooting.

## 1. Start Required Services

```bash
# install deps once
npm install

# start API + frontend with Nx (uses default .env values)
npx nx serve api
npx nx serve chansey
```

Ensure PostgreSQL and Redis are running with the credentials referenced in `apps/api/.env`.

## 2. Seed Market Data Sets (optional but recommended)

```bash
# load curated historical/replay datasets
npx nx run api:seed-backtest-datasets
```

Verify datasets via `GET /api/backtests/datasets` or the Angular historical run page.

## 3. Launch a Historical Backtest

1. Open `http://localhost:4200/app/backtesting`.
2. Select an approved algorithm + dataset, tweak capital/fees, and submit.
3. The API queues the job and returns a `PENDING` run with deterministic seed + config snapshot.

API alternative:

```bash
curl -X POST http://localhost:3000/api/backtests \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: <local-api-key>' \
  -d '{
    "name": "BTC Momentum Q1",
    "type": "HISTORICAL",
    "algorithmId": "<algo-uuid>",
    "marketDataSetId": "<dataset-uuid>",
    "initialCapital": 10000,
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-31T23:59:59.000Z"
  }'
```

Use `GET /api/backtests` or the UI grid to watch status transitions and review metrics/signals/trades.

## 4. Run a Live Replay Simulation

1. Choose a dataset flagged `replayCapable=true`.
2. Submit with `type: "LIVE_REPLAY"`.
3. Subscribe to telemetry in the UI (Live Replay tab) or directly via the websocket gateway:

```ts
const socket = io('/backtests');
socket.emit('subscribe', { backtestId: '<run-id>' });
socket.on('status', console.log);
socket.on('metric', console.log);
```

Live replay intercepts outbound orders and records them as simulated fills only.

## 5. Comparison Reports

After multiple runs complete:

```bash
curl -X POST http://localhost:3000/api/comparison-reports \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: <key>' \
  -d '{"name":"BTC Study","runIds":["run-1","run-2"]}'
```

Review via `/app/backtesting/comparison`.

## 6. Monitoring & Telemetry

- Structured events stream to the Redis key defined by `BACKTEST_TELEMETRY_STREAM`.
- `BacktestStreamService` mirrors events to websocket clients for real-time status/log/metric updates.
- Use `apps/api/src/order/backtest/backtest.historical.spec.ts` / `.replay.spec.ts` for regression hints.

## 7. Troubleshooting

| Symptom                              | What to Check                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Run stuck in `PENDING`               | BullMQ queues `backtest-historical` / `backtest-replay` running? Redis reachable?                         |
| `dataset_not_replay_capable` warning | Pick a dataset with `replayCapable=true` or switch to historical mode.                                    |
| No signals/trades recorded           | Confirm algorithm registry returns actionable signals; inspect telemetry logs for errors.                 |
| Live replay tries to trade           | Verify outbound order interception via `SimulatedOrderFill` records; no external exchange calls are made. |

When in doubt, review `apps/api/src/order/backtest/backtest.service.ts` logging and the Redis telemetry stream for
detailed run context.
