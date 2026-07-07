# UX Harness for Onboarding

This harness drives the real Next dev app with Playwright and route-level fixtures for model-backed APIs. It keeps `/api/chats` persistence live so history, reloads, and `demo_uid` behavior are exercised through the app.

## Run

Install dependencies without downloading Playwright browsers:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

Run all flows:

```bash
npm run ux
```

Run one flow:

```bash
npm run ux -- cold-start
npm run ux -- find
npm run ux -- codex
npm run ux -- assistant
npm run ux -- doc-read
```

If the orchestrator provides a cached Chromium, pass it through:

```bash
PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium npm run ux -- cold-start
```

If `BASE_URL` is unset, the runner starts `next dev` on a free port, waits for readiness, and tears it down. If `BASE_URL` is set, the runner uses that app and does not start a server.

## Output

Each run recreates:

```text
.ux-output/
  index.html
  next-dev.log
  <flow>/
    NN-step-name.png
    console-errors.log
```

`index.html` is a self-contained contact sheet with inline CSS and relative image paths. Screenshots use `deviceScaleFactor: 2`.

## Green Now vs Spec Pending

Green-now assertions cover the current app:

- `cold-start`: current empty state and existing prompt cards.
- `find`: seeded live chat history plus fixture-ranked telescope result.
- `codex`: `@codex` command reaches a fixture `draft_ready` task.
- `assistant`: `@assistant` command reaches a fixture `ready` task with sources and artifact.
- `doc-read`: sample-shaped PDF upload, read-aloud response, and fixture TTS endpoint.

Spec-pending assertions are non-fatal probes named after the authority doc. They are recorded in the contact sheet and should flip from `pending` to `present` as the parallel onboarding implementation lands:

- Seeded starter chats appear automatically on first unified-page load.
- Prompt cards auto-submit instead of only inserting composer text.
- The first card is the Branch & merge card with `BRANCH` tag.
- The doc hint exposes `use our sample document`.
- BranchNudge appears after the branch-card reply.
- `cr:threads-woven` and the `Threads - 0/5` / `Woven - 5/5` rail states update.
