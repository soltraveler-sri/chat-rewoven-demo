# Demo guide

Step-by-step walkthroughs for every feature in Chat, rewoven. The main [README](../README.md) covers the product thinking; this doc covers the exact clicks.

The unified chat at `/` is the primary way to experience all five ideas together. Each idea also has a standalone, single-feature route (`/demos/branches`, `/demos/history`, `/demos/codex`) if you want to see one in isolation.

## Unified chat (`/`)

The unified chat combines every feature below in one thread. First-time visitors get three things automatically:

- **Four seeded sample chats** (asyncio debugging, the JWST, bond yields, a Portugal trip) so history, `/find`, and the Assistant have material immediately. Delete them and they stay deleted.
- **Example prompt cards** that run themselves when clicked — branching first, then a Codex task, an Assistant request, and a `/find` query — plus a one-click "use our sample document" action for the read-aloud flow.
- **A `Threads · 0/5` pill** in the header: a quiet progress rail listing five stageable moments, each marked woven when you actually complete the real feature. It's fully hideable and never blocks anything.

Replies stream token-by-token via server-sent events.

### 1. Branch, isolate, and merge

1. Send any message and wait for a reply.
2. Hover the assistant's reply — a "Branch from here" icon appears.
3. In the side thread, tell the assistant something specific: "The password is 'banana123.'"
4. Close the branch with the **Include in main context** toggle off (the default). A "Branch kept separate" toast confirms it.
5. Back in the main chat, ask "What's the password?" — the assistant doesn't know. The branch never touched the main conversation chain.
6. Reopen the branch chip, turn **Include in main context** on, and pick a merge mode from the **···** menu: **Include as summary** (default, a short bullet summary) or **Include full transcript** (the entire branch conversation).
7. Close the branch. A context card appears in the main chat, the branch chip turns green, and a "Branch context merged" toast confirms it.
8. Ask the main chat about the password again — it now knows. The merge is chained through the OpenAI Responses API's `previous_response_id`, and it's persisted: reload the page and the merged context is still there.

### 2. Find a past conversation

1. Have a couple of unrelated conversations first (or use existing history).
2. Type `/find` followed by a few natural-language words, e.g. `/find that chat about Kyoto`.
3. Results are ranked by an LLM rerank step and labeled by confidence: **High match** (≥0.85), **Good match** (≥0.6), or **Possible match** for lower-confidence candidates. Each result also shows a one-line reason it matched.
4. Click a result to open that conversation in place (the URL updates, so the opened chat survives a reload). In the standalone history demo's Finder, a single clear best match auto-opens; in the unified chat, opening is always an explicit click.
5. In the standalone history demo you can also trigger retrieval without the slash command — asking in plain language ("find my conversation about Python") is detected by an intent classifier and routed the same way.

### 3. Submit a Codex task

1. Type `@codex` followed by a request, e.g. `@codex add a health check endpoint that returns server uptime`. (Note the required trailing space after `@codex`.)
2. A task card appears immediately, showing status **Generating...** while the model drafts a plan and file changes. This is a real model call — completion time depends on request size, not a scripted delay.
3. When the card reaches **Ready to Apply**, expand it to see the plan, the list of affected files, and a per-file diff.
4. Click **Apply** — the workspace panel updates with the new file contents and the badge changes to **Applied**.
5. Click **Create PR** — the badge changes to **PR Created** with a link to a simulated pull request (no real GitHub repository is touched; this is demo scope by design).
6. Ask a follow-up question without `@codex`, e.g. "what does the health check endpoint do?" — the assistant answers with knowledge of the task, because completed tasks are folded back into the chat's context automatically.

### 4. Attach a document and listen to it

1. Attach a PDF or DOCX file from the composer.
2. Ask a question about it directly, or say "read this to me."
3. A lightweight classifier decides whether you want to discuss the document or hear it read aloud (clear phrasing like "read this to me" skips the classifier entirely; ambiguous phrasing falls back to it).
4. For read-aloud, audio streams in as it's generated — playback starts before the full narration finishes — through a player that stays attached to that message, so you can revisit it later in the thread.

### 5. Recover unfinished work with the Assistant

1. Type `@assistant` followed by a request that spans more than one conversation, e.g. `@assistant find unfinished work from this week`.
2. The task card moves through **Interpreting → Reviewing chats → Reviewing context → Generating → Ready**, reasoning across all of your local chats, not just the current one.
3. The result can include open loops (unfinished threads worth returning to, each with a suggested next action), a generated artifact (Markdown, CSV, or a client-converted DOCX download), and drafted follow-up `@codex` prompts.
4. Sources are cited back to the specific chats the assistant drew from, so you can check its reasoning rather than take it on faith.

## Standalone demos

These are single-feature implementations kept separate from the unified chat, useful for showing one idea in isolation.

### `/demos/branches` — branch overlay

Follow the same steps as "Branch, isolate, and merge" above. This route exists purely to demonstrate context isolation and merging without the other four features competing for attention.

### `/demos/history` — persistent history, Smart Stacks, and Finder

1. Click **+** in the sidebar and start a few different conversations (e.g. travel planning, a coding question, a work email). Each is auto-titled and summarized on save.
2. Switch to **Browse** mode (layers icon) and click **Refresh Stacks** — every chat is sent to the model for categorization. Categories in use: Professional, Coding, Personal, Travel, Shopping, and Short Q&A, plus a default "Recent" bucket for anything uncategorized.
3. Click a category to filter, and use the search bar to narrow further.
4. Switch to **Finder** mode (search icon) and try a natural-language query — see "Find a past conversation" above for how results and confidence labels work.
5. Start a new chat, click **+** in the composer to open the chat picker, and attach a previous conversation as context — the attached chat's summary is included when you ask a follow-up.

### `/demos/codex` — code task workspace

Follow the same steps as "Submit a Codex task" above. This route also exposes a **Workspace** panel in the header showing the full (mock) file tree and live file contents as tasks are applied.

## Notes on accuracy

This guide is kept in sync with the actual UI copy (button labels, toast text, status labels) rather than paraphrased, so it should match what you see exactly. If something here doesn't match the live app, the app has moved since this was last updated — file an issue or check `git log` on this file.
