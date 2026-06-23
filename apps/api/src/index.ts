import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { loadAppConfig } from "@boss/config";
import {
  enqueue,
  getAccount,
  getAISetting,
  getConversation,
  getDashboardSummary,
  getWorkingHours,
  insertLog,
  listConversations,
  listJobs,
  listLogs,
  listMessages,
  listQueue,
  listTemplates,
  setConversationStatus,
  updateAISetting,
  updateJob,
  updateListeningStatus,
  updateTemplate,
  updateWorkingHours,
} from "@boss/db";

const config = loadAppConfig();

function jsonError(error: unknown): { error: string } {
  return {
    error: error instanceof Error ? error.message : String(error),
  };
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

const app = new Elysia()
  .use(cors())
  .onError(({ error, set }) => {
    set.status = 500;
    return jsonError(error);
  })
  .get("/health", () => ({
    ok: true,
    service: "boss-api",
  }))
  .get("/api/dashboard", () => getDashboardSummary())
  .get("/api/account", () => getAccount())
  .post("/api/account/login", () => {
    const queueItem = enqueue({
      type: "CHECK_LOGIN",
      payload: {
        source: "account-login-action",
      },
    });
    insertLog({
      level: "INFO",
      event: "login-enqueued",
      bossAccountId: "default",
      queueItemId: queueItem.id,
      message: "已创建重新登录/会话检查队列任务。",
    });
    return queueItem;
  })
  .post("/api/listening/start", () => {
    const account = updateListeningStatus("RUNNING");
    const queueItem = enqueue({
      type: "SYNC_UNREAD",
      payload: {
        source: "start-listening",
      },
    });
    insertLog({
      level: "INFO",
      event: "listening-started",
      bossAccountId: "default",
      queueItemId: queueItem.id,
      message: "监听已启动，已创建一次未读同步任务。",
    });
    return { account, queueItem };
  })
  .post("/api/listening/stop", () => {
    const account = updateListeningStatus("STOPPED");
    insertLog({
      level: "INFO",
      event: "listening-stopped",
      bossAccountId: "default",
      message: "监听将在当前原子步骤结束后停止。",
    });
    return account;
  })
  .get("/api/jobs", () => listJobs())
  .patch(
    "/api/jobs/:id",
    ({ params, body }) =>
      updateJob(params.id, omitUndefined({
        bossJobId: body.bossJobId,
        name: body.name,
        enabled: body.enabled,
        wecomId: body.wecomId,
        autoReply: body.autoReply,
        aiReply: body.aiReply,
      })),
    {
      body: t.Partial(
        t.Object({
          bossJobId: t.String(),
          name: t.String(),
          enabled: t.Boolean(),
          wecomId: t.String(),
          autoReply: t.Boolean(),
          aiReply: t.Boolean(),
        }),
      ),
    },
  )
  .get("/api/templates", () => listTemplates())
  .patch(
    "/api/templates/:type",
    ({ params, body }) =>
      updateTemplate(
        params.type as Parameters<typeof updateTemplate>[0],
        body.content,
      ),
    {
      body: t.Object({
        content: t.String(),
      }),
    },
  )
  .get("/api/ai-settings", () => getAISetting())
  .patch(
    "/api/ai-settings",
    ({ body }) => updateAISetting(body),
    {
      body: t.Object({
        model: t.String(),
        apiKey: t.Optional(t.String()),
        prompt: t.String(),
      }),
    },
  )
  .get("/api/working-hours", () => getWorkingHours())
  .patch(
    "/api/working-hours",
    ({ body }) => updateWorkingHours(body),
    {
      body: t.Object({
        timezone: t.String(),
        days: t.Array(t.Number()),
        start: t.String(),
        end: t.String(),
        offHoursReplyEnabled: t.Boolean(),
        offHoursTemplate: t.String(),
      }),
    },
  )
  .get("/api/conversations", () => listConversations())
  .get("/api/conversations/:id", ({ params }) => ({
    conversation: getConversation(params.id),
    messages: listMessages(params.id),
  }))
  .post("/api/conversations/:id/takeover", ({ params }) => {
    const conversation = setConversationStatus(params.id, "HUMAN");
    insertLog({
      level: "INFO",
      event: "human-takeover",
      bossAccountId: "default",
      conversationId: params.id,
      message: `人工接管会话：${conversation.candidateName}`,
    });
    return conversation;
  })
  .post("/api/conversations/:id/resume-ai", ({ params }) => {
    const conversation = setConversationStatus(params.id, "ACTIVE");
    insertLog({
      level: "INFO",
      event: "resume-ai",
      bossAccountId: "default",
      conversationId: params.id,
      message: `恢复 AI 会话：${conversation.candidateName}`,
    });
    return conversation;
  })
  .post("/api/conversations/:id/close", ({ params }) => {
    const conversation = setConversationStatus(params.id, "CLOSED");
    insertLog({
      level: "INFO",
      event: "conversation-closed",
      bossAccountId: "default",
      conversationId: params.id,
      message: `关闭会话：${conversation.candidateName}`,
    });
    return conversation;
  })
  .post("/api/conversations/:id/process", ({ params }) => {
    const conversation = getConversation(params.id);
    const queueItem = enqueue({
      type: "PROCESS_CONVERSATION",
      conversationId: params.id,
      payload: {
        candidateName: conversation.candidateName,
      },
    });
    insertLog({
      level: "INFO",
      event: "conversation-process-enqueued",
      bossAccountId: "default",
      conversationId: params.id,
      queueItemId: queueItem.id,
      message: `已入队处理会话：${conversation.candidateName}`,
    });
    return queueItem;
  })
  .get("/api/queue", () => listQueue())
  .get("/api/logs", () => listLogs())
  .listen(config.apiPort);

console.log(`boss-api listening on ${app.server?.hostname}:${app.server?.port}`);
