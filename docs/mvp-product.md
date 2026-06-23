# Boss auto chat MVP product spec

## Goal

V1 is a small desktop-hanging Boss auto chat product for one HR user and one Boss account.

The product goal is:

- Ship a usable version within 2 weeks.
- Reach a chargeable version within 1 month.
- Solve Boss message listening, AI reply, WeCom diversion, and human takeover.

V1 is not an ATS, CRM, BI dashboard, interview scheduler, or multi-agent recruitment platform.

## V1 scope

```text
1 Boss account
1 HR operator
Desktop hanging process
AI auto reply
WeCom diversion
Human takeover
Queue-visible slow automation
```

The current technical architecture is:

```text
apps/web -> apps/api -> persisted queue -> apps/worker -> root CLI capability -> Boss page
```

The existing CLI stays in the repository root. Web/API/worker layers call CLI capabilities through a queue and worker process. Boss automation must be serialized per Boss account/session and intentionally paced like a real operator.

## Non-goals

Do not implement these in V1:

- Resume parsing
- ATS
- Multiple Boss accounts
- Multiple HR collaboration
- Data reports
- WeCom API integration
- Auto interview invitation
- Interview scheduling
- Multiple agents
- Knowledge base
- CRM
- Candidate scoring
- Pipeline stages beyond chat state
- Bulk outbound campaigns

## Pages

V1 contains 8 pages:

```text
1. Dashboard
2. Boss account
3. Job settings
4. Reply rules
5. AI settings
6. Conversation center
7. Working hours
8. Logs
```

The page count should not grow before the first chargeable version unless a missing page blocks the core chat workflow.

## 1. Dashboard

Purpose: show whether the local hanging process is healthy and whether automation is currently busy.

Minimum content:

```text
Runtime status
Boss account status
Listening status
Current queue item
Today's conversations
Today's AI replies
Today's WeCom sends
Latest failures
```

Actions:

```text
Start listening
Stop listening
Open conversation center
Open logs
```

Implementation notes:

- Data comes from `apps/api`.
- Automation state is read from persisted queue/job state.
- Do not compute complex analytics in V1.

## 2. Boss account

V1 supports only one Boss account. Do not build account list UI.

Page shape:

```text
Boss account
━━━━━━━━━━

● Logged in

Nickname: Zhang Manager
Job count: 5
Online status: Normal

[Relogin]
[Start listening]
[Stop listening]
```

Required fields:

```json
{
  "id": "default",
  "nickname": "张经理",
  "job_count": 5,
  "login_status": "LOGGED_IN",
  "listening_status": "RUNNING"
}
```

Statuses:

```text
UNKNOWN
LOGGED_OUT
LOGGED_IN
EXPIRED
BLOCKED
```

Actions:

- `Relogin`: enqueue a login/check session job.
- `Start listening`: enable worker listening loop.
- `Stop listening`: disable worker listening loop after current step finishes.

Do not start browser automation directly from the API handler.

## 3. Job settings

Purpose: configure per-job auto reply and WeCom behavior.

V1 should support multiple Boss jobs under the single account, but the UI can be simple.

Page shape:

```text
Java developer

● Auto reply
● Auto send WeCom
○ AI enhanced reply

WeCom:
hr001

Working hours:
09:00-18:00
```

Minimal config:

```json
{
  "job_id": "123",
  "job_name": "Java开发工程师",
  "enabled": true,
  "wecom_id": "hr001",
  "auto_reply": true,
  "ai_reply": true
}
```

Rules:

- Disabled jobs should not trigger AI replies.
- `wecom_id` is plain text in V1.
- No WeCom API binding in V1.
- No job import wizard unless Boss CLI already exposes stable job reading.

## 4. Reply rules

Purpose: maintain deterministic reply templates and variables.

V1 rule groups:

```text
Welcome
Job introduction
Work location
Salary reply
WeCom guidance
Off-hours reply
```

