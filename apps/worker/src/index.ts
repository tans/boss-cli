import { loadAppConfig } from "@boss/config";
import {
  claimNextQueueItem,
  enqueue,
  finishQueueItem,
  getAccount,
  getConversation,
  getWorkingHours,
  incrementWecomSendCount,
  insertLog,
  insertMessage,
  listJobs,
  listTemplates,
  setConversationStatus,
  updateAccountStatus,
  updateQueueStep,
  upsertConversation,
  upsertJob,
} from "@boss/db";
import type { Conversation, QueueItem, ReplyTemplateType } from "@boss/shared";
import {
  listBossPositions,
  listUnreadBossConversations,
  openBossConversation,
  sendBossMessage,
} from "./boss-bridge.js";

const config = loadAppConfig();
let lastListenEnqueueAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function templateMap(): Record<ReplyTemplateType, string> {
  const entries = listTemplates().map((template) => [template.type, template.content]);
  return Object.fromEntries(entries) as Record<ReplyTemplateType, string>;
}

function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{([a-z_]+)\}/g, (full, key: string) => {
    const value = variables[key];
    if (value === undefined) {
      throw new Error(`模板变量缺失：${full}`);
    }
    return value;
  });
}

function isWithinWorkingHours(now = new Date()): boolean {
  const hours = getWorkingHours();
  const local = new Date(now.toLocaleString("en-US", { timeZone: hours.timezone }));
  const day = local.getDay();
  if (!hours.days.includes(day)) {
    return false;
  }
  const hh = String(local.getHours()).padStart(2, "0");
  const mm = String(local.getMinutes()).padStart(2, "0");
  const current = `${hh}:${mm}`;
  return current >= hours.start && current <= hours.end;
}

function shouldWaitForHr(text: string): boolean {
  const risky = ["保证", "录用", "违法", "歧视", "怀孕", "年龄限制", "社保", "底薪保证"];
  return risky.some((keyword) => text.includes(keyword));
}

async function maybeEnqueueListeningSync(): Promise<void> {
  const account = getAccount();
  if (account.listeningStatus !== "RUNNING") {
    return;
  }
  const now = Date.now();
  const waitMs = randomInt(config.listenLoopMinMs, config.listenLoopMaxMs);
  if (now - lastListenEnqueueAt < waitMs) {
    return;
  }
  lastListenEnqueueAt = now;
  const queueItem = enqueue({
    type: "SYNC_UNREAD",
    payload: {
      source: "worker-listen-loop",
    },
  });
  insertLog({
    level: "INFO",
    event: "listen-sync-enqueued",
    bossAccountId: "default",
    queueItemId: queueItem.id,
    message: "监听循环已创建未读同步任务。",
  });
}

async function runCheckLogin(queueItem: QueueItem): Promise<void> {
  updateQueueStep(queueItem.id, "checking-session");
  updateAccountStatus({
    loginStatus: "UNKNOWN",
    lastCheckedAt: new Date().toISOString(),
  });
  insertLog({
    level: "INFO",
    event: "check-login",
    bossAccountId: queueItem.bossAccountId,
    queueItemId: queueItem.id,
    message: "已记录登录检查任务。请在 Boss 浏览器窗口完成登录后启动监听。",
  });
}

async function runSyncPositions(queueItem: QueueItem): Promise<void> {
  updateQueueStep(queueItem.id, "reading-positions");
  const positions = await listBossPositions();
  for (const position of positions) {
    upsertJob({
      bossJobId: position.bossJobId,
      name: position.name,
    });
  }
  updateAccountStatus({
    jobCount: positions.length,
    loginStatus: "LOGGED_IN",
    lastCheckedAt: new Date().toISOString(),
  });
  insertLog({
    level: "INFO",
    event: "positions-synced",
    bossAccountId: queueItem.bossAccountId,
    queueItemId: queueItem.id,
    message: `已同步 ${positions.length} 个岗位。`,
  });
}

