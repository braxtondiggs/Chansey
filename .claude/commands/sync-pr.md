---
allowed-tools: Bash, Read, Grep, Glob
argument-hint: [PR number] [--rebase | --merge] [--auto-resolve]
description: Sync a GitHub PR branch that is behind master and resolve conflicts to get it ready for merge
---

# Sync PR Branch

Sync a PR branch with master and resolve conflicts: $ARGUMENTS

## Current State

- Current branch: !`git branch --show-current`
- Default branch: !`git remote show origin 2>/dev/null | grep 'HEAD branch' | cut -d: -f2 | tr -d ' ' || echo "master"`
- Uncommitted changes: !`git status --porcelain | head -5`
- Stash list: !`git stash list | head -3`

## Task

Get a PR branch that is behind master and/or has merge conflicts synced up and ready for merge.

### 1. Identify Target Branch

**If a PR number is provided** (e.g., `sync-pr 123`):

```bash
# Get the branch name and PR details
gh pr view <number> --json headRefName,baseRefName,mergeable,mergeStateStatus,title,number,statusCheckRollup
```

- Check out the PR branch locally if not already on it
- Confirm the base branch (usually master)

**If no PR number is provided**:

- Use the current branch
- Find the associated PR:

```bash
gh pr view --json headRefName,baseRefName,mergeable,mergeStateStatus,title,number,statusCheckRollup
```

**If no PR exists for the current branch**: Error and exit.

### 2. Pre-Flight Checks

Before syncing, verify the workspace is clean:

```bash
# Check for uncommitted changes
git status --porcelain
```

**If uncommitted changes exist**: Warn the user and ask whether to stash them before proceeding.

```bash
# Stash if user agrees
git stash push -m "sync-pr: auto-stash before syncing"
```

### 3. Fetch Latest Remote State

```bash
# Fetch latest from origin
git fetch origin

# Show how far behind master the branch is
git rev-list --left-right --count origin/master...HEAD
```

Report the status:
- Commits behind master
- Commits ahead of master
- Whether conflicts exist

**If the branch is already up-to-date with master and has no conflicts**: Report this and exit early.

### 4. Sync Strategy

Determine the sync strategy based on arguments or defaults:

**`--rebase` (default)**: Rebase the branch onto master. Produces a cleaner history.

```bash
git rebase origin/master
```

**`--merge`**: Merge master into the branch. Preserves branch history.

```bash
git merge origin/master
```

### 5. Handle Conflicts

If conflicts arise during rebase or merge:

```bash
# List conflicted files
git diff --name-only --diff-filter=U
```

For each conflicted file:

1. **Read the file** to understand the conflict markers
2. **Analyze both sides** of the conflict:
   - What the current branch changed (theirs during rebase / ours during merge)
   - What master changed
3. **Resolve the conflict** by:
   - If `--auto-resolve` is specified: Attempt intelligent resolution by understanding both changes
   - Otherwise: Show the conflicts to the user and ask for guidance on each one

After resolving each file:

```bash
git add <resolved-file>
```

After all conflicts are resolved:

**For rebase**:

```bash
git rebase --continue
```

**For merge**:

```bash
git commit -m "$(cat <<'EOF'
merge: sync branch with master

Resolve merge conflicts to bring branch up-to-date with master.
EOF
)"
```

**If rebase has multiple conflict steps**: Continue resolving commit by commit until the rebase completes.

### 6. Verify Resolution

After syncing is complete:

```bash
# Verify no remaining conflicts
git diff --name-only --diff-filter=U

# Verify the branch is now up-to-date
git rev-list --left-right --count origin/master...HEAD

# Quick sanity check - does the project build?
# (Skip if user passed --no-build)
```

### 7. Push Updated Branch

```bash
# Force push is required after rebase
git push --force-with-lease origin $(git branch --show-current)
```

**Important**: Use `--force-with-lease` (not `--force`) to prevent overwriting any new commits pushed by others.

After pushing, verify the PR state:

```bash
gh pr view --json mergeable,mergeStateStatus,statusCheckRollup
```

### 8. Pop Stash (if applicable)

If changes were stashed in step 2:

```bash
git stash pop
```

## Output Format

```
## PR Sync Report

PR: #<number> - <title>
Branch: <branch-name> → <base-branch>

## Before Sync
Behind master: <count> commits
Ahead of master: <count> commits
Conflicts: <yes/no>

## Sync Strategy
Method: <rebase|merge>

## Conflict Resolution
<file-1>: <resolved|skipped> - <brief description>
<file-2>: <resolved|skipped> - <brief description>
...

## After Sync
Behind master: 0 commits
Ahead of master: <count> commits
Pushed: ✓ (force-with-lease)
PR mergeable: <status>

## Status Checks
<check-1>: <pass|fail|pending>
<check-2>: <pass|fail|pending>
...
```

## Error Handling

**No PR found**: "Error: No PR found for the current branch. Create one first with /create-pr"

**Dirty working directory (user declines stash)**: "Error: Working directory has uncommitted changes. Commit or stash them first."

**Force push rejected**: "Error: Force push rejected. Someone may have pushed new commits. Fetch and try again."

**Rebase conflict too complex**: "This conflict requires manual resolution. Here are the conflicted files and the changes on each side..."

**Branch already up-to-date**: "Branch is already up-to-date with master. No sync needed."

## Examples

### Example 1: Simple Sync (no conflicts)

```
/sync-pr 42

## PR Sync Report

PR: #42 - feat: add RSI indicator support
Branch: feat/rsi-indicator → master

## Before Sync
Behind master: 5 commits
Ahead of master: 3 commits
Conflicts: no

## Sync Strategy
Method: rebase

## After Sync
Behind master: 0 commits
Ahead of master: 3 commits
Pushed: ✓ (force-with-lease)
PR mergeable: MERGEABLE
```

### Example 2: Sync with Conflicts

```
/sync-pr --rebase

## PR Sync Report

PR: #87 - fix: order sync timeout handling
Branch: fix/order-sync-timeout → master

## Before Sync
Behind master: 12 commits
Ahead of master: 2 commits
Conflicts: yes (2 files)

## Sync Strategy
Method: rebase

## Conflict Resolution
apps/api/src/order/order.service.ts: resolved - kept both timeout increase and new error handling from master
apps/api/src/order/order.module.ts: resolved - merged new provider imports

## After Sync
Behind master: 0 commits
Ahead of master: 2 commits
Pushed: ✓ (force-with-lease)
PR mergeable: MERGEABLE
```

## Options

| Flag             | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `<PR number>`    | Target a specific PR (default: current branch's PR)   |
| `--rebase`       | Rebase onto master (default)                          |
| `--merge`        | Merge master into branch instead of rebasing          |
| `--auto-resolve` | Attempt to auto-resolve conflicts intelligently       |
