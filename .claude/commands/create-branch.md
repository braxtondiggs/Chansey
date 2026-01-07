---
allowed-tools: Bash, Read, Grep, Glob
argument-hint: [--prefix <type>] [--push]
description: Analyze local changes and create a descriptive branch name that conveys what was accomplished
---

# Smart Branch Creation

Create a branch based on local changes: $ARGUMENTS

## Current State

- Current branch: !`git branch --show-current`
- Git status: !`git status --porcelain`
- Staged changes: !`git diff --cached --stat`
- Unstaged changes: !`git diff --stat`
- Untracked files: !`git ls-files --others --exclude-standard | head -10`

## Task

Analyze the local git changes and create an appropriately named branch.

### 1. Analyze Changes

Review all changes to understand what was accomplished:

**For modified files**: Read the diffs to understand what changed

```bash
git diff --cached  # staged changes
git diff           # unstaged changes
```

**For new files**: Read the file contents to understand their purpose

**For deleted files**: Note what was removed

### 2. Determine Change Type

Identify the primary type of change:

| Prefix      | Use When                                   |
| ----------- | ------------------------------------------ |
| `feat/`     | New feature or functionality               |
| `fix/`      | Bug fix                                    |
| `refactor/` | Code restructuring without behavior change |
| `docs/`     | Documentation only                         |
| `style/`    | Formatting, whitespace, no code change     |
| `test/`     | Adding or updating tests                   |
| `chore/`    | Build, config, dependencies                |
| `perf/`     | Performance improvements                   |
| `ci/`       | CI/CD changes                              |

If `--prefix <type>` is provided, use that prefix instead.

### 3. Generate Branch Name

Create a branch name following these rules:

**Format**: `<type>/<descriptive-slug>`

**Rules**:

- Use lowercase with hyphens (kebab-case)
- Keep it concise but descriptive (3-6 words max)
- Focus on WHAT was accomplished, not HOW
- No issue numbers unless explicitly mentioned
- Avoid generic names like "update" or "changes"

**Good Examples**:

- `feat/add-trading-expert-skill`
- `fix/rsi-calculation-edge-case`
- `refactor/extract-indicator-service`
- `docs/api-endpoint-documentation`
- `feat/bollinger-band-squeeze-strategy`

**Bad Examples**:

- `update-files` (too vague)
- `fix-bug` (not descriptive)
- `new-feature` (meaningless)
- `wip` (not descriptive)

### 4. Validate Branch Name

Before creating:

- Check if branch already exists: `git branch --list <name>`
- Check remote branches: `git branch -r --list origin/<name>`
- Ensure no special characters except hyphens and forward slash

### 5. Create Branch

```bash
git checkout -b <branch-name>
```

If `--push` flag is provided:

```bash
git push -u origin <branch-name>
```

## Output Format

```
## Change Analysis
[Summary of what the changes accomplish]

## Files Changed
- [list of key files and what changed]

## Branch Name
`<type>/<descriptive-slug>`

## Rationale
[Why this name accurately describes the changes]

## Commands Executed
- git checkout -b <branch-name>
- [git push -u origin <branch-name>] (if --push)
```

## Examples

### Example 1: New Feature

Changes: Added new RSI divergence detection to trading algorithm Branch: `feat/rsi-divergence-detection`

### Example 2: Bug Fix

Changes: Fixed edge case where ATR returns NaN on insufficient data Branch: `fix/atr-nan-handling`

### Example 3: Multiple Related Changes

Changes: Added tests, updated docs, and fixed typos for order service Branch: `chore/order-service-cleanup`

### Example 4: Refactoring

Changes: Extracted common indicator logic into shared base class Branch: `refactor/indicator-base-class`
