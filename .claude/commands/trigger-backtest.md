---
allowed-tools: Bash(curl:*)
argument-hint: [--user <userId>] [--host <url>]
description: Trigger backtest orchestration pipeline (defaults to production)
---

# Trigger Backtest Orchestration

Trigger the backtest pipeline: $ARGUMENTS

## What This Command Does

1. Asks the user for their JWT cookie (`chansey_access`) if not recently provided
2. Sends a `POST` request to the backtest orchestration trigger endpoint on production
3. Reports how many orchestration jobs were queued

## Endpoint

```
POST https://www.cymbit.com/api/admin/backtest-monitoring/trigger
```

- **Auth**: Admin role required (JWT via `chansey_access` cookie)
- **Rate limit**: 3 requests per 60 seconds
- **Body** (optional): `{ "userId": "<uuid>" }` — omit to trigger for all eligible users

## Steps

1. Determine the target host:
   - If `--host <url>` is provided in arguments, use that
   - Otherwise default to `https://www.cymbit.com`

2. Determine the user ID:
   - If `--user <userId>` is provided in arguments, include it in the request body
   - Otherwise send an empty body `{}` to trigger for all eligible users

3. Ask the user for their `chansey_access` JWT cookie value (required for authentication)

4. Run the curl command:

   ```
   curl -s -X POST {host}/api/admin/backtest-monitoring/trigger \
     -H "Content-Type: application/json" \
     -b "chansey_access={token}" \
     -d '{body}'
   ```

5. Report the result — the response will be `{ "queued": <number> }` indicating how many jobs were queued

## Error Handling

- If the response contains `Unauthorized` or status 401, the JWT token has expired — ask the user for a fresh token
- If the connection fails (exit code 7), the host is unreachable
- If the response contains `Too Many Requests` or status 429, the rate limit was hit — wait and retry
