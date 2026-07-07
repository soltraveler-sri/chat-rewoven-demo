/**
 * CodexCloudTaskRunner - Production implementation stub
 *
 * This is a placeholder for the real Codex Cloud SDK integration.
 * When ready, this would:
 * 1. Authenticate with OpenAI Codex API
 * 2. Submit tasks to Codex Cloud for execution
 * 3. Poll for completion or use webhooks
 * 4. Integrate with GitHub for real PR creation
 *
 * ## Architecture Notes for Future Implementation
 *
 * ### Streaming Logs
 * The production runner should stream logs in real-time using SSE:
 *
 * ```typescript
 * // Client subscribes to log stream
 * const eventSource = new EventSource(`/api/codex/tasks/${taskId}/stream`)
 * eventSource.onmessage = (e) => {
 *   const log = JSON.parse(e.data)
 *   appendLog(log.message)
 *   updateProgress(log.progress) // e.g., 0.0 to 1.0
 * }
 * ```
 *
 * ### Diff Generation
 * Real diffs should be generated server-side using a proper diff library:
 *
 * ```typescript
 * import { createPatch } from 'diff'
 * const patch = createPatch(
 *   filePath,
 *   beforeContent,
 *   afterContent,
 *   'before',
 *   'after'
 * )
 * ```
 *
 * ### Task State Machine
 * Status transitions:
 *   queued → running → draft_ready → applied → pr_created → done
 *                  ↘ failed
 *
 * Each transition should emit events for real-time UI updates.
 *
 * TODO: Implement when Codex SDK is available
 */

import type { TaskRunner, StartTaskArgs } from "./TaskRunner"
import type { CodexTask, WorkspaceSnapshot } from "./types"

/**
 * CodexCloudTaskRunner - NOT IMPLEMENTED
 *
 * This stub shows where the real Codex Cloud integration would plug in.
 * For now, use MockTaskRunner instead.
 *
 * ## How to implement startTask with streaming:
 *
 * 1. Create the task record with status "queued"
 * 2. Submit to Codex Cloud API
 * 3. Open a streaming connection to receive progress updates
 * 4. As logs arrive, update the task record and emit events
 * 5. When complete, update status to "draft_ready" with changes/diff
 *
 * Example with streaming:
 * ```typescript
 * async startTask(args: StartTaskArgs): Promise<CodexTask> {
 *   const codex = new CodexClient({ apiKey: process.env.CODEX_API_KEY });
 *
 *   // Create job with streaming enabled
 *   const stream = await codex.tasks.createStream({
 *     prompt: args.prompt,
 *     workspaceFiles: args.workspace.files,
 *     model: getModel("codex"),
 *   });
 *
 *   // Process stream events
 *   for await (const event of stream) {
 *     switch (event.type) {
 *       case 'log':
 *         await this.appendLog(taskId, event.message);
 *         break;
 *       case 'progress':
 *         await this.updateProgress(taskId, event.progress);
 *         break;
 *       case 'file_change':
 *         await this.addChange(taskId, event.change);
 *         break;
 *       case 'complete':
 *         await this.complete(taskId, event.result);
 *         break;
 *       case 'error':
 *         await this.fail(taskId, event.error);
 *         break;
 *     }
 *   }
 *
 *   return this.getTask(taskId, args.demoUid);
 * }
 * ```
 */
