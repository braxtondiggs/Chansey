---
allowed-tools: Bash(gh *), Bash(git remote*), mcp__github__create_issue, mcp__github__list_issues, Read, Glob
argument-hint: <title> [--assignee <user>] [--milestone <name>] [--project <name>] [--from-plan] [--no-project]
description: Create a GitHub issue from conversation context or planning session
---

# Create GitHub Issue

Create a GitHub issue: $ARGUMENTS

## Current Repository

- Remote URL: !`git remote get-url origin 2>/dev/null || echo "not a git repo"`
- Current branch: !`git branch --show-current 2>/dev/null || echo "unknown"`
- Available labels: !`gh label list --json name --jq '.[].name' 2>/dev/null | tr '\n' ', ' | sed 's/,$//'`
- Available projects:
  !`gh project list --owner braxtondiggs --format json --jq '.projects[] | "\(.number): \(.title)"' 2>/dev/null | tr '\n' ', ' | sed 's/,$//'`

## Task Overview

Create a well-structured GitHub issue capturing requirements, context, and implementation notes from the current
conversation or planning session. Automatically labels from existing repo labels, adds to GitHub project with
AI-determined priority and size.

## Step 1: Parse Arguments and Detect Repository

Extract from git remote if not specified:

```bash
git remote get-url origin | sed -E 's/.*[:/]([^/]+)\/([^/.]+)(\.git)?$/\1 \2/'
```

**Arguments:**

- `<title>`: Issue title (required, or will be generated from context)
- `--assignee <user>`: Assign to user
- `--milestone <name>`: Add to milestone
- `--project <name>`: GitHub project name (default: "Backtest MVP")
- `--from-plan`: Extract context from recent plan files
- `--draft`: Create as draft (adds `[DRAFT]` prefix)
- `--no-project`: Skip adding to GitHub project

## Step 2: Gather Context

### From Conversation

Analyze the current conversation to extract:

- Problem description or feature request
- Requirements discussed
- Technical considerations mentioned
- Acceptance criteria if defined
- Any code snippets or examples shared

### From Plan Files (if `--from-plan`)

Check for recent planning artifacts:

```bash
# Check for speckit plan files
ls -la .specify/features/*/spec.md 2>/dev/null | head -5
ls -la .specify/features/*/plan.md 2>/dev/null | head -5
```

Read relevant plan files to extract:

- Feature specification
- Technical design decisions
- Implementation notes
- Task breakdown

## Step 3: Generate Issue Content

### Title Guidelines

- Use imperative mood: "Add...", "Fix...", "Update..."
- Be specific: "Add RSI indicator to strategy builder" not "Add indicator"
- Include scope if helpful: "[API] Add rate limiting to auth endpoints"
- Keep under 72 characters

### Body Template

```markdown
## Summary

[1-2 sentence overview of what needs to be done]

## Background

[Why is this needed? What problem does it solve?]

## Requirements

- [ ] Requirement 1
- [ ] Requirement 2
- [ ] Requirement 3

## Technical Notes

[Any implementation details, architectural decisions, or constraints discussed]

## Acceptance Criteria

- [ ] Criteria 1
- [ ] Criteria 2

## Additional Context

[Links, screenshots, related issues, or other relevant information]
```

## Step 4: Auto-Label from Existing Labels

**IMPORTANT: Only use labels that exist in the repository. NEVER suggest or create new labels.**

First, fetch the repository's existing labels:

```bash
gh label list --json name,description --jq '.[] | "\(.name): \(.description)"'
```

Then match issue content against ONLY these existing labels:

| Content Pattern                                   | Match to Existing Label |
| ------------------------------------------------- | ----------------------- |
| "bug", "fix", "broken", "error", "crash"          | `bug`                   |
| "add", "new feature", "implement", "create"       | `enhancement`           |
| "refactor", "clean up", "restructure"             | `refactor`              |
| "docs", "documentation", "readme"                 | `documentation`         |
| "test", "coverage", "spec", "unit test"           | `testing`               |
| "security", "vulnerability", "auth", "permission" | `security`              |
| "performance", "slow", "optimize", "speed"        | `performance`           |
| "api", "endpoint", "REST", "controller"           | `api`                   |
| "ui", "component", "angular", "template"          | `frontend`              |
| "nestjs", "service", "module", "provider"         | `backend`               |
| "database", "migration", "typeorm", "entity"      | `database`              |
| "ci", "deploy", "docker", "pipeline"              | `infrastructure`        |
| "algorithm", "indicator", "signal", "strategy"    | `algorithms`            |
| "exchange", "ccxt", "binance", "coinbase"         | `exchange`              |
| "backtest", "historical", "simulation"            | `backtest`              |
| "paper", "simulated", "demo"                      | `papertest`             |
| "risk", "drawdown", "limit", "safety"             | `risk-management`       |
| "monitor", "alert", "drift", "anomaly"            | `monitoring`            |
| "strategy", "deploy", "execution"                 | `strategy`              |