async function runSyncUnread(queueItem: QueueItem): Promise<void> {
  updateQueueStep(queueItem.id, "reading-unread-list");
  const unread = await listUnreadBossConversations();
  for (const item of unread) {
    const conversation = upsertConversation({
      bossConversationId: item.bossConversationId,
      candidateName: item.candidateName,
      jobName: item.jobName,
      latestMessage: item.latestMessage,
      latestMessageAt: item.latestMessageAt,
      unreadCount: item.unreadCount,
    });
    if (conversation.status !== "HUMAN" && conversation.status !== "CLOSED") {
      enqueue({
        type: "PROCESS_CONVERSATION",
        conversationId: conversation.id,
        payload: {
          candidateName: conversation.candidateName,
        },
      });
    }
  }
  updateAccountStatus({
    loginStatus: "LOGGED_IN",
    lastCheckedAt: new Date().toISOString(),
  });
  insertLog({
    level: "INFO",
    event: "unread-synced",
    bossAccountId: queueItem.bossAccountId,
    queueItemId: queueItem.id,
    message: `同步未读会话 ${unread.length} 个。`,
  });
}

async function runProcessConversation(queueItem: QueueItem): Promise<void> {
  if (!queueItem.conversationId) {
    throw new Error("PROCESS_CONVERSATION requires conversationId.");
  }
  const conversation = getConversation(queueItem.conversationId);
  if (conversation.status === "HUMAN" || conversation.status === "CLOSED") {
    insertLog({
      level: "INFO",
      event: "conversation-skipped",
      bossAccountId: queueItem.bossAccountId,
      conversationId: conversation.id,
      queueItemId: queueItem.id,
      message: `会话 ${conversation.candidateName} 当前状态为 ${conversation.status}，跳过自动处理。`,
    });
    return;
  }

  updateQueueStep(queueItem.id, "opening-chat");
  const snapshot = await openBossConversation(conversation.candidateName);
  let latestCandidateText: string | null = null;
  for (const message of snapshot.messages) {
    insertMessage({
      conversationId: conversation.id,
      sender: message.sender,
      text: message.text,
      sentAt: message.sentAt,
      sourceHash: message.sourceHash,
    });
    if (message.sender === "candidate") {
      latestCandidateText = message.text;
    }
  }

  const refreshed = getConversation(conversation.id);
  if (!latestCandidateText) {
    setConversationStatus(refreshed.id, "WAITING_CANDIDATE");
    return;
  }

  if (!isWithinWorkingHours()) {
    await sendOffHoursReply(queueItem, refreshed);
    return;
  }

  if (shouldWaitForHr(latestCandidateText)) {
    setConversationStatus(refreshed.id, "WAITING_HR");
    insertLog({
      level: "WARN",
      event: "wait-hr",
      bossAccountId: queueItem.bossAccountId,
      conversationId: refreshed.id,
      queueItemId: queueItem.id,
      message: "候选人消息命中人工确认规则。",
    });
    return;
  }

  await sendTemplateReply(queueItem, refreshed, latestCandidateText);
}

async function sendOffHoursReply(queueItem: QueueItem, conversation: Conversation): Promise<void> {
  const hours = getWorkingHours();
  if (!hours.offHoursReplyEnabled) {
    setConversationStatus(conversation.id, "WAITING_HR");
    return;
  }
  updateQueueStep(queueItem.id, "sending-off-hours-reply");
  await sendBossMessage(hours.offHoursTemplate);
  insertMessage({
    conversationId: conversation.id,
    sender: "ai",
    text: hours.offHoursTemplate,
    sentAt: new Date().toISOString(),
    sourceHash: `app:${queueItem.id}:off-hours`,
  });
  setConversationStatus(conversation.id, "WAITING_CANDIDATE");
}

