---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
argument-hint: [test-file-path]
description: Review tests for usefulness, optimize coverage, and trim redundant or low-value tests
---

# Test Review & Optimization

Review and optimize tests for: $ARGUMENTS

## Context Gathering

- Target test file: @$ARGUMENTS
- Git diff (staged + unstaged): !`git diff HEAD -- "$ARGUMENTS" 2>/dev/null`
- Recent commits touching this file: !`git log --oneline -5 -- "$ARGUMENTS" 2>/dev/null`

## Step 1: Read the Source File Under Test

Before evaluating any tests, you MUST:

1. Open the test file and examine its imports to identify the **source file being tested**
   - Look for the primary import (e.g., `import { BacktestRecoveryService } from './backtest-recovery.service'`)
   - The source file is typically the test filename minus `.spec` or `.test`
2. **Read the full source file** to understand:
   - All public methods and their signatures
   - Conditional branches (if/else, switch, try/catch, ternary)
   - Error handling paths (throw, reject, catch blocks)
   - Edge cases implied by guard clauses or input validation
   - External dependencies and how they're called
3. Build a mental map of **what the source file actually does** before judging what the tests cover

This step is critical — you cannot assess test value without knowing the implementation.

## Task

With both the test file and source file loaded, perform a thorough review to assess quality, coverage value, and
identify opportunities for improvement or trimming.

**Ask the user which mode(s) to run** before proceeding:

1. **Audit** — Evaluate each test for usefulness and coverage value (default)
2. **Optimize** — Improve/refactor tests for clarity, speed, and better coverage
3. **Trim** — Remove tests that are redundant, trivially obvious, or duplicate coverage
4. **Full** — Run all three in sequence

## Mode 1: Audit

For each test case in the file, evaluate:

### Coverage Value (compare against the source file)

- Does this test exercise a **real code path** in the source file?
- Does it cover a **new requirement** or **behavior change**?
- Does it test **meaningful business logic** vs trivially obvious code?
- Would removing this test leave a real gap in confidence?
- Is the assertion actually verifying something important, or just that code runs without throwing?

### Redundancy Check

- Does another test already cover the same code path in the source?
- Are multiple tests asserting the same behavior with trivially different inputs?
- Is a test duplicating what TypeScript's type system already guarantees?

### Gap Analysis (what's NOT tested)

- Which public methods or branches in the source file have **no corresponding test**?
- Are error/catch paths tested?
- Are boundary conditions (empty arrays, null inputs, zero values) covered?
- List any **missing tests** that would add real value

### Classification

Classify each test as:

- **Essential** — Covers critical logic, edge case, or regression scenario
- **Useful** — Adds moderate coverage value, worth keeping
- **Low-value** — Tests something trivial (e.g., constructor exists, dependency is injected)
- **Redundant** — Another test already covers this same path
- **Padding** — Added purely to inflate coverage numbers with no real safety net

Output a summary table:

| Test Name | Classification | Reason |
| --------- | -------------- | ------ |

Then output a gaps table for untested source code paths:

| Source Method/Branch | Risk Level | Suggested Test |
| -------------------- | ---------- | -------------- |

## Mode 2: Optimize

For tests classified as Essential or Useful:

- **Consolidate** — Merge tests that share identical setup into parameterized/`each` blocks
- **Strengthen assertions** — Replace weak assertions (`.toBeDefined()`) with specific value checks
- **Improve naming** — Ensure test names describe the _behavior_, not the implementation
- **Reduce setup noise** — Extract repeated mock/setup into `beforeEach` or factories
- **Fix flakiness risks** — Identify time-dependent, order-dependent, or async race conditions
- **Speed up** — Replace unnecessary `async/await` or heavy setup when simpler alternatives exist

Apply changes directly to the test file.

## Mode 3: Trim

Remove or flag for removal:

- Tests classified as **Low-value**, **Redundant**, or **Padding** from the audit
- Tests that only assert default/constructor behavior with no logic
- Tests that duplicate coverage of the same conditional branch
- Tests with no meaningful assertion (e.g., `expect(result).toBeDefined()` on a sync call that can't return undefined)
- Snapshot tests that nobody reviews when they break

Before removing, confirm the count and list with the user.

## Output

After completing the selected mode(s), provide:

1. **Summary** — What was found, changed, or removed
2. **Before/After metrics** — Number of tests, estimated coverage impact
3. **Recommendations** — Any follow-up actions (e.g., "add a test for the error path in X")

Run the tests after any modifications to confirm nothing breaks:

```
npx nx test api --testFile='<filename>'
```