**Label Selection Rules:**

1. Only select labels that exist in the repository
2. Select 1-3 most relevant labels (avoid over-labeling)
3. If no clear match, default to `enhancement` for features or `bug` for issues
4. Never create new labels - skip if no match

## Step 5: Determine Priority and Size

Analyze the issue to determine AI-recommended priority and size for the GitHub project.

### Priority Assessment

| Priority      | Criteria                                                              |
| ------------- | --------------------------------------------------------------------- |
| 🌋 **Urgent** | Critical bug, security issue, blocking other work, production impact  |
| 🏔 **High**   | Important feature, significant bug, deadline-driven, high user impact |
| 🏕 **Medium** | Standard feature/bug, moderate impact, normal priority                |
| 🏝 **Low**    | Nice-to-have, minor improvement, can wait, low impact                 |

**Consider:**

- Is this blocking other work?
- Does it affect production/users?
- Is there a deadline?
- How many users/systems are impacted?

### Size Assessment

| Size           | Criteria                                                                |
| -------------- | ----------------------------------------------------------------------- |
| 🐋 **X-Large** | Major feature, multiple systems, 2+ weeks effort, architectural changes |
| 🦑 **Large**   | Significant feature, multiple files/modules, 1-2 weeks effort           |
| 🐂 **Medium**  | Standard feature/fix, several files, few days effort                    |
| 🐇 **Small**   | Simple change, 1-3 files, day or less effort                            |
| 🦔 **Tiny**    | Trivial fix, single file, quick change                                  |

**Consider:**

- How many files/modules affected?
- Does it require database changes?
- Does it need new APIs or UI components?
- How much testing is needed?
- Any external dependencies or integrations?

## Step 6: Check for Duplicates

Before creating, search for similar issues:

```bash
gh issue list --state open --search "<key terms from title>" --limit 5
```

If potential duplicates found, warn user and ask to confirm.

## Step 7: Create the Issue

Use `mcp__github__create_issue` with:

- `owner`: Repository owner
- `repo`: Repository name
- `title`: Generated or provided title
- `body`: Formatted issue body
- `labels`: Array of matched existing label names only
- `assignees`: Array of usernames (if specified)

## Step 8: Add to GitHub Project

Unless `--no-project` is specified, add the issue to the GitHub project with initial triage values.

### 8a: Resolve Project

If `--project <name>` is provided, use that project. Otherwise default to "Backtest MVP".

```bash
# List available projects and find the one matching the name
gh project list --owner braxtondiggs --format json --jq '.projects[] | select(.title == "<project_name>") | "\(.number) \(.id)"'
```

### 8b: Get Project Field IDs

Dynamically fetch the project's field IDs for Status, Priority, and Size:

```bash
# Get project fields
gh project field-list <project_number> --owner braxtondiggs --format json

# Extract field IDs for Status, Priority, Size
# Look for fields named "Status", "Priority", "Size"
```

### 8c: Get Field Options

For each single-select field, fetch the available options:

```bash
# Get Status options
gh api graphql -f query='
query {
  user(login: "braxtondiggs") {
    projectV2(number: <project_number>) {
      field(name: "Status") {
        ... on ProjectV2SingleSelectField { options { id name } }
      }
    }
  }
}'

# Similarly for Priority and Size fields
```

### 8d: Add Issue and Set Fields

```bash
# Add issue to project
gh project item-add <project_number> --owner braxtondiggs --url <issue_url>

# Get the item ID
ITEM_ID=$(gh project item-list <project_number> --owner braxtondiggs --format json --jq '.items[] | select(.content.url == "<issue_url>") | .id')

# Set Status to first "Exploration" or similar status option
gh project item-edit --project-id <project_id> --id $ITEM_ID --field-id <status_field_id> --single-select-option-id <exploration_option_id>

# Set Priority (AI determined)
gh project item-edit --project-id <project_id> --id $ITEM_ID --field-id <priority_field_id> --single-select-option-id <priority_option_id>

# Set Size (AI determined)
gh project item-edit --project-id <project_id> --id $ITEM_ID --field-id <size_field_id> --single-select-option-id <size_option_id>
```

