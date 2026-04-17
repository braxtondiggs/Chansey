---
allowed-tools: Read, Bash, Grep, Glob
argument-hint: [file-path] | [commit-hash] | --staged | --full | --plan <path> | --no-plan
description: Comprehensive code quality review with security, performance, and architecture analysis
---

# Code Quality Review

Perform comprehensive code quality review: $ARGUMENTS

## Thinking Mode

**IMPORTANT: Use extended thinking for this entire review.** Think deeply and systematically before producing output.
For each review section below, reason through the code from multiple angles — consider edge cases, second-order effects,
and non-obvious interactions. Do not rush to conclusions. Explore the problem space thoroughly before synthesizing
findings.

Apply these thinking principles throughout:

- **First Principles**: Break down each concern to fundamental truths rather than surface-level pattern matching
- **Systems Thinking**: Consider how components interact, feedback loops, and emergent behaviors across the codebase
- **Inversion**: Ask "what could go wrong?" and "what would make this fail?" — not just "does this look right?"
- **Second-Order Effects**: Consider consequences of consequences (e.g., a performance fix that introduces a race
  condition)
- **Probabilistic Reasoning**: Weigh likelihood and severity of issues, not just their existence

## Current State

- Git status: !`git status --porcelain`
- Recent changes: !`git diff --stat HEAD~5`
- Repository info: !`git log --oneline -5`

## Task

Follow these steps to conduct a thorough code review. For each step, think deeply before writing — analyze the code
carefully, consider multiple perspectives, and challenge your own assumptions.

### Step 1: Determine Scope

Identify the files to review from `$ARGUMENTS`:

- If a **file path** is given, review that file + its test file + key imports it depends on
- If a **commit hash** is given, review files changed in that commit (`git show --stat <hash>`)
- If `--staged` is given, review files in `git diff --cached --name-only`
- If `--full` is given, scan broadly but focus depth on the highest-risk files
- If **no argument and there are working changes**, review those changed files
- If **no argument and no changes**, review the last commit

List the files in scope before proceeding. If the scope exceeds 15 files, focus review depth on the most complex or
highest-risk files (services > strategies > processors > entities > DTOs > constants).

**The review ONLY covers files in scope.** Do not review unrelated code.

### Step 2: Context Gathering

**Do this BEFORE analyzing any code. Do not skip this step.**

1. **Read project conventions**: `CLAUDE.md` contains architecture, coding standards, file size limits, and testing
   patterns. Internalize these — violations of CLAUDE.md are real findings; things compliant with it are not.

2. **Read relevant rules files**: Check `.claude/rules/` for any file matching the modules under review. These encode
   intentional design decisions. For example, if reviewing an exchange service, read `.claude/rules/exchange-module.md`.
   These rules describe gotchas, patterns, and architectural decisions that were made deliberately.

3. **Read git history for files in scope**:

   ```bash
   git log --oneline -10 -- <each file in scope>
   ```

   What was recently added or refactored is almost certainly intentional. Do not flag recent deliberate changes as
   issues unless they introduce a genuine bug.

4. **Read neighboring files**: For each file in scope, look at sibling files in the same directory to understand
   established patterns. If every service in a directory uses a particular error handling pattern, that's a convention —
   not an issue.

5. **Read the planning document if one exists** (skip if `--no-plan` was passed). Plans capture intentional design
   decisions made before implementation — without them, you'll re-litigate trade-offs the author already weighed.

   Discovery order:
   - If `--plan <path>` was passed in `$ARGUMENTS`, read that file directly.
   - Otherwise, list the three most recently modified plan files:

     ```bash
     ls -lt ~/.claude/plans/*.md 2>/dev/null | head -3
     ```

     For each candidate (most recent first), check whether it references files or modules in the review scope by
     grepping for path fragments (e.g., `clients/binance-announcement` or `listing-tracker`). The first plan that
     mentions in-scope files is the one to use. If none match, proceed without a plan.

   When a plan is found, read it in full before analyzing code. Pay special attention to these sections:
   - **"Out of scope" / "What we're NOT doing"** — items here were deliberately excluded. Never flag them as gaps.
   - **"Approach" / "Why X" / "Design decisions"** — trade-offs that were already reasoned through. Don't propose
     reverting them.
   - **"Test plan"** — describes intended coverage. Real findings are gaps versus the plan; not gaps the plan itself
     declares acceptable.
   - **"Verification"** — commands the author intended to run. If they're documented, assume they were run.

   In the final report, state which plan file was used (or that none was found), so the reader can audit your
   assumptions.

**Key principle**: Assume patterns that are consistent across the codebase are intentional. Only flag something as an
issue if it deviates from the project's own conventions OR poses a genuine correctness/security/performance risk.

### Step 3: Read Every File in Scope

**CRITICAL: You must read the full contents of every file you are about to review.** Do not assess code from git diffs,
file names, or partial reads alone. For each file in scope:

1. Read the complete file
2. Read its test file if one exists (same name with `.spec.ts` suffix, in the same directory)
3. If the file imports a service and calls it in a non-obvious way, read that service too

You cannot judge code you haven't read. Partial reads lead to false positives.

### Step 4: Analyze

Run through these analysis tracks **only for the files in scope**. Skip tracks that don't apply (e.g., skip Security if
reviewing a pure utility with no I/O).

#### 4a. Correctness & Logic (highest priority)

