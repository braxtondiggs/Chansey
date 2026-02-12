---
allowed-tools: Bash(gh *), Bash(git *), Read, Glob, Grep, Edit, Write, EnterPlanMode
argument-hint: <pr-number> [--bot <bot-name>] [--apply]
description: Review AI bot comments on a PR, evaluate their merit, and optionally implement worthwhile suggestions
---

# Review AI Bot PR Comments

Review and triage AI bot suggestions on PR: $ARGUMENTS

## Current State

- Repository: !`git remote get-url origin 2>/dev/null | sed -E 's/.*[:/]([^/]+\/[^/.]+)(\.git)?$/\1/'`
- Current branch: !`git branch --show-current`
- Default branch: !`git remote show origin 2>/dev/null | grep 'HEAD branch' | cut -d: -f2 | tr -d ' ' || echo "master"`

## Task

Fetch AI code review bot comments from a GitHub PR, evaluate each suggestion against the actual codebase, and present a
prioritized assessment. Optionally apply the worthwhile changes.

### 1. Parse Arguments

- **Required**: PR number (first positional argument)
- **Optional**: `--bot <name>` — filter to a specific bot (default: auto-detect common bots)
- **Optional**: `--apply` — after review, implement the approved suggestions

Common AI review bots to look for:

- `gemini-code-assist[bot]` / `google-gemini-code-assist`
- `github-actions[bot]` (when running AI review actions)
- `coderabbitai[bot]`
- `copilot[bot]` / `github-copilot[bot]`
- Any username containing `bot` in the PR comments

### 2. Fetch PR Details and Comments

Get the PR metadata:

```bash
gh pr view <pr-number> --json title,body,headRefName,baseRefName,changedFiles,files
```

Get all review comments (inline code comments):

```bash
gh api repos/{owner}/{repo}/pulls/<pr-number>/comments --paginate --jq '.[] | select(.user.login | test("bot|gemini|copilot|coderabbit|ai"; "i")) | {id: .id, user: .user.login, path: .path, line: .line, original_line: .original_line, side: .side, body: .body, diff_hunk: .diff_hunk, created_at: .created_at}'
```

Also get issue-level comments (some bots post summary comments):

```bash
gh api repos/{owner}/{repo}/issues/<pr-number>/comments --paginate --jq '.[] | select(.user.login | test("bot|gemini|copilot|coderabbit|ai"; "i")) | {id: .id, user: .user.login, body: .body, created_at: .created_at}'
```

If `--bot` is specified, filter to only that bot's username.

If no bot comments are found with the filter, fall back to listing ALL commenters so the user can identify the bot:

```bash
gh api repos/{owner}/{repo}/pulls/<pr-number>/comments --jq '.[].user.login' | sort -u
```

### 3. Read Relevant Source Files

For each inline review comment, read the actual source file it references to understand the full context (not just the
diff hunk).

### 4. Evaluate Each Comment

For every bot suggestion, assess it on these criteria:

| Criteria        | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| **Correctness** | Is the bot's analysis technically accurate?                  |
| **Relevance**   | Does it apply to this codebase's patterns and conventions?   |
| **Impact**      | Would implementing this meaningfully improve the code?       |
| **Effort**      | How much work is needed vs the benefit gained?               |
| **Risk**        | Could this change introduce bugs or break existing behavior? |

Assign each comment a verdict:

- **IMPLEMENT** — The suggestion is correct, valuable, and low-risk. Worth doing.
- **CONSIDER** — Has merit but needs adjustment, or is a style preference. Discuss with user.
- **SKIP** — Incorrect, irrelevant, too noisy, or not worth the effort.

### 5. Present Results

Format the assessment as:

```markdown
## PR #<number>: <title>

### Bot: <bot-username> — <total> comments reviewed

---

### IMPLEMENT (<count>)

#### 1. <file>:<line> — <short description>

**Bot says**: <brief summary of suggestion> **Assessment**: <why this is worth doing> **Suggested fix**:
<concrete code change or approach>

---

### CONSIDER (<count>)

#### 1. <file>:<line> — <short description>

**Bot says**: <brief summary of suggestion> **Assessment**: <pros/cons, why it needs discussion>

---

### SKIP (<count>)

#### 1. <file>:<line> — <short description>

**Bot says**: <brief summary of suggestion> **Why skip**: <brief reason — e.g., false positive, style nit, already
handled>

---

### Summary

| Verdict   | Count |
| --------- | ----- |
| IMPLEMENT | <n>   |
| CONSIDER  | <n>   |
| SKIP      | <n>   |

**Recommendation**: <1-2 sentence overall take>
```

### 6. Apply Changes (if --apply)

If `--apply` flag is passed or the user confirms they want to implement:

1. **Enter Plan Mode first** using `EnterPlanMode` — present a concrete implementation plan that covers:
   - Which IMPLEMENT items will be changed
   - Which CONSIDER items (if any) the user wants included
   - The specific files and code sections affected
   - The order of changes and any dependencies between them
   - Potential risks or side effects to watch for
2. **Wait for user approval** of the plan before making any code changes
3. Once approved, apply each change from the plan
4. After all changes, run the linter to verify: `nx affected:lint`
5. Show a summary of what was changed
6. Do NOT commit — leave changes unstaged for user to review

If `--apply` is NOT passed, ask the user which suggestions (if any) they'd like to implement. If they confirm, follow
the same plan-first flow above.

## Error Handling

**PR not found**: "Error: PR #<number> not found. Verify the PR number and repository access."

**No bot comments found**: "No AI bot comments found on PR #<number>. Commenters on this PR: <list>. Use
`--bot <username>` to specify."

**No PR number provided**: "Error: Please provide a PR number. Usage: /review-pr-comments 177"

## Examples

### Example 1: Basic Usage

```
/review-pr-comments 177
```

Reviews all AI bot comments on PR #177 and presents assessment.

### Example 2: Specific Bot

```
/review-pr-comments 177 --bot gemini-code-assist[bot]
```

Only reviews comments from the Gemini code assist bot.

### Example 3: Auto-Apply

```
/review-pr-comments 177 --apply
```

Reviews comments and automatically implements the worthwhile ones.