### Default Project: Backtest MVP (Project #7)

For quick reference when using the default project:

**Project Field IDs:**

- Project ID: `PVT_kwHOAGlYMs4A7M2q`
- Status Field: `PVTSSF_lAHOAGlYMs4A7M2qzgvkeBE`
- Priority Field: `PVTSSF_lAHOAGlYMs4A7M2qzgvkeBs`
- Size Field: `PVTSSF_lAHOAGlYMs4A7M2qzgvkeBw`

**Status Options (always use Exploration for new issues):**

- 🔬 Exploration: `054bea99`

**Priority Options:**

- 🌋 Urgent: `fae9bf39`
- 🏔 High: `1bd0113f`
- 🏕 Medium: `12e82a1b`
- 🏝 Low: `cfa49def`

**Size Options:**

- 🐋 X-Large: `1156815d`
- 🦑 Large: `b8e3b76b`
- 🐂 Medium: `bd0eb285`
- 🐇 Small: `a5cffe4e`
- 🦔 Tiny: `90fa5d5b`

### Handling Missing Fields

If the target project doesn't have Status, Priority, or Size fields:

- Skip setting that field
- Warn user: "Note: Project '{name}' doesn't have a {field} field. Skipping."

## Step 9: Post-Creation

After creating:

1. Display the issue URL
2. Show issue number for reference
3. Show project assignment details
4. Suggest next steps

## Output Format

```
## Issue Created

**Title**: {title}
**Number**: #{number}
**URL**: {url}

### Labels (auto-detected)
{labels}

### Project Assignment
- **Project**: {project_name}
- **Status**: 🔬 Exploration
- **Priority**: {priority} - {reason}
- **Size**: {size} - {reason}

### Body Preview
{first 500 chars of body}...

## Next Steps

- Create branch: `git checkout -b issue-{number}-{short-title}`
- Start work: `/implement-issue {number}`
- View issue: `gh issue view {number}`
- View in project: `gh project item-list 7 --owner braxtondiggs`
```

## Error Handling

**No title or context**: "Error: Please provide a title or ensure there's conversation context to extract from."

**Repository not found**: "Error: Could not detect repository. Specify with: /create-issue --owner foo --repo bar
'Title'"

**No matching labels**: "Note: No existing labels matched the issue content. Issue created without labels."

**Project not found**: "Error: Project '{name}' not found. Available projects: {list}. Use --no-project to skip."

**Project add failed**: "Warning: Could not add to GitHub project. Issue created successfully. Add manually: gh project
item-add <number> --owner braxtondiggs --url {url}"

**Duplicate detected**: "Warning: Similar issue found: #{number} '{title}'. Continue anyway? (y/n)"

## Examples

### Example 1: Quick Issue from Title

```
/create-issue Add WebSocket support for real-time price updates
```

- Auto-labels: `enhancement`, `api`, `frontend`
- Priority: 🏕 Medium (standard feature)
- Size: 🦑 Large (multiple systems)

### Example 2: Bug Report

```
/create-issue "Fix memory leak in order sync causing crashes"
```

- Auto-labels: `bug`, `backend`
- Priority: 🏔 High (causes crashes)
- Size: 🐂 Medium (specific fix)

### Example 3: From Planning Session

```
/create-issue --from-plan
```

Extracts everything from speckit plan files.

### Example 4: Skip Project

```
/create-issue "Quick doc fix" --no-project
```

Creates issue without adding to GitHub project.

### Example 5: Assigned with Milestone

```
/create-issue "Add RSI divergence detection" --assignee braxtondiggs --milestone "v1.0"
```

### Example 6: Specific Project

```
/create-issue "Implement order book visualization" --project "Trading UI"
```

Uses "Trading UI" project instead of default "Backtest MVP".

## Issue Type Templates

### Bug Report

```markdown
## Bug Description

[What's happening]

## Expected Behavior

[What should happen]

## Steps to Reproduce

1. Step 1
2. Step 2

## Environment

- Branch: {current_branch}
- Node: {node_version}
```

### Feature Request

```markdown
## Summary

[What feature to add]

## Motivation

[Why it's needed]

## Proposed Solution

[How to implement]

## Alternatives Considered

[Other approaches]
```

### Refactoring Task

```markdown
## Current State

[What exists now]

## Proposed Changes

[What to change]

## Benefits

[Why refactor]

## Risks

[What could break]
```
