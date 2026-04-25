# LLM Chat Demos

Product improvements to LLM chat interfaces, showcasing better UX patterns for AI conversations. Three standalone demos explore different interaction models -- branching, persistent history with semantic search, and AI code generation -- plus a unified interface that combines them all.

## Features

- **Branch Overlay Demo** - Context isolation and merging via conversation branches with visual tree navigation
- **History Demo** - Persistent chat threads with Smart Stacks categorization, semantic search, and an AI-powered chat finder
- **Codex Demo** - Natural language code generation with a simulated workspace, apply/PR workflow, and progress visualization
- **Unified Demo** - All features integrated in a single chat interface (default landing page)

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS v4
- shadcn/ui (Radix-based components)
- OpenAI Responses API

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Copy the environment template and add your OpenAI API key:
```bash
cp .env.example .env.local
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Your OpenAI API key ([get one here](https://platform.openai.com/api-keys)) |

### Model Configuration

The app uses different models for different request types (chat, summarization, intent classification, Assistant artifact generation, code generation, etc.). Defaults are `gpt-5-mini` for chat/search/Assistant, `gpt-5-nano` for lightweight tasks like summarization and classification, and `gpt-5.1-codex-mini` for code generation. Assistant quality can be tuned independently with `OPENAI_MODEL_ASSISTANT`, `OPENAI_ASSISTANT_REASONING`, and `OPENAI_ASSISTANT_VERBOSITY`. See [`.env.example`](.env.example) for the complete reference with defaults and explanations.

### Storage

The app supports two Redis env var patterns for production persistence:

| Option | Env Vars |
|--------|----------|
| **Upstash Redis** (preferred) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Vercel KV style** | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |

You only need one pair. The app detects whichever is available (Upstash checked first).

**Local Development:** Leave all storage variables blank. The app uses an in-memory store (data is lost on restart, but that's fine for development).

**Production:** Redis is recommended for reliable persistence. Without it, the app falls back to in-memory storage and displays a warning banner.

**Storage Details:**
- **Resilient fallback:** The app never fails due to missing Redis -- it falls back gracefully with a UI warning
- **TTL:** All data expires after 7 days to prevent unbounded growth
- **Namespacing:** Keys are prefixed with user ID (`u:{demo_uid}:...`)
- **Identity:** Users are identified by a `demo_uid` cookie (no accounts needed)
- **Status endpoint:** `GET /api/storage` returns current storage status and pings Redis when configured
- **Heartbeat:** Vercel Cron calls `GET /api/internal/redis-heartbeat` once per day and performs a single Redis `SET` to keep free/low-traffic demo databases active

If a Vercel/Upstash database has been archived or uninstalled due to inactivity, follow [Database Recovery and Heartbeat Setup](docs/database-recovery.md).

## API Routes

### Chat (core)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/respond` | Send a message and get an OpenAI Responses API reply |
| POST | `/api/summarize` | Summarize branch messages into bullet points |

### History & Search

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/chats` | List all chat threads (metadata) |
| POST | `/api/chats` | Create a new chat thread |
| GET | `/api/chats/[id]` | Get a thread with full messages |
| PATCH | `/api/chats/[id]` | Update thread metadata |
| DELETE | `/api/chats/[id]` | Delete a thread |
| POST | `/api/chats/[id]/messages` | Append a message to a thread |
| GET | `/api/chats/[id]/summary` | Generate an on-demand thread summary |
| POST | `/api/chats/intent` | Classify user intent (chat-retrieval vs. normal) |
| POST | `/api/chats/find` | Semantic search + LLM rerank across chats |

### Smart Stacks

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/stacks/meta` | Get stacks metadata and category counts |
| POST | `/api/stacks/meta` | Update stacks metadata |
| POST | `/api/stacks/refresh` | Re-categorize all chats via LLM |

### Codex

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/codex/tasks` | List all codex tasks |
| POST | `/api/codex/tasks` | Create a new codex task |
| GET | `/api/codex/tasks/[id]` | Get a task with full details |
| POST | `/api/codex/tasks/[id]/apply` | Apply task changes to workspace |
| POST | `/api/codex/tasks/[id]/pr` | Create a PR from task changes |
| GET | `/api/codex/workspace` | Get current workspace snapshot |

### Infrastructure

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/storage` | Storage status (type, configured, warnings) |
| GET | `/api/health` | Redis connectivity diagnostics |
| GET | `/api/internal/redis-heartbeat` | Protected Vercel Cron endpoint that writes a daily heartbeat key |

## Demo Scripts

### Branch Overlay Demo

Follow these steps to demonstrate the branch overlay feature with context merging:

#### 1. Create a branch and establish a secret

1. Start a conversation: "Tell me about yourself"
2. After the assistant responds, hover over the response and click the **branch icon** (appears on the right)
3. In the side thread, tell the assistant a secret: "The password is 'banana123'"
4. The assistant will acknowledge the secret in the branch

#### 2. Test context isolation

1. **Close the branch** with "Include in main context" toggle **OFF** (default)
2. Notice the toast: "Branch kept separate"
3. In the **main chat**, ask: "What's the password?"
4. The assistant **won't know** -- the branch context is isolated!

#### 3. Merge branch into main (summary mode)

1. Click the branch chip to reopen the side thread
2. Toggle **ON** "Include in main context"
3. (Optional) Click the **...** menu to see advanced options -- "Include as summary" is default
4. Close the branch
5. Notice:
   - A **context card** appears in main chat with the summary
   - Toast: "Branch merged into main (summary)"
   - The branch chip turns **green** with a merge icon

