# Boss web application architecture

The existing CLI stays in the repository root under `src/`. The web application is added as a Bun workspace without moving CLI code.

Product scope for the first chargeable version is documented in `docs/mvp-product.md`.

## Workspaces

- `apps/web`: React + Vite + shadcn/ui admin console.
- `apps/api`: Bun + Elysia HTTP API.
- `apps/worker`: Independent scheduler and job runner process.
- `packages/shared`: Types, DTOs, schemas, and constants shared by frontend and backend.
- `packages/core`: Domain services and business rules.
- `packages/automation`: Boss browser automation boundaries.
- `packages/db`: Database schema, migrations, and repositories.
- `packages/config`: Environment parsing and runtime configuration.

## Dependency direction

```text
apps/web -> packages/shared
apps/api -> packages/config -> packages/core -> packages/shared
apps/worker -> packages/config -> packages/core -> packages/db -> packages/automation
```

Route handlers should stay thin. Worker execution owns scheduled automation. Browser automation should not live in the API process.

## CLI invocation and queueing

The web application should call existing CLI capabilities through the worker, not directly from frontend code or API request handlers.

Boss automation is intentionally slow and serialized because fast parallel execution increases risk-control exposure and produces behavior that does not look like a real operator. Low response latency is not a product goal for automation execution.

Required execution path:

```text
apps/web -> apps/api -> persisted queue -> apps/worker -> root CLI capability -> Boss page
```

Rules:

- API requests create or update queue records and return the queued state.
- Worker claims one executable item at a time per Boss account/session.
- Operations that touch the same Boss browser session must run serially.
- The frontend shows queue state, current step, elapsed time, and failure reason instead of waiting for immediate completion.
- Human-like pacing belongs in the runner layer: explicit waits, visible step boundaries, and conservative command sequencing.
- Do not optimize for throughput by adding hidden parallel execution across one account/session.
- Do not call CLI commands from route handlers as a synchronous request/response shortcut.

Queue states should be explicit:

```text
queued -> running -> succeeded
queued -> running -> failed
queued -> cancelled
```

Each run should record at least:

- queue item id
- campaign id
- Boss account/session id
- candidate or conversation id when applicable
- CLI command or capability name
- current step
- status
- started time and finished time
- clear error message with automation context

## Failure handling

Failures should be explicit and visible. Do not add fallback branches or glue code that hides root causes. Job execution should write clear failure records with enough context to locate the failing account, campaign, candidate, and automation step.
