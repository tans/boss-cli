import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { AiReplyAgent } from "@boss/core";
import { loadAppConfig } from "@boss/config";
import {
  enqueue,
  getAccount,
  getAISetting,
  getAISettingSecret,
  getAutoFilterSetting,
  getConversationAnalysis,
  getBotBehaviorSetting,
  getConversation,
  getDashboardSummary,
  getSopSetting,
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
  updateAutoFilterSetting,
  updateBotBehaviorSetting,
  updateJob,
  updateListeningStatus,
  updateSopSetting,
  updateTemplate,
  updateWorkingHours,
} from "@boss/db";
import type { ChatTestInput, ChatTestResult, SopSettingInput } from "@boss/shared";

const config = loadAppConfig();
const webDistDir = fileURLToPath(new URL("../../web/dist", import.meta.url));
const aiReplyAgent = new AiReplyAgent();

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

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

async function runChatTest(input: ChatTestInput): Promise<ChatTestResult> {
  const aiSetting = getAISettingSecret();
  const result = await aiReplyAgent.chat(
    {
      candidateName: input.candidateName,
      jobName: input.jobName,
      wecomId: input.wecomId,
      wecomSendCount: input.wecomSendCount,
      chatRules: aiSetting.prompt,
      latestCandidateText: input.latestCandidateText,
      snapshot: input.snapshot,
    },
    {
      apiKey: aiSetting.api_key,
      model: aiSetting.model,
      baseUrl: aiSetting.base_url,
    },
  );
  if (result.kind === "escalate") {
    return {
      kind: result.kind,
      reason: result.reason,
    };
  }
  return {
    kind: result.kind,
    text: result.text,
    wecomIncluded: result.wecomIncluded,
  };
}