#### 4. Verify merged context works

1. In the **main chat**, ask: "What's the password?"
2. The assistant **now knows** -- it can access the merged context!

#### 5. Full transcript merge (advanced)

1. Create another branch from any assistant message
2. Have a conversation in the branch
3. Toggle ON "Include in main context"
4. Click **...** → "Include full transcript"
5. Close the branch
6. The full conversation is merged (visible in context card)

#### Key Features Demonstrated

- **Context isolation**: Branches don't affect main until merged
- **Summary injection**: Concise 3-5 bullet summary merged by default
- **Full merge**: Advanced option for complete transcript injection
- **Visual feedback**: Green chips, merge icons, context cards, toasts
- **Chain integrity**: Response IDs properly chained through OpenAI Responses API

### History Demo

Follow these steps to demonstrate persistent chat history, Smart Stacks categorization, and the AI-powered chat finder:

#### 1. Create a few conversations

1. Navigate to `/demos/history` and click the **+** button in the sidebar to start a new chat
2. Have a short conversation about travel planning: "Help me plan a weekend trip to Austin"
3. Click **+** again and start a coding conversation: "How do I set up a Python virtual environment?"
4. Create one more about work: "Draft a quick email declining a meeting politely"
5. Each chat is automatically saved with a title and summary

#### 2. Browse and categorize with Smart Stacks

1. In the sidebar, switch to **Browse** mode (click the layers icon)
2. Click **Refresh Stacks** -- the app sends all chats to the LLM for categorization
3. Categories appear in the sidebar (Travel, Coding, Professional, etc.) with counts
4. Click a category to filter the chat list
5. Use the search bar at the top to filter further within a category

#### 3. Find a conversation with the Chat Finder

1. Switch to **Finder** mode (click the search icon in the sidebar)
2. Type a natural language query: "find my conversation about Python"
3. The system detects retrieval intent, searches across all chats, and returns ranked results
4. Each result shows:
   - Chat title and summary
   - **Why it matched** (LLM-generated explanation)
   - **Confidence score** (green = high match, blue = good match, gray = possible)
5. Click **Open** on a result to preview the full transcript
6. If only one high-confidence result is found, it auto-opens

#### 4. Use the /find shortcut

1. Type `/find email about meeting` to skip intent detection and search directly
2. Results appear the same way -- this is handy when you know you're searching

#### 5. Continue a conversation with attached context

1. Click **+** to start a new chat
2. In the composer, click the **+** button to open the chat picker
3. Search for and select a previous conversation to attach as context
4. Ask a follow-up question -- the attached chat's summary is included as context
5. The assistant can reference information from the attached conversation

#### Key Features Demonstrated

- **Persistent threads**: Conversations survive page reloads (stored in Redis or in-memory)
- **Smart Stacks**: LLM-powered auto-categorization with 7 categories
- **Chat Finder**: Natural language search with intent detection, semantic matching, and confidence scores
- **Context attachment**: Pull past conversations into new chats as context
- **Two browse modes**: Finder (search-first) and Browse (category-first)

### Codex Demo

Follow these steps to demonstrate AI-powered code generation with workspace integration:

#### 1. Submit a coding task

1. Navigate to `/demos/codex`
2. In the chat input, type: `@codex add a health check endpoint that returns server uptime`
3. Press Enter -- a task card appears immediately in the chat

#### 2. Watch task progress

1. The task card shows a progress bar with animated stages:
   - "Analyzing your request..." → "Drafting code changes..." → "Finalizing..."
2. Animated log lines scroll beneath the progress bar (parsing, generating, validating)
3. A timer shows elapsed time
4. Progress completes in roughly 30 seconds

#### 3. Review the generated code

1. When the status changes to **"Ready to Apply"** (amber badge), click the task card to expand it
2. The expanded view shows:
   - **Left panel**: The prompt, execution plan, and list of affected files
   - **Right panel**: Unified diff preview for the selected file
3. Click different files to review each diff

#### 4. Apply changes and view workspace

1. Click the **"Workspace"** button in the header to open the workspace panel
2. Click **"Apply"** on the task card -- changes are applied to the workspace
3. The workspace panel updates to show modified file contents
4. Status changes to **"Applied"** (green badge)

#### 5. Create a PR

1. Click **"Create PR"** on the applied task
2. Status changes to **"PR Created"** (purple badge) with a **"View PR"** link
3. You can also click the copy icon to copy the unified diff to clipboard

#### 6. Chat about the task

1. After the task completes, type a normal message (without `@codex`): "Can you explain what the health check endpoint does?"
2. The assistant responds with knowledge of the task -- completed tasks are automatically ingested into the chat context
3. Submit another task: `@codex add unit tests for the health check endpoint`
4. The new task builds on the context of the previous one

#### Key Features Demonstrated

- **@codex command**: Natural language task submission via chat
- **Progress visualization**: Animated progress bar, status phases, and log simulation
- **Code review UX**: Expandable task cards with file list and diff preview
- **Apply/PR workflow**: One-click apply to workspace, one-click PR creation
- **Context continuity**: Chat learns from completed tasks for follow-up questions
- **Workspace panel**: Live view of all project files and their contents

## Deployment

This app is Vercel-ready. Just connect your repository and add the environment variables.
