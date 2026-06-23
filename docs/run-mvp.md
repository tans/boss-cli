# Boss Chat MVP Startup Flow

This flow verifies the functional path from Boss browser state to web-visible queue results.

## 1. Build CLI

```bash
npm run build
```

The worker imports the structured toolset from `src/toolset`. Build first so the existing CLI can still be used directly for login and manual checks.

## 2. Start API

```bash
bun --cwd apps/api dev
```

Expected API base URL: `http://localhost:3001`.

## 3. Start Web

```bash
bun --cwd apps/web dev
```

Open the Vite URL printed by the command.

## 4. Start Worker

```bash
bun --cwd apps/worker dev
```

The dashboard should show `worker online` after the first heartbeat. If it shows `worker offline`, queue items can still be created but will remain `QUEUED`.

## 5. Login Boss

Use the existing Boss CLI/browser login flow:

```bash
npm run dev -- login
```

Complete login in the browser window. Do not start listening until the Boss web shell is logged in and accessible.

## 6. Sync Positions

In the web app, open `岗位管理` and click `同步岗位`.

Expected result:

- A `SYNC_POSITIONS` queue item is created.
- Worker reads Boss positions.
- `job_setting` rows are upserted.
- Jobs appear on the page.

## 7. Configure Job and WeCom

For each job that should automate replies:

- Enable `启用岗位`.
- Enable or disable `自动回复`.
- Enable or disable `AI增强回复`.
- Set `企业微信`.
- Click `保存配置`.

If a reply needs WeCom guidance and `企业微信` is empty, the queue item must fail with a visible error.

## 8. Start Listening

On the dashboard, click `启动监听`.

Expected result:

- Account listening status becomes `RUNNING`.
- A `SYNC_UNREAD` queue item is created.
- Worker periodically enqueues additional unread sync tasks while listening is running.

## 9. Verify Conversation Processing

Use `会话中心` and `日志` to verify:

- Unread Boss conversations are inserted into `conversation`.
- Each eligible conversation gets a `PROCESS_CONVERSATION` queue item.
- `HUMAN` and `CLOSED` conversations are skipped.
- If the latest message is from HR or AI, status becomes `WAITING_CANDIDATE`.
- If the latest message is from the candidate, worker applies working-hours, sensitive-content, job-enabled, auto-reply, and WeCom rules.
- Queue failures include the real Boss tool/browser error message in `error_message` and logs.