async function sendTemplateReply(
  queueItem: QueueItem,
  conversation: Conversation,
  latestCandidateText: string,
): Promise<void> {
  const jobs = listJobs();
  const job = jobs.find((item) => item.name === conversation.jobName) ?? jobs[0];
  if (!job) {
    setConversationStatus(conversation.id, "WAITING_HR");
    throw new Error("未配置岗位，无法自动回复。");
  }
  if (!job.enabled || !job.autoReply) {
    setConversationStatus(conversation.id, "WAITING_HR");
    return;
  }

  const templates = templateMap();
  const variables = {
    wecom: job.wecomId,
    job_name: job.name,
    hr_name: "HR",
    candidate_name: conversation.candidateName,
  };

  const parts: string[] = [];
  if (conversation.messageCount <= 1) {
    parts.push(renderTemplate(templates.WELCOME, variables));
  } else if (latestCandidateText.includes("地点") || latestCandidateText.includes("哪里")) {
    parts.push(renderTemplate(templates.LOCATION, variables));
  } else if (latestCandidateText.includes("薪")) {
    parts.push(renderTemplate(templates.SALARY, variables));
  } else {
    parts.push(renderTemplate(templates.JOB_INTRO, variables));
  }

  if (conversation.wecomSendCount < 2) {
    if (!job.wecomId.trim()) {
      throw new Error(`岗位 ${job.name} 未配置企业微信。`);
    }
    parts.push(renderTemplate(templates.WECOM, variables));
  }

  const reply = parts.join("\n\n");
  updateQueueStep(queueItem.id, "sending-message");
  await sendBossMessage(reply);
  insertMessage({
    conversationId: conversation.id,
    sender: "ai",
    text: reply,
    sentAt: new Date().toISOString(),
    sourceHash: `app:${queueItem.id}:reply`,
  });
  if (conversation.wecomSendCount < 2) {
    incrementWecomSendCount(conversation.id);
  }
  setConversationStatus(conversation.id, "WAITING_CANDIDATE");
}

async function runSendMessage(queueItem: QueueItem): Promise<void> {
  const text = queueItem.payload.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("SEND_MESSAGE payload.text is required.");
  }
  updateQueueStep(queueItem.id, "sending-message");
  await sendBossMessage(text);
  if (queueItem.conversationId) {
    insertMessage({
      conversationId: queueItem.conversationId,
      sender: "hr",
      text,
      sentAt: new Date().toISOString(),
      sourceHash: `app:${queueItem.id}:manual-send`,
    });
    setConversationStatus(queueItem.conversationId, "WAITING_CANDIDATE");
  }
}

async function runQueueItem(queueItem: QueueItem): Promise<void> {
  insertLog({
    level: "INFO",
    event: "queue-started",
    bossAccountId: queueItem.bossAccountId,
    conversationId: queueItem.conversationId,
    queueItemId: queueItem.id,
    message: `开始执行队列任务：${queueItem.type}`,
  });

  switch (queueItem.type) {
    case "CHECK_LOGIN":
      await runCheckLogin(queueItem);
      break;
    case "SYNC_POSITIONS":
      await runSyncPositions(queueItem);
      break;
    case "SYNC_UNREAD":
      await runSyncUnread(queueItem);
      break;
    case "PROCESS_CONVERSATION":
      await runProcessConversation(queueItem);
      break;
    case "SEND_MESSAGE":
      await runSendMessage(queueItem);
      break;
    default:
      throw new Error(`Unsupported queue type: ${queueItem.type satisfies never}`);
  }

  finishQueueItem(queueItem.id, "SUCCEEDED");
  insertLog({
    level: "INFO",
    event: "queue-succeeded",
    bossAccountId: queueItem.bossAccountId,
    conversationId: queueItem.conversationId,
    queueItemId: queueItem.id,
    message: `队列任务完成：${queueItem.type}`,
  });
}

async function workerTick(): Promise<void> {
  await maybeEnqueueListeningSync();
  const queueItem = claimNextQueueItem();
  if (!queueItem) {
    return;
  }
  try {
    await runQueueItem(queueItem);
  } catch (error) {
    const message = errorMessage(error);
    finishQueueItem(queueItem.id, "FAILED", message);
    insertLog({
      level: "ERROR",
      event: "queue-failed",
      bossAccountId: queueItem.bossAccountId,
      conversationId: queueItem.conversationId,
      queueItemId: queueItem.id,
      message: `队列任务失败：${queueItem.type}`,
      errorDetail: message,
    });
  }
}

console.log("boss-worker ready");

for (;;) {
  await workerTick();
  await sleep(config.workerPollMs);
}
