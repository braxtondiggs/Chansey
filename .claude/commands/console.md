# Console Logs

Check browser console logs and network activity from the running app using Chrome DevTools MCP.

**Usage:** `/console [--errors|--warnings|--network|--all]`

## Arguments

- No flag or `--all`: Show all console output (logs, warnings, errors)
- `--errors`: Only show errors
- `--warnings`: Show warnings and errors
- `--network`: Show failed network requests (4xx/5xx responses)

## Prerequisites

- Chrome must be open with the Chansey app loaded (use `/browse` first, or open manually)
- The Chrome DevTools MCP server must be connected

## Instructions

1. **Connect to Chrome** using the Chrome DevTools MCP tools. If a Playwright browser is already open from a `/browse` session, use that context instead.

2. **Clear stale logs first**, then retrieve fresh ones. The Playwright console buffer accumulates logs across all page navigations in the session. To show only logs relevant to the current page, call `playwright_console_logs` with `clear: true` first to flush old logs, then reload the current page using `playwright_evaluate` with `location.reload()`, and finally retrieve the new logs with a second `playwright_console_logs` call.

3. **Filter and format the output** based on the flag:
   - `--errors`: Only show `console.error` and uncaught exceptions
   - `--warnings`: Show `console.warn` and `console.error`
   - `--network`: Show failed HTTP requests (status >= 400), including URL, method, and status code
   - `--all` / no flag: Show everything

4. **Summarize findings**:
   - Total count by type (errors, warnings, info)
   - Highlight any Angular-specific errors (template errors, DI errors, routing issues)
   - Highlight any API failures (401, 403, 404, 500)
   - Flag any CORS issues
   - Note any deprecation warnings

5. **Suggest fixes** if the errors are recognizable (e.g., missing imports, broken API endpoints, auth token issues).

## Examples

```
/console                  # Show all console output
/console --errors         # Just errors
/console --network        # Failed API calls
/console --warnings       # Warnings + errors
```

## Notes

- If no browser is open, suggest the user run `/browse <page>` first
- Console logs are from the current page state — if the user wants logs from a specific action, they should perform the action first then run `/console`
- For continuous monitoring during development, suggest the user keep Chrome DevTools open alongside
