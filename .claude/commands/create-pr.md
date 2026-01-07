---
allowed-tools: Bash, Read, Grep, Glob
argument-hint: [--draft] [--base <branch>] [--reviewer <user>]
description: Create a GitHub PR with auto-generated title and description from branch commits
---

# Smart PR Creation

Create a GitHub Pull Request: $ARGUMENTS

## Current State

- Current branch: !`git branch --show-current`
- Default branch: !`git remote show origin 2>/dev/null | grep 'HEAD branch' | cut -d: -f2 | tr -d ' ' || echo "master"`
- Remote tracking: !`git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "not tracking"`
- Unpushed commits:
  !`git log @{u}..HEAD --oneline 2>/dev/null || git log origin/master..HEAD --oneline 2>/dev/null | head -10`
- Changed files: !`git diff --stat origin/master...HEAD 2>/dev/null | tail -5`

## Task

Create a well-structured GitHub PR from the current branch.

### 1. Pre-Flight Checks

Verify the branch is ready for PR:

```bash
# Check we're not on main/master
git branch --show-current

# Check for uncommitted changes
git status --porcelain

# Check if branch is pushed
git rev-parse --abbrev-ref --symbolic-full-name @{u}
```

**If unpushed commits exist**: Push the branch first

```bash
git push -u origin $(git branch --show-current)
```

**If uncommitted changes exist**: Warn the user before proceeding

### 2. Analyze Branch Changes

Gather information about what this branch accomplishes:

```bash
# Get all commits on this branch (not on base)
git log origin/master..HEAD --pretty=format:"%s%n%b" --reverse

# Get the diff stats
git diff --stat origin/master...HEAD

# Get changed files
git diff --name-only origin/master...HEAD
```

### 3. Determine PR Title

Generate a concise, descriptive title:

**From branch name**: Parse the branch name for context

- `feat/add-rsi-strategy` → "Add RSI strategy"
- `fix/order-sync-timeout` → "Fix order sync timeout"
- `refactor/extract-indicator-service` → "Refactor: Extract indicator service"

**From commits**: If single commit, use its message. If multiple, summarize.

**Title Format**:

- Start with type if clear: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Use imperative mood: "Add" not "Added"
- Keep under 72 characters
- Be specific about what changed

### 4. Generate PR Description

Create a structured description:

```markdown
## Summary

[1-3 bullet points describing what this PR accomplishes]

## Changes

[List of key changes, grouped logically]

## Test Plan

[How to verify these changes work]

- [ ] Manual testing steps
- [ ] Automated tests pass

## Related Issues

[Link any related issues: Closes #123, Relates to #456]
```

### 5. Create the PR

Use GitHub CLI to create:

```bash
gh pr create \
  --title "<generated-title>" \
  --body "$(cat <<'EOF'
<generated-body>
EOF
)" \
  --base <base-branch>
```

**Optional flags from arguments**:

- `--draft`: Create as draft PR
- `--base <branch>`: Target branch (default: master/main)
- `--reviewer <user>`: Request review from user

### 6. Post-Creation

After PR is created:

- Display the PR URL
- Show PR number
- List any CI checks that will run

## Output Format

```
## Pre-Flight
✓ Branch: <branch-name>
✓ Pushed to remote
✓ No uncommitted changes
✓ Base branch: <base>

## PR Analysis
Commits: <count>
Files changed: <count>
Insertions: +<count>
Deletions: -<count>

## Generated PR

**Title**: <title>

**Description**:
<full description>

## Created
PR #<number>: <url>

Reviewers: <list or none>
Labels: <list or none>
Draft: <yes/no>
```

## Title Generation Rules

| Branch Pattern        | Generated Title          |
| --------------------- | ------------------------ |
| `feat/add-*`          | "feat: Add ..."          |
| `feat/*-support`      | "feat: Add ... support"  |
| `fix/*-bug`           | "fix: Resolve ... bug"   |
| `fix/*-error`         | "fix: Handle ... error"  |
| `refactor/extract-*`  | "refactor: Extract ..."  |
| `refactor/simplify-*` | "refactor: Simplify ..." |
| `docs/add-*`          | "docs: Add ..."          |
| `docs/update-*`       | "docs: Update ..."       |
| `chore/update-*`      | "chore: Update ..."      |
| `test/add-*`          | "test: Add ... tests"    |

## Examples

### Example 1: Feature Branch

```
Branch: feat/add-trading-expert-skill
Commits: 3

Title: feat: Add trading expert Claude skill

## Summary
- Add conversational trading expert agent with comprehensive indicator knowledge
- Add /analyze-strategy command for strategy analysis
- Include 40+ indicators and strategy design patterns

## Changes
- `.claude/agents/trading-expert.md` - New agent with trading expertise
- `.claude/commands/analyze-strategy.md` - Strategy analysis command

## Test Plan
- [ ] Verify agent responds to trading questions
- [ ] Run /analyze-strategy rsi and verify output
```

### Example 2: Bug Fix

```
Branch: fix/rsi-nan-handling
Commits: 1

Title: fix: Handle NaN values in RSI calculation

## Summary
- Fix edge case where RSI returns NaN with insufficient data
- Add input validation for minimum data points

## Changes
- `apps/api/src/algorithm/indicators/rsi.calculator.ts`

## Test Plan
- [ ] Unit tests pass
- [ ] Manual test with < 14 data points
```

## Error Handling

**No commits on branch**: "Error: No commits found on this branch compared to base. Nothing to create PR for."

**Already has PR**: "PR already exists for this branch: <url>"

**Not on a feature branch**: "Warning: Creating PR from main/master branch. Are you sure?"

**gh CLI not authenticated**: "Error: GitHub CLI not authenticated. Run: gh auth login"