Example welcome template:

```text
您好，

感谢投递职位。

我是招聘助手，
很高兴为您服务。
```

Example WeCom template:

```text
为了方便沟通，

请添加企业微信：

{wecom}
```

Supported variables:

```text
{wecom}
{job_name}
{hr_name}
{candidate_name}
```

Rules:

- V1 only supports variable replacement.
- Missing variables should fail validation when saving the rule, not during message send.
- Do not add fallback reply text. If a required template is missing or invalid, expose the error in logs and queue state.
- Template preview should show rendered output using sample values.

## 5. AI settings

Purpose: configure model, API key, and system prompt.

Page shape:

```text
Model:
gpt-5.5

API Key

Prompt
```

Default system prompt:

```text
你是招聘专员。

目标：

1 回答岗位问题
2 保持礼貌
3 引导企业微信
4 不承诺录用
5 不讨论敏感内容
```

Rules:

- AI can rewrite or select replies, but it must stay inside V1 goals.
- AI must not promise hiring results, salary certainty, interview slots, or employment outcomes.
- AI must not discuss sensitive or unrelated topics.
- AI errors should stop that queue item with a visible failure reason.
- No hidden non-AI fallback response in V1.

Implementation notes:

- Store API key securely for the target deployment mode before production.
- Keep prompt versioned so logs can explain which prompt generated a reply.

## 6. Conversation center

This is the most important V1 page.

List shape:

```text
张三
李四
王五
赵六
```

Conversation statuses:

```text
NEW
ACTIVE
WAITING_CANDIDATE
WAITING_HR
HUMAN
CLOSED
```

Status meanings:

- `NEW`: newly discovered conversation, not processed yet.
- `ACTIVE`: automation is processing or eligible to process the conversation.
- `WAITING_CANDIDATE`: last message was sent by HR/AI, waiting for candidate.
- `WAITING_HR`: candidate needs manual HR decision or automation cannot answer safely.
- `HUMAN`: HR has taken over, AI is stopped.
- `CLOSED`: no more automatic action.

Detail layout:

```text
Candidate chat history

Right side:

Conversation information
Job
Message count
WeCom send count

[Take over now]
```

Required actions:

- Take over now
- Resume AI
- Mark closed

Rules:

- Human takeover stops AI for that conversation immediately after the current atomic step.
- Resume AI only changes conversation state back to automation-eligible; it does not send an immediate message unless the queue runner picks it.
- Conversation detail should show queue state if there is a pending or running item.

## 7. Human takeover

Entry point: conversation detail top-right action.

Action:

```text
[Take over now]
```

Result:

```text
AI stopped
Conversation status: HUMAN
```

Second action:

```text
[Resume AI]
```

Result:

```text
Conversation becomes automation-eligible again
```

Rules:

- Takeover is per conversation, not global.
- Manual takeover should not kill the worker process.
- If a message send is already in progress, do not interrupt the browser mid-action. Finish the atomic step, then stop further AI actions for that conversation.

## 8. WeCom strategy

Keep this simple in V1.

Default strategy:

```text
First reply: send WeCom
Second reminder: send WeCom
Maximum sends: 2
```

Config shape:

```text
WeCom send strategy

○ First reply
● Second round

Maximum sends
2
```

Minimal config:

```json
{
  "send_on_first_reply": true,
  "send_on_second_round": true,
  "max_send_count": 2
}
```

Rules:

- Count WeCom sends per conversation.
- Do not send WeCom after `max_send_count`.
- If `wecom_id` is missing for the job, the queue item should fail with a clear error.
- No WeCom API integration in V1. The product only sends text guidance inside Boss chat.

## 9. Working hours

Page shape:

```text
Monday-Friday

09:00-18:00
```

Off-hours reply:

```text
您好，

当前为非工作时间。

稍后会有招聘专员联系您。
```

Minimal config:

```json
{
  "timezone": "Asia/Shanghai",
  "days": [1, 2, 3, 4, 5],
  "start": "09:00",
  "end": "18:00"
}
```

Rules:

- Off-hours behavior should be deterministic.
- If off-hours auto reply is enabled, send the off-hours template and set status to `WAITING_CANDIDATE`.
- If off-hours auto reply is disabled, set status to `WAITING_HR`.
- Do not add separate holiday logic in V1.

## 10. Logs

Purpose: make slow automation observable and debuggable.

Page shape:

```text
10:01 Received message
10:01 AI replied
10:03 Sent WeCom
10:08 Human takeover
```

Log levels:

```text
INFO
WARN
ERROR
```

Required context:

```text
timestamp
level
event
Boss account/session id
conversation id
job id
queue item id
message
error detail when failed
```

Rules:

- Log every queue state transition.
- Log every Boss CLI capability invocation.
- Log AI request/response metadata, but do not log secrets.
- Log human takeover and resume actions.
- Do not hide errors behind generic messages.

## Queue UX

Because Boss automation should look human and avoid fast parallel behavior, the frontend must expose queue state instead of implying instant execution.

Queue item statuses:

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
CANCELLED
```

Frontend display:

```text
Current action
Current step
Position in queue
Elapsed time
Last error
Retry not available unless explicitly implemented
```

Rules:

- One active automation item per Boss account/session.
- No hidden concurrent sends for the same account.
- Failed items remain visible with a clear reason.
- Cancellation stops future steps; it should not interrupt an unsafe browser action mid-click or mid-send.

## Suggested data model

V1 can start with these entities:

```text
boss_account
job_setting
reply_template
ai_setting
working_hours
conversation
message
queue_item
automation_log
```

Suggested fields:

```text
boss_account:
  id
  nickname
  login_status
  listening_status
  last_checked_at

job_setting:
  id
  boss_job_id
  name
  enabled
  wecom_id
  auto_reply
  ai_reply

reply_template:
  id
  type
  content
  updated_at

conversation:
  id
  boss_conversation_id
  candidate_name
  job_setting_id
  status
  message_count
  wecom_send_count
  human_takeover_at
  updated_at

queue_item:
  id
  type
  status
  boss_account_id
  conversation_id
  current_step
  error_message
  created_at
  started_at
  finished_at

automation_log:
  id
  level
  event
  boss_account_id
  conversation_id
  queue_item_id
  message
  error_detail
  created_at
```

## Worker responsibilities

The worker owns:

- Boss message listening
- Queue claiming
- CLI capability invocation
- Human-paced waits
- AI reply generation
- Template rendering
- WeCom send-count enforcement
- Conversation state transitions
- Automation logs

The API owns:

- Config CRUD
- Queue item creation
- Conversation state updates initiated by HR
- Read-only queue/log/conversation views

The frontend owns:

- Admin UI
- Queue visibility
- Human takeover controls
- Config forms
- Conversation review

## V1 development sequence

Recommended order:

1. Data model and persisted queue.
2. Boss account status page and login/session check.
3. Worker single-account queue runner.
4. Conversation list sync/listening loop.
5. Reply rules and variable preview.
6. AI settings and AI reply generation.
7. WeCom strategy enforcement.
8. Conversation center and human takeover.
9. Working hours behavior.
10. Logs and failure visibility.

Do not start with analytics, dashboards, or multi-account abstractions.

## Success criteria

V1 is usable when:

- One Boss account can stay logged in on a desktop machine.
- The worker can listen for new candidate messages.
- A configured job can auto reply during working hours.
- The reply can include WeCom guidance.
- WeCom sends are capped at 2 per conversation.
- HR can take over a conversation and stop AI.
- HR can resume AI for a conversation.
- Every automation action is visible in queue and logs.
- Failures are clear enough to locate the account, conversation, step, and root error.

The first chargeable version should improve stability and operations around this flow, not expand into ATS features.