function staticResponse(
  pathname: string,
  set: { status?: number | string; headers: Record<string, string | number | string[]> },
): Response {
  const indexPath = join(webDistDir, "index.html");
  if (!existsSync(indexPath)) {
    set.status = 500;
    return new Response(
      `Web build not found at ${indexPath}. Run bun --cwd apps/web build before serving the single-port app.`,
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const normalized = pathname === "/" ? "/index.html" : pathname;
  const relativePath = normalized.replace(/^\/+/, "");
  const targetPath = join(webDistDir, relativePath);
  const assetPath = existsSync(targetPath) ? targetPath : indexPath;
  const ext = extname(assetPath);
  set.headers["content-type"] = mimeTypes[ext] ?? "application/octet-stream";
  return new Response(Bun.file(assetPath));
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
  .get("/api/analytics/conversations", () => getConversationAnalysis())
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
    insertLog({
      level: "INFO",
      event: "listening-started",
      bossAccountId: "default",
      message: "监听已启动；后续将按未读监听间隔创建同步任务。",
    });
    return account;
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
  .post("/api/queue/run-once", () => {
    const account = updateListeningStatus("RUN_ONCE");
    insertLog({
      level: "INFO",
      event: "queue-run-once-requested",
      bossAccountId: "default",
      message: "已请求 worker 单次执行最早的排队任务。",
    });
    return account;
  })
  .post("/api/queue/sync-unread", () => {
    const queueItem = enqueue({
      type: "SYNC_UNREAD",
      payload: {
        source: "manual-sync-unread",
      },
    });
    insertLog({
      level: "INFO",
      event: "manual-sync-unread-enqueued",
      bossAccountId: "default",
      queueItemId: queueItem.id,
      message: "已手动创建未读同步任务。",
    });
    return queueItem;
  })
  .post("/api/queue/sync-all-conversations", () => {
    const queueItem = enqueue({
      type: "SYNC_ALL_CONVERSATIONS",
      payload: {
        source: "manual-sync-all-conversations",
      },
    });
    insertLog({
      level: "INFO",
      event: "manual-sync-all-conversations-enqueued",
      bossAccountId: "default",
      queueItemId: queueItem.id,
      message: "已手动创建全部沟通同步任务。",
    });
    return queueItem;
  })
  .post("/api/queue/sync-archived-conversations", () => {
    const queueItem = enqueue({
      type: "SYNC_ARCHIVED_CONVERSATIONS",
      payload: {
        source: "manual-sync-archived-conversations",
      },
    });
    insertLog({
      level: "INFO",
      event: "manual-sync-archived-conversations-enqueued",
      bossAccountId: "default",
      queueItemId: queueItem.id,
      message: "已手动创建归档聊天记录同步任务。",
    });
    return queueItem;
  })
  .post("/api/queue/sync-positions", () => {
    const queueItem = enqueue({
      type: "SYNC_POSITIONS",
      payload: {
        source: "manual-sync-positions",
      },
    });
    insertLog({
      level: "INFO",
      event: "manual-sync-positions-enqueued",
      bossAccountId: "default",
      queueItemId: queueItem.id,
      message: "已手动创建岗位同步任务。",
    });
    return queueItem;
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
        baseUrl: t.String(),
        apiKey: t.Optional(t.String()),
        prompt: t.String(),
      }),
    },
  )
  .post(
    "/api/ai-settings/chat-test",
    ({ body }) => runChatTest(body),
    {
      body: t.Object({
        candidateName: t.String(),
        jobName: t.String(),
        wecomId: t.String(),
        wecomSendCount: t.Number(),
        latestCandidateText: t.String(),
        snapshot: t.Object({
          candidateName: t.String(),
          jobName: t.Nullable(t.String()),
          basicFacts: t.Array(t.String()),
          hasResume: t.Boolean(),
          messages: t.Array(
            t.Object({
              sender: t.Union([
                t.Literal("candidate"),
                t.Literal("ai"),
                t.Literal("hr"),
                t.Literal("system"),
              ]),
              text: t.String(),
              sentAt: t.Nullable(t.String()),
              sourceHash: t.String(),
            }),
          ),
        }),
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
  .get("/api/auto-filter", () => getAutoFilterSetting())
  .patch(
    "/api/auto-filter",
    ({ body }) => updateAutoFilterSetting(body),
    {
      body: t.Object({
        enabled: t.Boolean(),
        minAge: t.Nullable(t.Number()),
        maxAge: t.Nullable(t.Number()),
        allowedEducations: t.Array(t.String()),
        rejectMessageTemplate: t.String(),
      }),
    },
  )
  .get("/api/bot-behavior", () => getBotBehaviorSetting())
  .patch(
    "/api/bot-behavior",
    ({ body }) => updateBotBehaviorSetting(body),
    {
      body: t.Object({
        workerPollMs: t.Number(),
        unreadListenLoopMinMs: t.Number(),
        unreadListenLoopMaxMs: t.Number(),
        archiveOpenDelayMinMs: t.Number(),
        archiveOpenDelayMaxMs: t.Number(),
      }),
    },
  )
  .get("/api/sop", () => getSopSetting())
  .patch(
    "/api/sop",
    ({ body }) => updateSopSetting(body as SopSettingInput),
    {
      body: t.Object({
        enabled: t.Boolean(),
        timezone: t.String(),
        humanBehavior: t.Object({
          stepDelayMinMs: t.Number(),
          stepDelayMaxMs: t.Number(),
          batchDelayMinMs: t.Number(),
          batchDelayMaxMs: t.Number(),
          resumeViewMinMs: t.Number(),
          resumeViewMaxMs: t.Number(),
          replyTargetMinutes: t.Number(),
        }),
        steps: t.Array(
          t.Object({
            id: t.String(),
            time: t.String(),
            title: t.String(),
            action: t.Union([
              t.Literal("CHECK_LOGIN"),
              t.Literal("SYNC_POSITIONS"),
              t.Literal("SYNC_UNREAD"),
              t.Literal("SYNC_ALL_CONVERSATIONS"),
              t.Literal("SYNC_ARCHIVED_CONVERSATIONS"),
              t.Literal("PROCESS_UNREAD_CONVERSATIONS"),
              t.Literal("REFRESH_JOBS"),
              t.Literal("GREET_CANDIDATES"),
              t.Literal("REVIEW_RESUMES"),
              t.Literal("INVITE_INTERVIEW"),
              t.Literal("REVIEW_ANALYTICS"),
              t.Literal("PRIVATE_DOMAIN_SYNC"),
            ]),
            enabled: t.Boolean(),
            jobKeywords: t.Array(t.String()),
            batchSize: t.Number(),
            dailyLimit: t.Number(),
            notes: t.String(),
          }),
        ),
      }),
    },
  )
  .post("/api/sop/run", () => {
    const setting = getSopSetting();
    if (!setting.enabled) {
      throw new Error("SOP is disabled and cannot be enqueued.");
    }
    const queueItem = enqueue({
      type: "RUN_DAILY_SOP",
      payload: {
        source: "manual-run-sop",
      },
    });
    insertLog({
      level: "INFO",
      event: "sop-run-enqueued",
      bossAccountId: "default",
      queueItemId: queueItem.id,
      message: "已创建每日 SOP 执行队列任务。",
    });
    return queueItem;
  })
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
    if (conversation.archived) {
      throw new Error(`归档会话不可入队处理：${conversation.candidateName}`);
    }
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
  .get("/*", ({ path, set }) => staticResponse(path, set))
  .listen(config.apiPort);

console.log(`boss-api listening on ${app.server?.hostname}:${app.server?.port}`);
