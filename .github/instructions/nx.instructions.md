---
applyTo: '**'
---

You are in an nx workspace using Nx 20.3.2 and npm as the package manager. This is an Angular/NestJS monorepo with:

- Frontend Angular app (chansey)
- Backend NestJS API app (api)
- Shared TypeScript interfaces (api-interfaces)
- End-to-end tests using Cypress (chansey-e2e)

You have access to the Nx MCP server and the tools it provides. Use them. Follow these guidelines in order to best help
the user:

# General Guidelines

- When answering questions, use the nx_workspace tool first to gain an understanding of the workspace architecture
- For questions around nx configuration, best practices or if you're unsure, use the nx_docs tool to get relevant,
  up-to-date docs!! Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the 'nx_workspace' tool to get any errors
- To help answer questions about the workspace structure or simply help with demonstrating how tasks depend on each
  other, use the 'nx_visualize_graph' tool

# Available Commands (from package.json)

The workspace has these npm scripts available - ALWAYS use these instead of guessing commands:

## Development Commands

- `npm start` - Start all projects in parallel (both API and frontend) [nx run-many --parallel --target=serve --all]
- `npm run api` - Start only the NestJS API [nx serve api]
- `npm run site` - Start only the Angular frontend [nx serve chansey]
- `npm run start:prod` - Start production build of API [node dist/api/main.js]

## Build & Test Commands

- `npm run build` - Build all projects [nx run-many --target=build --all]
- `npm test` - Run tests for all projects [nx run-many --target=test --all]
- `npm run lint` - Lint all projects [nx run-many --target=lint --all]
- `npm run e2e` - Run end-to-end tests [ng e2e]

## Analysis & Maintenance

- `npm run dep-graph` - View dependency graph [nx dep-graph]
- `npm run analyze:site` - Analyze the Angular bundle [npx nx analyze chansey]
- `npm run format` - Format code (excludes node_modules and JSON) [nx format:write --exclude ./node_modules,*.json]
- `npm run format:check` - Check code formatting [nx format:check --exclude ./node_modules]
- `npm run format:tailwind` - Format Tailwind classes in HTML files [prettier --write "apps/chansey/src/**/*.html"
  --config .prettierrc]

## Affected Commands (for incremental builds/tests)

- `npm run affected` - Run affected command [nx affected]
- `npm run affected:apps` - List affected apps [nx affected:apps]
- `npm run affected:libs` - List affected libraries [nx affected:libs]
- `npm run affected:build` - Build only affected projects [nx affected:build]
- `npm run affected:test` - Test only affected projects [nx affected:test]
- `npm run affected:lint` - Lint only affected projects [nx affected:lint]
- `npm run affected:e2e` - E2E test only affected projects [nx affected:e2e]
- `npm run affected:dep-graph` - Show dependency graph for affected projects [nx affected:dep-graph]

## Utility Commands

- `npm run update` - Update Nx workspace [nx migrate latest]
- `npm run workspace-generator` - Run workspace generators [nx workspace-generator]
- `npm run prepare` - Prepare git hooks [husky]

When suggesting commands to users, ALWAYS reference these npm scripts rather than raw nx commands.

# Generation Guidelines

If the user wants to generate something, use the following flow:

## For Angular components/services/modules (Frontend)

- Learn about the nx workspace and any specifics the user needs by using the 'nx_workspace' tool and the
  'nx_project_details' tool to examine the 'chansey' project
- Use '@nx/angular:component', '@nx/angular:service', '@nx/angular:module', or other Angular generators
- Get generator details using the 'nx_generator_schema' tool
- Consider setting the 'project' option to 'chansey' by default for frontend code
- If generating components, prefer standalone components unless the user specifically asks for NgModules

## For NestJS resources (Backend)

- Learn about the nx workspace and any specifics the user needs by using the 'nx_workspace' tool and the
  'nx_project_details' tool to examine the 'api' project
- Use '@nx/nest:resource', '@nx/nest:controller', '@nx/nest:service', or other NestJS generators
- Get generator details using the 'nx_generator_schema' tool
- Consider setting the 'project' option to 'api' by default for backend code
- Check existing NestJS modules in the api project to understand the architectural patterns

## For shared interfaces/models

- Consider adding them to the 'api-interfaces' library to be shared between frontend and backend
- Use '@nx/js:library' if the user needs a new shared library

## General steps for all generators

- Get the available generators using the 'nx_generators' tool
- Decide which generator to use based on the user's requirements
- Get generator details using the 'nx_generator_schema' tool
- You may use the 'nx_docs' tool to learn more about a specific generator or technology if you're unsure
- Decide which options to provide in order to best complete the user's request. Don't make any assumptions and keep the
  options minimalistic
- Open the generator UI using the 'nx_run_generator' tool
- Use the information provided in the result to answer the user's question or continue with what they were doing

# Testing Guidelines

When helping with tests or creating new tests:

## Unit Testing (Vitest)

- Use Vitest for unit testing both frontend and backend code
- The workspace is configured with @analogjs/vitest-angular for Angular testing
- For Angular components, use TestBed and appropriate test utilities
- Mock dependencies appropriately to isolate the unit being tested
- For services that make HTTP calls, use HttpClientTestingModule
- For NestJS, use the NestJS testing module to create test modules
- Vitest configuration supports coverage reporting with @vitest/coverage-v8
- Tests run with the `nx test` command or project-specific `nx test <project>` commands

## End-to-End Testing (Cypress)

- Use Cypress for end-to-end tests of the Angular application
- Follow the existing patterns in the chansey-e2e project
- Use data-test attributes for selecting elements in tests
- Implement proper waiting strategies rather than arbitrary timeouts

# CI Error Guidelines

If the user wants help with fixing an error in their CI pipeline, use the following flow:

- Retrieve the list of current CI Pipeline Executions (CIPEs) using the 'nx_cloud_cipe_details' tool
- If there are any errors, use the 'nx_cloud_fix_cipe_failure' tool to retrieve the logs for a specific task
- Use the task logs to see what's wrong and help the user fix their problem. Use the appropriate tools if necessary
- Make sure that the problem is fixed by running the task that you passed into the 'nx_cloud_fix_cipe_failure' tool

# Code Quality Guidelines

When writing or modifying code:

## Angular (Frontend) Guidelines

- Use Angular best practices and follow the Angular style guide
- Prefer standalone components, directives, and pipes over NgModules when possible
- Use strongly typed inputs/outputs with explicit types rather than 'any'
- Use RxJS properly with appropriate error handling and subscription management
- Implement OnDestroy and unsubscribe from observables to prevent memory leaks
- Follow the component/container pattern where appropriate
- Use Angular services for shared state management and API calls

## NestJS (Backend) Guidelines

- Follow NestJS architectural patterns with controllers, services, and modules
- Properly segregate concerns between different layers of the application
- Use appropriate decorators for dependency injection
- Implement proper validation with DTOs using class-validator
- Use proper error handling with filters and exception handling
- Ensure proper security practices with authentication guards

## General Guidelines

- Write self-documenting code with descriptive variable/function names
- Include comments only when they clarify complex logic or provide context that code alone cannot express
- Document "why" decisions were made, not "what" the code does
- Use JSDoc comments for public APIs and interfaces
- For complex algorithms or business logic, add concise explanatory comments
- Keep code clean and readable to minimize the need for comments
- Update any existing comments when changing related code
