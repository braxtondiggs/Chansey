---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(git log:*)
argument-hint: [message] | --amend | --issue <number>
description: Create well-formatted commits with conventional commit format
---

# Smart Git Commit

Create well-formatted commit: $ARGUMENTS

## Current Repository State

- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Staged changes: !`git diff --cached --stat`
- Unstaged changes: !`git diff --stat`
- Recent commits: !`git log --oneline -5`

## What This Command Does

1. Checks which files are staged with `git status`
2. If 0 files are staged, automatically adds all modified and new files with `git add`
3. Performs a `git diff` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit (or the single commit if not split), creates a commit message using conventional commit format

**Note:** Do NOT run lint, build, or test checks manually — the repository has a pre-commit hook that handles this
automatically.

## Best Practices for Commits

- **Atomic commits**: Each commit should contain related changes that serve a single purpose
- **Split large changes**: If changes touch multiple concerns, split them into separate commits
- **Conventional commit format**: Use the format `<type>: <description>` where type is one of:
  - `feat`: A new feature
  - `fix`: A bug fix
  - `docs`: Documentation changes
  - `style`: Code style changes (formatting, etc)
  - `refactor`: Code changes that neither fix bugs nor add features
  - `perf`: Performance improvements
  - `test`: Adding or fixing tests
  - `chore`: Changes to the build process, tools, etc.
  - `ci`: CI/CD improvements
  - `revert`: Reverting changes
  - `wip`: Work in progress
  - `db`: Database related changes
- **Present tense, imperative mood**: Write commit messages as commands (e.g., "add feature" not "added feature")
- **Concise first line**: Keep the first line under 72 characters
- **Link GitHub issues**: When working on a tracked issue, add `Closes #<number>` on a separate line at the bottom of
  the commit body

## Guidelines for Splitting Commits

When analyzing the diff, consider splitting commits based on these criteria:

1. **Different concerns**: Changes to unrelated parts of the codebase
2. **Different types of changes**: Mixing features, fixes, refactoring, etc.
3. **File patterns**: Changes to different types of files (e.g., source code vs documentation)
4. **Logical grouping**: Changes that would be easier to understand or review separately
5. **Size**: Very large changes that would be clearer if broken down

## Examples

Good commit messages:

- feat: add user authentication system
- fix: resolve memory leak in rendering process
- docs: update API documentation with new endpoints
- refactor: simplify error handling logic in parser
- fix: resolve linter warnings in component files
- chore: improve developer tooling setup process
- feat: implement business logic for transaction validation
- fix: patch critical security vulnerability in auth flow
- feat: add input validation for user registration form

Example with issue reference (multi-line commit):

```
feat: add user authentication system

- Implement JWT-based authentication
- Add login and logout endpoints
- Create user session management

Closes #123
```

Example of splitting commits:

- First commit: feat: add new solc version type definitions
- Second commit: docs: update documentation for new solc versions
- Third commit: chore: update package.json dependencies
- Fourth commit: feat: add type definitions for new API endpoints
- Fifth commit: feat: improve concurrency handling in worker threads
- Sixth commit: fix: resolve linting issues in new code
- Seventh commit: test: add unit tests for new solc version features
- Eighth commit: fix: update dependencies with security vulnerabilities

## Command Options

- `--issue <number>` or `-i <number>`: Link the commit to a GitHub issue (adds `Closes #<number>` at the bottom of the
  commit body)
- `--amend`: Amend the previous commit instead of creating a new one

## Amend Behavior

When `--amend` is used:

1. First read the existing commit message with `git log -1 --format=%B`
2. Keep the **original subject line** (first line) — do NOT replace it
3. Analyze the new diff (`git diff HEAD~1`) to understand the full scope of the amended commit
4. **Append** new bullet points to the existing body describing only the newly added changes
5. If the original message had no body, add a blank line after the subject then add the new bullets
6. Only update the subject line if the original is clearly inaccurate after the amendment (e.g., wrong type or
   misleading description) — otherwise preserve it as-is
7. Use `git commit --amend -m "<merged message>"` with the combined result

**Example:**

Original commit message:

```
feat(api): add regime-scaled position sizing across trading stack

- Add regime multiplier lookup tables per risk level
- Integrate regime scaling into historical backtest
```

After amending with new changes:

```
feat(api): add regime-scaled position sizing across trading stack

- Add regime multiplier lookup tables per risk level
- Integrate regime scaling into historical backtest
- Extract duplicated regime computation into computeCompositeRegime() method
- Add regime gate filtering to live replay backtest
- Add tests for regime gate behavior
```

## Important Notes

- Do NOT run lint, build, or test checks — the repository's pre-commit hook handles this automatically
- If the pre-commit hook fails, fix the issues and create a NEW commit (do not amend)
- If specific files are already staged, the command will only commit those files
- If no files are staged, it will automatically stage all modified and new files
- The commit message will be constructed based on the changes detected
- Before committing, the command will review the diff to identify if multiple commits would be more appropriate
- If suggesting multiple commits, it will help you stage and commit the changes separately
- Always reviews the commit diff to ensure the message matches the changes
- When `--issue` is provided, add `Closes #<number>` on a separate line at the bottom of the commit body
- Using `Closes #<number>` automatically closes the referenced issue when the commit is merged to the default branch
