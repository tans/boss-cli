# MVP functional TODO

This list only tracks functional work required to make the Boss auto chat MVP genuinely usable.

## 1. Validate real Boss execution

- Log in to one Boss account through the existing CLI/browser flow.
- Start `apps/api`, `apps/web`, and `apps/worker`.
- Click `启动监听` in the web app.
- Confirm the worker can execute `SYNC_UNREAD`.
- Confirm unread Boss conversations are written into `conversation`.
- Confirm queue failures include the real CLI/browser error message.

## 2. Replace stdout parsing with structured CLI bridge

- Add structured app-facing functions around the existing toolset.
- Keep CLI human-readable output unchanged.
- Worker should call structured functions instead of parsing CLI stdout.

Required structured functions:

```text
listUnreadConversations()
openConversationSnapshot(candidate)
listPositions()
sendMessage(text)
```

Required data:

```text
conversation id/key
candidate name
job name
unread count
latest message
full message list
message sender
message time
message text
```

## 3. Make conversation identity reliable

- Current conversation id is derived from candidate name + job name.
- Replace it with a stable Boss-side identifier if one exists in the DOM.
- Handle candidates with the same name.
- Keep message deduplication deterministic.

## 4. Sync Boss positions

- Add a web action to enqueue `SYNC_POSITIONS`.
- Worker reads Boss positions.
- Worker upserts `job_setting`.
- Job settings page shows real Boss jobs.
- Job settings can save:
  - enabled
  - wecom id
  - auto reply
  - AI reply

## 5. Implement AI reply decision

- Connect AI provider from `ai_setting`.
- Prompt AI to return only JSON.
- Validate JSON before sending.

Allowed AI output:

```json
{
  "action": "REPLY",
  "reply": "text to send",
  "reason": "short reason"
}
```

or:

```json
{
  "action": "WAIT_HR",
  "reply": "",
  "reason": "why human is needed"
}
```

Rules:

- Invalid JSON fails the queue item.
- `WAIT_HR` sets conversation status to `WAITING_HR`.
- Do not send fallback text when AI fails.
- Do not allow AI to promise hiring, interview slots, salary certainty, or employment outcome.

## 6. Complete conversation processing rules

Worker must enforce:

- If conversation is `HUMAN`, skip automation.
- If conversation is `CLOSED`, skip automation.
- If latest message is from HR or AI, set `WAITING_CANDIDATE`.
- If latest message is from candidate, process it.
- If message is sensitive or requires commitment, set `WAITING_HR`.
- If outside working hours, apply off-hours behavior.
- If job is disabled, set `WAITING_HR`.
- If auto reply is disabled, set `WAITING_HR`.

## 7. Complete WeCom strategy

- Send WeCom guidance on first reply when enabled.
- Send WeCom guidance on second round when enabled.
- Never send WeCom more than 2 times per conversation.
- If job needs WeCom but `wecom_id` is missing, fail the queue item.
- Store and display `wecom_send_count`.

## 8. Human takeover behavior

- `立即接管` sets conversation to `HUMAN`.
- Worker must skip `HUMAN` conversations.
- If a queue item is already mid-click or mid-send, finish that atomic step first.
- `恢复AI` sets conversation back to automation-eligible state.
- Resume must not immediately send a message unless a queue item later processes it.

## 9. Manual processing actions

- Add `入队处理` for a selected conversation.
- Add manual queue action for `SYNC_UNREAD`.
- Add manual queue action for `SYNC_POSITIONS`.
- Show queue item status after each action.

## 10. Functional empty states

- If no jobs exist, show action to sync positions.
- If no conversations exist, show action to start listening or sync unread.
- If API is not running, show clear connection error.
- If worker is not running, queue remains visible as `QUEUED`.

## 11. Worker lifecycle visibility

- Add a worker heartbeat record.
- Dashboard should show whether worker is alive.
- If worker heartbeat is stale, display `worker offline`.
- Starting listening should not imply worker is running unless heartbeat is fresh.

## 12. Required run document

Create `docs/run-mvp.md` with the exact functional startup flow:

```text
1. Build CLI
2. Start API
3. Start Web
4. Start Worker
5. Login Boss
6. Sync positions
7. Configure job and WeCom
8. Start listening
9. Verify conversation processing
```