export class CodexCloudTaskRunner implements TaskRunner {
  /**
   * Start a task using Codex Cloud
   *
   * Production implementation would:
   * 1. Authenticate with Codex API using CODEX_API_KEY
   * 2. Submit the prompt + workspace context to Codex Cloud
   * 3. Return a task ID for polling or start streaming
   *
   * ## Streaming Log Implementation
   *
   * The UI expects incremental log updates during the "running" state.
   * Options for streaming:
   *
   * A) Server-Sent Events (SSE) - recommended for simplicity
   *    ```typescript
   *    app.get('/api/codex/tasks/:id/stream', async (req, res) => {
   *      res.setHeader('Content-Type', 'text/event-stream');
   *      const task = await codex.tasks.getStream(req.params.id);
   *      for await (const event of task.events) {
   *        res.write(`data: ${JSON.stringify(event)}\n\n`);
   *      }
   *    });
   *    ```
   *
   * B) WebSocket - for bidirectional communication if needed
   *
   * C) Polling with ETag - for simpler infrastructure
   *
   * @see https://platform.openai.com/docs/api-reference/codex (future)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async startTask(args: StartTaskArgs): Promise<CodexTask> {
    // TODO: Implement Codex Cloud integration
    //
    // Example pseudocode:
    // const codex = new CodexClient({ apiKey: process.env.CODEX_API_KEY });
    // const job = await codex.tasks.create({
    //   prompt: args.prompt,
    //   workspaceFiles: args.workspace.files,
    //   model: process.env.OPENAI_MODEL_CODEX || "gpt-5.4-mini",
    // });
    // return this.pollForCompletion(job.id);

    throw new Error(
      "CodexCloudTaskRunner not implemented. Use MockTaskRunner for demo."
    )
  }

  /**
   * Apply changes from Codex Cloud to the workspace
   *
   * Production implementation would:
   * 1. Fetch the completed task from Codex Cloud
   * 2. Download generated file changes
   * 3. Apply to workspace (or real filesystem)
   *
   * ## Diff Generation
   *
   * When applying changes, generate a proper unified diff:
   *
   * ```typescript
   * import { createTwoFilesPatch } from 'diff';
   *
   * for (const change of task.changes) {
   *   const patch = createTwoFilesPatch(
   *     `a/${change.path}`,
   *     `b/${change.path}`,
   *     change.before || '',
   *     change.after,
   *     undefined,
   *     undefined,
   *     { context: 3 }
   *   );
   *   diffs.push(patch);
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async applyChanges(taskId: string, demoUid: string): Promise<WorkspaceSnapshot> {
    // TODO: Implement
    //
    // Example pseudocode:
    // const codex = new CodexClient({ apiKey: process.env.CODEX_API_KEY });
    // const task = await codex.tasks.get(taskId);
    // for (const change of task.changes) {
    //   await fs.writeFile(change.path, change.content);
    // }
    // return updatedWorkspace;

    throw new Error(
      "CodexCloudTaskRunner not implemented. Use MockTaskRunner for demo."
    )
  }

  /**
   * Create a PR using GitHub integration
   *
   * Production implementation would:
   * 1. Use GitHub OAuth token from user
   * 2. Create a branch with the changes
   * 3. Open a PR via GitHub API
   * 4. Return the real PR URL
   *
   * ## GitHub Integration
   *
   * ```typescript
   * async createPR(taskId: string, demoUid: string): Promise<{ prUrl: string }> {
   *   const user = await getUserWithGithubToken(demoUid);
   *   const octokit = new Octokit({ auth: user.githubToken });
   *   const task = await this.getTask(taskId, demoUid);
   *
   *   // Create branch
   *   const baseSha = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
   *   const branchName = `codex/${taskId.slice(0, 8)}`;
   *   await octokit.git.createRef({
   *     owner, repo,
   *     ref: `refs/heads/${branchName}`,
   *     sha: baseSha.data.object.sha,
   *   });
   *
   *   // Commit changes
   *   for (const change of task.changes) {
   *     await octokit.repos.createOrUpdateFileContents({
   *       owner, repo,
   *       path: change.path,
   *       message: `Apply codex change: ${change.path}`,
   *       content: Buffer.from(change.after).toString('base64'),
   *       branch: branchName,
   *     });
   *   }
   *
   *   // Create PR
   *   const pr = await octokit.pulls.create({
   *     owner, repo,
   *     head: branchName,
   *     base: 'main',
   *     title: task.title,
   *     body: task.planMarkdown,
   *   });
   *
   *   return { prUrl: pr.data.html_url };
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createPR(taskId: string, demoUid: string): Promise<{ prUrl: string }> {
    // TODO: Implement GitHub integration
    throw new Error(
      "CodexCloudTaskRunner not implemented. Use MockTaskRunner for demo."
    )
  }

  /**
   * Get a task from Codex Cloud
   *
   * ## Task Caching
   *
   * For performance, consider caching task state locally:
   *
   * ```typescript
   * async getTask(taskId: string, demoUid: string): Promise<CodexTask | null> {
   *   // Check local cache first
   *   const cached = await store.getTask(demoUid, taskId);
   *   if (cached && ['draft_ready', 'applied', 'pr_created', 'failed'].includes(cached.status)) {
   *     return cached; // Terminal states don't need refresh
   *   }
   *
   *   // Fetch from Codex Cloud for running tasks
   *   const codex = new CodexClient({ apiKey: process.env.CODEX_API_KEY });
   *   const cloudTask = await codex.tasks.get(taskId);
   *
   *   // Update cache
   *   await store.saveTask(demoUid, cloudTask);
   *   return cloudTask;
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getTask(taskId: string, demoUid: string): Promise<CodexTask | null> {
    // TODO: Implement
    throw new Error(
      "CodexCloudTaskRunner not implemented. Use MockTaskRunner for demo."
    )
  }
}

/**
 * Environment variables needed for production:
 *
 * CODEX_API_KEY - API key for Codex Cloud
 * OPENAI_MODEL_CODEX - Model to use (e.g., "gpt-5.4-mini")
 * GITHUB_CLIENT_ID - GitHub OAuth app client ID
 * GITHUB_CLIENT_SECRET - GitHub OAuth app client secret
 *
 * ## UI Integration Notes
 *
 * The TaskCard component expects the following for optimal UX:
 *
 * 1. **Progress updates**: Task should update `logs` array frequently during "running"
 * 2. **Incremental changes**: Add to `changes` array as files are generated
 * 3. **Unified diff**: Generate `diffUnified` when task completes
 * 4. **PR URL**: Set `prUrl` after PR creation and persist to store
 *
 * The UI polls every 3 seconds during running state. Consider:
 * - Returning a "progress" field (0-100) for smoother progress bar
 * - Using SSE for instant updates without polling overhead
 */
