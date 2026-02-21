---
allowed-tools: Bash(gh *), Bash(git remote*), mcp__github__get_issue, Read, Glob, Grep, EnterPlanMode
argument-hint: <issue-number> [--owner <owner>] [--repo <repo>]
description: Read a GitHub issue with comments and create an implementation plan
---

# Implement GitHub Issue

Analyze GitHub issue and plan implementation: $ARGUMENTS

## Current Repository

- Remote URL: !`git remote get-url origin 2>/dev/null || echo "not a git repo"`
- Current branch: !`git branch --show-current 2>/dev/null || echo "unknown"`

## Task Overview

Read a GitHub issue by number, gather all context including comments, then enter plan mode to design the best implementation approach.

## Step 1: Parse Arguments and Detect Repository

Extract the issue number from arguments. If `--owner` and `--repo` are not provided, detect from git remote:

```bash
# Parse owner/repo from git remote URL
# Handles both SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
git remote get-url origin | sed -E 's/.*[:/]([^/]+)\/([^/.]+)(\.git)?$/\1 \2/'
```

**Required**: Issue number (first positional argument or the number in arguments)

## Step 2: Fetch Issue Details

Use the GitHub MCP tool `mcp__github__get_issue` to retrieve:

- Issue title
- Issue body/description
- Labels
- Assignees
- State (open/closed)
- Milestone

## Step 3: Fetch ALL Issue Comments

Fetch every comment on the issue — do NOT skip any. Every comment may contain requirements, constraints, or decisions that must be reflected in the implementation.

```bash
gh api repos/{owner}/{repo}/issues/{issue_number}/comments --paginate --jq '.[] | "---\n**@\(.user.login)** commented on \(.created_at):\n\n\(.body)\n"'
```

**IMPORTANT**: Use `--paginate` to ensure all comments are retrieved, not just the first page.

## Step 4: Analyze and Summarize

After fetching the issue and comments, create a structured summary. **Every comment must be read and categorized** — do not skip or gloss over any.

### Issue Summary Template

```markdown
## Issue #{number}: {title}

**Status**: {state}
**Labels**: {labels}
**Assignees**: {assignees}

### Description

{body}

### Discussion ({comment_count} comments)

{formatted_comments}

### Key Requirements Extracted

1. [Requirement 1 from issue description]
2. [Requirement 2 from comments/discussion]
3. ...

### Action Items from Comments

For EVERY comment that contains a suggestion, request, or concern, create an explicit action item:

| # | Source | Action Item | Disposition |
|---|--------|-------------|-------------|
| 1 | @user (comment date) | [What they asked for] | [Will address / Out of scope / Already handled — with reason] |
| 2 | ... | ... | ... |

**Every comment must appear in this table.** Informational-only comments (e.g., "LGTM", CI status) can be grouped as "No action needed" but must still be listed.

### Technical Considerations

- [Technical consideration 1]
- [Technical consideration 2]
- ...

### Open Questions

- [Any unresolved questions from the discussion]
```

## Step 5: Enter Plan Mode

After summarizing the issue, use `EnterPlanMode` to:

1. Explore the codebase to understand where changes need to be made
2. Identify affected files and components
3. Design an implementation approach
4. Create a step-by-step plan for the user to approve

### Plan Mode Focus Areas

When planning, consider:

- **Architecture fit**: How does this feature fit into the existing architecture?
- **Affected components**: What existing code will be modified?
- **New components**: What new files/modules need to be created?
- **Testing strategy**: How will this be tested?
- **Migration/compatibility**: Any database changes or breaking changes?
- **Dependencies**: Any new dependencies required?

### Comment Traceability (REQUIRED)

The implementation plan MUST address every action item from the comments table in Step 4. For each item with disposition "Will address":

- Map it to a specific step in the plan
- If a comment's concern is handled implicitly by the design, call that out explicitly

**Do NOT finalize the plan until every comment action item is accounted for.** This prevents review feedback from being silently dropped.

## Output Format

```
## GitHub Issue Analysis

### Issue Details
[Issue summary as structured above]

### Codebase Context
[Relevant findings from codebase exploration]

### Proposed Implementation Plan
[High-level approach before entering plan mode]

---
Entering plan mode for detailed implementation design...
```

## Error Handling

**Issue not found**: "Error: Issue #{number} not found in {owner}/{repo}. Verify the issue number and repository."

**No access**: "Error: Unable to access {owner}/{repo}. Check your GitHub authentication with: gh auth status"

**No issue number provided**: "Error: Please provide an issue number. Usage: /implement-issue 123"

## Examples

### Example 1: Basic Usage

```
/implement-issue 42
```

Reads issue #42 from the current repository and plans implementation.

### Example 2: Specific Repository

```
/implement-issue 123 --owner anthropics --repo claude-code
```

Reads issue #123 from anthropics/claude-code repository.

### Example 3: With Issue URL

```
/implement-issue https://github.com/owner/repo/issues/456
```

Parses the URL to extract owner, repo, and issue number.