Look for things that are actually **wrong**:

- Logic errors: off-by-one, wrong operator, inverted condition, missing null check on a path that can be null
- Async bugs: unhandled promise rejection, race condition, missing `await`
- Type safety: `as any` casts hiding real type mismatches, incorrect generic constraints
- Financial precision: using native JS `Number` for money/prices instead of `Decimal.js` (this project requires
  `decimal.js` for all financial math — violations are real bugs)
- State bugs: mutable shared state, stale closures, signal timing issues

#### 4b. Security

Only flag issues with a plausible attack vector in this codebase's context:

- SQL injection: raw queries with string interpolation (TypeORM parameterized queries are fine)
- Secrets: hardcoded API keys, passwords, or tokens (this project uses `CryptoService` AES-256-CBC for exchange keys)
- Auth bypass: missing guards on routes that should be protected, incorrect role checks
- Input validation: missing DTOs or class-validator decorators on controller inputs

Do NOT flag: theoretical XSS in a backend API returning JSON, CSRF on cookie-less endpoints, or generic OWASP items that
don't apply to the tech stack.

#### 4c. Reliability & Error Handling

Especially important for a trading platform:

- Exchange API calls without retry/circuit-breaker (this project has `withRetry`, `withRateLimitRetry`,
  `CircuitBreakerService` — check if they're being used)
- BullMQ processors without proper error handling (failed jobs should be caught and logged, not crash the worker)
- Missing `forwardRef()` on circular NestJS dependencies (will cause runtime injection errors)
- Database operations without transactions where atomicity matters

#### 4d. Performance

Focus on issues that would actually manifest at this project's scale:

- N+1 queries: loops making DB/API calls per item instead of batching
- Missing indexes: queries filtering on unindexed columns (check entity decorators for `@Index`)
- Unbounded operations: loading all rows without pagination, processing arrays of unknown size
- Cache misuse: key collisions, missing TTL, caching mutable data
- BullMQ: jobs without timeout or retry limits, missing concurrency controls

Do NOT flag: micro-optimizations, theoretical O(n^2) on arrays always < 10 items, or "use a Map instead of Object" style
nits.

#### 4e. Project Convention Violations

Check against `CLAUDE.md` and the relevant rules files:

- File size limits (backend: 500 soft / 750 hard; frontend: 250 soft / 400 hard)
- Import ordering (Angular -> NestJS -> third-party -> internal -> relative)
- Test file placement (co-located `.spec.ts`, not in a separate `tests/` folder)
- Entity table naming (check `.claude/rules/migrations.md` for singular vs plural reference)
- Missing `OnPush` change detection on Angular components
- Services not using `providedIn: 'root'` pattern

### Step 5: Validate & Triage Every Finding

**CRITICAL: Do not report any finding without validating it first.** For each potential issue identified in Step 4, run
it through this evaluation before including it in the report:

| Criteria            | Question to answer                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| **Intentional?**    | Is this pattern used consistently in the codebase? Was it recently added/changed deliberately? |
| **Plan-documented** | Does the plan file mark this as out-of-scope, an explicit trade-off, or a "Why X" decision?    |
| **Correctness**     | Is this actually wrong, or just different from what I'd write?                                 |
| **Project Context** | Does CLAUDE.md, a rules file, or the project's conventions explain this choice?                |
| **Impact**          | Would changing this meaningfully improve correctness, security, or performance?                |
| **Risk**            | Could the suggested fix introduce bugs or break existing behavior?                             |

Assign each finding a verdict:

- **FIX** — Genuine bug, security vulnerability, or correctness issue. The code is wrong, not just different.
- **CONSIDER** — Has merit but is a trade-off, style preference, or optimization. Needs discussion.
- **NOTED** — Observation that provides context but doesn't warrant a code change (e.g., tech debt that's intentionally
  deferred, a pattern that's consistent across the codebase).

**Discard** findings that are: already covered by project conventions, consistent with established patterns, style
preferences that don't affect correctness, or things you'd do differently but aren't actually wrong.

### Step 6: Present Results

Group validated findings by verdict, not by analysis category. Format:

```markdown
## Code Review: <scope description>

**Plan reference**: `<path to plan file used, or "none found">` <br> **Files in scope**: <count>

### FIX (<count>) — Issues that should be addressed

#### 1. <file>:<line> — <short description>

**Issue**: <what's wrong> **Why it matters**: <impact — bug, security, data loss, etc.> **Suggested fix**:
<concrete code change> **Confidence**: <high/medium> (low-confidence findings should be CONSIDER, not FIX)

---

### CONSIDER (<count>) — Trade-offs worth discussing

#### 1. <file>:<line> — <short description>

**Observation**: <what you noticed> **Pros/Cons**: <why this might or might not be worth changing>

---

### NOTED (<count>) — Context and observations

- <file>:<line> — <brief observation>

---

### Summary

| Verdict  | Count |
| -------- | ----- |
| FIX      | <n>   |
| CONSIDER | <n>   |
| NOTED    | <n>   |

**Overall assessment**: <1-2 sentence take on code health>
```

**Rules for the report:**

- Every FIX must have high or medium confidence — if you're unsure, it's a CONSIDER
- Never suggest changes that contradict CLAUDE.md or established project patterns
- Prefer fewer, validated findings over a long list of maybes
- If you found nothing worth fixing, say so — an empty FIX section is a valid outcome
