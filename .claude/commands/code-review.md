---
allowed-tools: Read, Bash, Grep, Glob
argument-hint: [file-path] | [commit-hash] | --full
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
- Build status: !`npm run build --dry-run 2>/dev/null || echo "No build script"`

## Task

Follow these steps to conduct a thorough code review. For each step, think deeply before writing — analyze the code
carefully, consider multiple perspectives, and challenge your own assumptions.

1. **Repository Analysis**
   - Examine the repository structure and identify the primary language/framework
   - Check for configuration files (package.json, requirements.txt, Cargo.toml, etc.)
   - Review README and documentation for context

2. **Code Quality Assessment**
   - Scan for code smells, anti-patterns, and potential bugs
   - Check for consistent coding style and naming conventions
   - Identify unused imports, variables, or dead code
   - Review error handling and logging practices
   - Think through: Are there subtle logic errors that tests might miss? Are there implicit assumptions that could break
     under different conditions?

3. **Security Review**
   - Look for common security vulnerabilities (SQL injection, XSS, etc.)
   - Check for hardcoded secrets, API keys, or passwords
   - Review authentication and authorization logic
   - Examine input validation and sanitization
   - Think through: What attack vectors exist? Could an authenticated user escalate privileges? Are there TOCTOU races
     or other timing-based vulnerabilities?

4. **Performance Analysis**
   - Identify potential performance bottlenecks
   - Check for inefficient algorithms or database queries
   - Review memory usage patterns and potential leaks
   - Analyze bundle size and optimization opportunities
   - Think through: What happens at 10x or 100x scale? Are there N+1 query patterns? Could caching introduce stale data
     issues?

5. **Architecture & Design**
   - Evaluate code organization and separation of concerns
   - Check for proper abstraction and modularity
   - Review dependency management and coupling
   - Assess scalability and maintainability
   - Think through: Does the architecture support the system's actual usage patterns? Are there hidden coupling points
     that would make changes expensive?

6. **Testing Coverage**
   - Check existing test coverage and quality
   - Identify areas lacking proper testing
   - Review test structure and organization
   - Suggest additional test scenarios
   - Think through: Do tests verify behavior or implementation? Are there critical paths without test coverage? Could
     tests pass while hiding real bugs?

7. **Documentation Review**
   - Evaluate code comments and inline documentation
   - Check API documentation completeness
   - Review README and setup instructions
   - Identify areas needing better documentation

8. **Deep Synthesis & Recommendations** Before writing recommendations, step back and consider the full picture:
   - What are the interconnections between the issues found?
   - Are there root causes that explain multiple symptoms?
   - What is the highest-leverage change that would address the most issues?

   Then provide:
   - Prioritize issues by severity (critical, high, medium, low)
   - Provide specific, actionable recommendations with file paths and line numbers
   - Suggest tools and practices for improvement
   - Create a summary report with next steps
   - Include confidence levels for each finding (how certain are you this is actually a problem?)

Remember to be constructive and provide specific examples with file paths and line numbers where applicable.
