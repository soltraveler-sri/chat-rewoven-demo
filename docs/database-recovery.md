# Database Recovery and Heartbeat Setup

This demo uses Redis for persisted chat history, Codex task state, and workspace snapshots. If the Vercel dashboard says the Upstash database was archived or uninstalled due to inactivity, the app may still show stale `KV` env vars while Redis calls fail at runtime.

Upstash documents that inactive free Redis databases can be archived after a minimum of 14 days, and Pay As You Go databases after a minimum of 3 months. The daily heartbeat below is intentionally one low-cost Redis write per day.

## Restore or Replace Redis

1. Open the Vercel project dashboard for `improved-llm-chat-demo`.
2. Go to Storage.
3. If Vercel shows the old Upstash resource as archived/uninstalled, do not keep using its old env vars.
4. Create or connect a new Upstash Redis database from the Vercel Storage or Marketplace flow.
5. Use the Free plan for the demo unless you want longer inactivity windows. Choose a region near the Vercel deployment region when possible.
6. Connect the new Redis database to the project and enable the environment variables for Production.
7. Confirm the project has one supported REST env pair:
   - Preferred Upstash names: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   - Vercel KV names: `KV_REST_API_URL` and `KV_REST_API_TOKEN`
8. Remove or replace stale values that point at the archived host.
9. Do not use `REDIS_URL` or `KV_URL` for this app path. Those are native Redis connection strings; this app uses the HTTPS REST endpoint through `@vercel/kv`.
10. Add `CRON_SECRET` to Production env vars. Use a random value with at least 16 characters.
11. Redeploy the Production deployment so the new env vars and cron config are active.

## Verify The Fix

1. Open `https://<production-domain>/api/health`.
2. Expected result: HTTP 200 with `connectivity.status` set to `ok`.
3. Open the app UI and confirm the storage indicator is green `KV`.
4. If it shows an error state, open the indicator tooltip or `/api/health` to inspect whether the issue is DNS, auth, URL format, or timeout.
5. Create a chat, refresh the page, and confirm the chat still appears.

## Verify The Heartbeat

The repo includes a Vercel Cron job in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/internal/redis-heartbeat",
      "schedule": "17 5 * * *"
    }
  ]
}
```

This runs once per day at 05:17 UTC on the Production deployment. The endpoint requires:

```bash
CRON_SECRET=<random secret>
```

Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when invoking cron jobs. The endpoint performs one Redis `SET` command on `__system:redis_heartbeat` with a 30-day TTL. That is enough real Redis activity for the demo while keeping command volume and cost negligible.

To test manually after deployment:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<production-domain>/api/internal/redis-heartbeat
```

Expected response:

```json
{
  "ok": true,
  "key": "__system:redis_heartbeat",
  "command": "SET"
}
```

Then go to Vercel Project Settings > Cron Jobs and confirm `/api/internal/redis-heartbeat` is listed. Cron jobs run on Production deployments only.

## If It Still Fails

- `ENOTFOUND` or DNS errors usually mean the env vars still point at an archived/deleted host.
- `401` or unauthorized errors usually mean the Redis token is stale or `CRON_SECRET` does not match the Authorization header.
- URL format errors usually mean a native Redis URL was configured instead of the HTTPS REST URL.
- A green Vercel integration card is not enough; verify with `/api/health` because the app needs live Redis connectivity, not just env var presence.

## References

- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Managing Vercel Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Upstash Vercel Integration](https://upstash.com/docs/redis/howto/vercelintegration)
- [Upstash Redis FAQ](https://upstash.com/docs/redis/help/faq)
