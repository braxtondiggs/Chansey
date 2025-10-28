# Quickstart: Autonomous Strategy Lifecycle System

This guide walks new contributors through provisioning the environment, registering a strategy, triggering automated validation, reviewing unified scoring, deploying to production, and responding to monitoring incidents.

## 1. Bootstrapping the Stack

```bash
npm install
# Start backend & frontend (two terminals)
npx nx serve api
npx nx serve chansey
```

Prerequisites:
- PostgreSQL and Redis running with credentials from `apps/api/.env.example`
- Feature flags `AUTONOMOUS_LIFECYCLE_ENABLED=true` and `REGIME_SERVICE_URL` configured in `apps/api/.env`

Seed reference data (market datasets, initial regime bands):

```bash
npx nx run api:seed-backtest-datasets
npx nx run api:seed-regime-bands
```

## 2. Register a Strategy (Research Role)

```bash
curl -X POST http://localhost:3000/api/strategies \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: research' \
  -d '{
    "code": "BTC-MOMO",
    "name": "BTC Momentum",
    "objective": "Capture short-term upside during neutral/turbulent regimes",
    "ownerId": "11111111-1111-1111-1111-111111111111",
    "eligibleMarkets": ["BTC/USDT@BinanceUS", "BTC/USD@Coinbase"],
    "riskCategory": "moderate",
    "capitalGuardrails": {"production": 0.15, "staging": 0.05}
  }'
```

Submit a version and initial parameters:

```bash
curl -X POST http://localhost:3000/api/strategies/<strategyId>/versions \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: research' \
  -d '{
    "versionTag": "v2025.10.0",
    "changelog": "Initial momentum model tuned for BTC.",
    "deterministicSeed": 927161,
    "parameterConfigs": [{
      "label": "baseline",
      "parameters": {"lookback": 24, "threshold": 1.5}
    }]
  }'
```

## 3. Automated Validation Flow

Approved data ingestions or regime events automatically trigger runs. To queue manually during testing:

```bash
curl -X POST http://localhost:3000/api/validation/triggers \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: research' \
  -d '{
    "strategyId": "<strategyId>",
    "triggerType": "version_update",
    "scope": "backtest",
    "requestedBy": "11111111-1111-1111-1111-111111111111",
    "notes": "Smoke test after parameter tweak"
  }'
```

Monitor progress:

```bash
curl "http://localhost:3000/api/validation/runs?strategyId=<strategyId>&limit=10"
```

Runs record regime band, metrics, warnings, and telemetry pointer. Inspect Redis stream `backtest:telemetry:<runId>` for live signal output if needed.

## 4. Review Scorecards & Recommendations

Angular UI: `http://localhost:4200/app/strategies` provides Research, Production, and Risk tabs. Research tab lists scorecards with robust metrics and drift signals.

API alternative:

```bash
curl "http://localhost:3000/api/scorecards/latest?lifecycleState=validation&limit=20"
```

Verify unified score, recommendation, and supporting breakdowns.

## 5. Approve Deployment with Safety Gates

1. Production approver reviews scorecard ≥ promotion threshold.
2. Approver updates version approval:

```bash
curl -X POST http://localhost:3000/api/strategies/<strategyId>/versions/<versionId>/approval \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: production' \
  -d '{"decision": "approved", "reviewerId": "<prod-user-id>", "notes": "Meets guardrails."}'
```

3. Promotion request auto-creates deployment in `pending` state.
4. Execute approval & allocate capital:

```bash
curl -X POST http://localhost:3000/api/deployments/<deploymentId>/actions \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: production' \
  -d '{
    "action": "approve",
    "actorId": "<prod-user-id>",
    "capitalAllocation": 0.12,
    "notes": "Pilot rollout"
  }'
```

Deployment moves to `active` once safety gates (benchmark, guardrails, incidents) pass. Expect activation within 5 minutes; inspect queue `deployment-activation`.

## 6. Respond to Monitoring Incidents

Incidents appear on Risk tab or via API:

```bash
curl "http://localhost:3000/api/monitoring/incidents?status=open"
```

Critical incidents automatically apply throttles or trigger rollback. To close after remediation:

```bash
curl -X PATCH http://localhost:3000/api/monitoring/incidents/<incidentId> \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: risk' \
  -d '{"status": "resolved", "notes": "Re-test passed post regime shift."}'
```

Audit entries for promotions, rollbacks, and capital adjustments are accessible via:

```bash
curl "http://localhost:3000/api/audit/events?strategyId=<strategyId>&limit=50"
```

## 7. Troubleshooting Checklist

| Symptom | Action |
| --- | --- |
| Trigger accepted but no run | Confirm BullMQ workers `validation-scheduler`, `backtest-historical`, `optimization-engine` active; check Redis connectivity. |
| Scorecard missing metrics | Inspect BacktestRun `warningFlags` for data quality issues; re-run dataset certification. |
| Deployment approval denied | Review gate failure response—capital guardrail breach, open critical incidents, or benchmark lag >200 bps. |
| Auto-rollback fired unexpectedly | Cross-check monitoring incident log; verify benchmark feed availability and regime band accuracy. |
| Missing audit entries | Ensure `AUDIT_LOG_TOPIC` env set; check retention service if running locally longer than 24h. |

Keep Redis and PostgreSQL logs open during testing for rapid diagnosis. PrimeNG dashboards rely on TanStack Query caches—hard refresh (`Cmd+Shift+R`) if stale data persists after backend fixes.
