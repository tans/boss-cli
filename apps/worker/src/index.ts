import {
  claimNextQueueItem,
  enqueue,
  finishQueueItem,
  finishQueueItemWithResult,
  getAccount,
  getAISettingSecret,
  getAutoFilterSetting,
  getBotBehaviorSetting,
  getConversation,
  getWorkingHours,
  incrementWecomSendCount,
  insertLog,
  insertMessage,
  listArchivedConversations,
  listJobs,
  listTemplates,
  recordWorkerHeartbeat,
  setConversationStatus,
  updateAccountStatus,
  updateQueueStep,
  upsertConversation,
  upsertJob,
} from "@boss/db";
import type { Conversation, QueueItem, ReplyTemplateType } from "@boss/shared";
import { AiReplyAgent } from "./ai-reply-agent.js";
import {
  type BossChatSnapshot,
  listAllConversations,
  listPositions,
  listUnreadConversations,
  openConversationSnapshot,
  readAccountSnapshot,
  sendMessage,
} from "./boss-bridge.js";

let lastListenEnqueueAt = 0;
const BEHAVIOR_REFRESH_GRANULARITY_MS = 1_000;
const aiReplyAgent = new AiReplyAgent();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUntilNextWorkerTick(startedAtMs: number): Promise<void> {
  for (;;) {
    const behavior = getBotBehaviorSetting();
    const elapsedMs = Date.now() - startedAtMs;
    const remainingMs = behavior.workerPollMs - elapsedMs;
    if (remainingMs <= 0) {
      return;
    }
    await sleep(Math.min(remainingMs, BEHAVIOR_REFRESH_GRANULARITY_MS));
  }
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

function parseCandidateAge(basicFacts: string[]): number | null {
  const joined = basicFacts.join(" ");
  const match = joined.match(/(\d{2})\s*岁/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function parseCandidateEducation(basicFacts: string[]): string | null {
  const levels = ["博士", "硕士", "本科", "大专", "高中", "中专", "初中"];
  const joined = basicFacts.join(" ");
  return levels.find((level) => joined.includes(level)) ?? null;
}

function autoFilterRejectReason(basicFacts: string[]): string | null {
  const setting = getAutoFilterSetting();
  if (!setting.enabled) {
    return null;
  }
  const age = parseCandidateAge(basicFacts);
  if (setting.minAge !== null) {
    if (age === null) {
      return `未读取到年龄，无法确认是否满足最低年龄 ${setting.minAge}`;
    }
    if (age < setting.minAge) {
      return `年龄 ${age} 低于最低要求 ${setting.minAge}`;
    }
  }
  if (setting.maxAge !== null) {
    if (age === null) {
      return `未读取到年龄，无法确认是否满足最高年龄 ${setting.maxAge}`;
    }
    if (age > setting.maxAge) {
      return `年龄 ${age} 高于最高要求 ${setting.maxAge}`;
    }
  }

  const allowed = setting.allowedEducations.map((item) => item.trim()).filter(Boolean);
  if (allowed.length > 0) {
    const education = parseCandidateEducation(basicFacts);
    if (!education) {
      return `未读取到学历，无法确认是否满足学历要求：${allowed.join("、")}`;
    }
    if (!allowed.includes(education)) {
      return `学历 ${education} 不在允许范围：${allowed.join("、")}`;
    }
  }
  return null;
}

async function maybeEnqueueListeningSync(): Promise<void> {
  const account = getAccount();
  if (account.listeningStatus !== "RUNNING") {
    return;
  }
  const behavior = getBotBehaviorSetting();
  const now = Date.now();
  const waitMs = randomInt(behavior.unreadListenLoopMinMs, behavior.unreadListenLoopMaxMs);
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
    message: "未读监听循环已创建未读同步任务。",
  });
}

async function runCheckLogin(queueItem: QueueItem): Promise<string> {
  updateQueueStep(queueItem.id, "checking-session");
  const snapshot = await readAccountSnapshot();
  updateAccountStatus({
    nickname: snapshot.nickname,
    loginStatus: "LOGGED_IN",
    lastCheckedAt: new Date().toISOString(),
  });
  insertLog({
    level: "INFO",
    event: "check-login",
    bossAccountId: queueItem.bossAccountId,
    queueItemId: queueItem.id,
    message: `已读取 Boss 账号信息：${snapshot.nickname}`,
  });
  return `Boss 已登录：${snapshot.nickname}`;
}

async function runSyncPositions(queueItem: QueueItem): Promise<string> {
  updateQueueStep(queueItem.id, "reading-positions");
  const positions = await listPositions();
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
  return `已同步 ${positions.length} 个岗位：${positions.map((position) => position.name).join("、")}`;
}

async function runSyncUnread(queueItem: QueueItem): Promise<string> {
  updateQueueStep(queueItem.id, "reading-unread-list");
  const unread = await listUnreadConversations();
  for (const item of unread) {
    const conversation = upsertConversation({
      bossConversationId: item.bossConversationId,
      candidateName: item.candidateName,
      jobName: item.jobName,
      archived: false,
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
          bossConversationId: conversation.bossConversationId,
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
  return `同步未读会话 ${unread.length} 个`;
}

async function runSyncAllConversations(queueItem: QueueItem): Promise<string> {
  updateQueueStep(queueItem.id, "reading-all-conversations");
  const conversations = await listAllConversations();
  let processCount = 0;
  let archivedCount = 0;
  for (const item of conversations) {
    if (item.archived) {
      archivedCount++;
    }
    const conversation = upsertConversation({
      bossConversationId: item.bossConversationId,
      candidateName: item.candidateName,
      jobName: item.jobName,
      archived: item.archived,
      latestMessage: item.latestMessage,
      latestMessageAt: item.latestMessageAt,
      unreadCount: item.unreadCount,
    });
    if (
      item.unreadCount > 0 &&
      !item.archived &&
      conversation.status !== "HUMAN" &&
      conversation.status !== "CLOSED"
    ) {
      processCount++;
      enqueue({
        type: "PROCESS_CONVERSATION",
        conversationId: conversation.id,
        payload: {
          candidateName: conversation.candidateName,
          bossConversationId: conversation.bossConversationId,
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
    event: "all-conversations-synced",
    bossAccountId: queueItem.bossAccountId,
    queueItemId: queueItem.id,
    message: `同步全部沟通 ${conversations.length} 个，其中归档 ${archivedCount} 个，未读入队 ${processCount} 个。`,
  });
  return `同步全部沟通 ${conversations.length} 个，其中归档 ${archivedCount} 个，未读入队 ${processCount} 个`;
}

async function runProcessConversation(queueItem: QueueItem): Promise<string> {
  if (!queueItem.conversationId) {
    throw new Error("PROCESS_CONVERSATION requires conversationId.");
  }
  const conversation = getConversation(queueItem.conversationId);
  if (conversation.archived) {
    insertLog({
      level: "INFO",
      event: "conversation-skipped",
      bossAccountId: queueItem.bossAccountId,
      conversationId: conversation.id,
      queueItemId: queueItem.id,
      message: `会话 ${conversation.candidateName} 已归档，跳过自动处理。`,
    });
    return `跳过归档会话：${conversation.candidateName}`;
  }
  if (conversation.status === "HUMAN" || conversation.status === "CLOSED") {
    insertLog({
      level: "INFO",
      event: "conversation-skipped",
      bossAccountId: queueItem.bossAccountId,
      conversationId: conversation.id,
      queueItemId: queueItem.id,
      message: `会话 ${conversation.candidateName} 当前状态为 ${conversation.status}，跳过自动处理。`,
    });
    return `跳过会话：${conversation.candidateName} 当前状态 ${conversation.status}`;
  }

  updateQueueStep(queueItem.id, "opening-chat");
  const snapshot = await openConversationSnapshot({
    candidateName: conversation.candidateName,
    bossConversationId: conversation.bossConversationId,
  });
  let latestCandidateText: string | null = null;
  let latestSender: "candidate" | "ai" | "hr" | "system" | null = null;
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
    latestSender = message.sender;
  }

  const refreshed = getConversation(conversation.id);
  const filterReason = autoFilterRejectReason(snapshot.basicFacts);
  if (filterReason) {
    const autoFilterSetting = getAutoFilterSetting();
    const rejectMessage = autoFilterSetting.rejectMessageTemplate.trim();
    if (!rejectMessage) {
      throw new Error(`自动筛选已启用但未配置筛选不通过回复，无法处理会话：${refreshed.candidateName}`);
    }
    updateQueueStep(queueItem.id, "marking-not-fit");
    await sendMessage(rejectMessage);
    setConversationStatus(refreshed.id, "CLOSED");
    insertLog({
      level: "INFO",
      event: "auto-filter-not-fit",
      bossAccountId: queueItem.bossAccountId,
      conversationId: refreshed.id,
      queueItemId: queueItem.id,
      message: `自动筛选不通过：${filterReason}；已发送配置回复。`,
    });
    return `自动筛选不通过：${filterReason}`;
  }

  if (latestSender === "hr" || latestSender === "ai") {
    setConversationStatus(refreshed.id, "WAITING_CANDIDATE");
    return `最新消息来自 ${latestSender}，等待候选人`;
  }

  if (!latestCandidateText || latestSender !== "candidate") {
    setConversationStatus(refreshed.id, "WAITING_CANDIDATE");
    return "未发现候选人新消息，等待候选人";
  }

  if (!isWithinWorkingHours()) {
    await sendOffHoursReply(queueItem, refreshed);
    return `已发送非工作时间回复：${refreshed.candidateName}`;
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
    return `命中人工确认规则：${refreshed.candidateName}`;
  }

  return sendAutoReply(queueItem, refreshed, latestCandidateText, snapshot);
}

async function runSyncArchivedConversations(queueItem: QueueItem): Promise<string> {
  updateQueueStep(queueItem.id, "reading-archived-conversations");
  const conversations = listArchivedConversations();
  let syncedCount = 0;
  let insertedCount = 0;

  for (const [index, conversation] of conversations.entries()) {
    const behavior = getBotBehaviorSetting();
    const delayMs = randomInt(
      behavior.archiveOpenDelayMinMs,
      behavior.archiveOpenDelayMaxMs,
    );
    updateQueueStep(
      queueItem.id,
      `archive-delay-${index + 1}-of-${conversations.length}-${delayMs}ms`,
    );
    await sleep(delayMs);

    updateQueueStep(queueItem.id, `opening-archived-chat-${index + 1}-of-${conversations.length}`);
    const snapshot = await openConversationSnapshot({
      candidateName: conversation.candidateName,
      bossConversationId: conversation.bossConversationId,
      archived: true,
    });

    for (const message of snapshot.messages) {
      const inserted = insertMessage({
        conversationId: conversation.id,
        sender: message.sender,
        text: message.text,
        sentAt: message.sentAt,
        sourceHash: message.sourceHash,
      });
      if (inserted) {
        insertedCount++;
      }
    }
    syncedCount++;
  }

  insertLog({
    level: "INFO",
    event: "archived-conversations-synced",
    bossAccountId: queueItem.bossAccountId,
    queueItemId: queueItem.id,
    message: `同步归档聊天记录 ${syncedCount} 个，新增消息 ${insertedCount} 条。`,
  });

  return `同步归档聊天记录 ${syncedCount} 个，新增消息 ${insertedCount} 条`;
}

async function sendOffHoursReply(queueItem: QueueItem, conversation: Conversation): Promise<void> {
  const hours = getWorkingHours();
  if (!hours.offHoursReplyEnabled) {
    setConversationStatus(conversation.id, "WAITING_HR");
    return;
  }
  updateQueueStep(queueItem.id, "sending-off-hours-reply");
  await sendMessage(hours.offHoursTemplate);
  insertMessage({
    conversationId: conversation.id,
    sender: "ai",
    text: hours.offHoursTemplate,
    sentAt: new Date().toISOString(),
    sourceHash: `app:${queueItem.id}:off-hours`,
  });
  setConversationStatus(conversation.id, "WAITING_CANDIDATE");
}

function resolveConversationJob(conversation: Conversation) {
  if (!conversation.jobName) {
    throw new Error(`会话 ${conversation.candidateName} 缺少岗位名称，无法自动回复。`);
  }
  const job = listJobs().find((item) => item.name === conversation.jobName);
  if (!job) {
    throw new Error(`未配置会话岗位：${conversation.jobName}`);
  }
  return job;
}

async function sendAiReply(
  queueItem: QueueItem,
  conversation: Conversation,
  latestCandidateText: string,
  snapshot: BossChatSnapshot,
): Promise<string> {
  const job = resolveConversationJob(conversation);
  if (!job.enabled || !job.autoReply) {
    setConversationStatus(conversation.id, "WAITING_HR");
    return `岗位未开启自动回复：${job.name}`;
  }

  updateQueueStep(queueItem.id, "generating-ai-reply");
  const aiSetting = getAISettingSecret();
  const result = await aiReplyAgent.chat(
    {
      candidateName: conversation.candidateName,
      jobName: job.name,
      wecomId: job.wecomId,
      wecomSendCount: conversation.wecomSendCount,
      chatRules: aiSetting.prompt,
      latestCandidateText,
      snapshot,
    },
    {
      apiKey: aiSetting.api_key,
      model: aiSetting.model,
    },
  );

  if (result.kind === "escalate") {
    setConversationStatus(conversation.id, "WAITING_HR");
    insertLog({
      level: "WARN",
      event: "ai-reply-escalated",
      bossAccountId: queueItem.bossAccountId,
      conversationId: conversation.id,
      queueItemId: queueItem.id,
      message: result.reason,
    });
    return `AI 回复转人工：${result.reason}`;
  }

  updateQueueStep(queueItem.id, "sending-message");
  await sendMessage(result.text);
  insertMessage({
    conversationId: conversation.id,
    sender: "ai",
    text: result.text,
    sentAt: new Date().toISOString(),
    sourceHash: `app:${queueItem.id}:ai-reply`,
  });
  if (result.wecomIncluded) {
    incrementWecomSendCount(conversation.id);
  }
  setConversationStatus(conversation.id, "WAITING_CANDIDATE");
  return `已发送 AI 回复：${conversation.candidateName}`;
}

async function sendTemplateReply(
  queueItem: QueueItem,
  conversation: Conversation,
  latestCandidateText: string,
): Promise<string> {
  const job = resolveConversationJob(conversation);
  if (!job.enabled || !job.autoReply) {
    setConversationStatus(conversation.id, "WAITING_HR");
    return `岗位未开启自动回复：${job.name}`;
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
  await sendMessage(reply);
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
  return `已发送模板回复：${conversation.candidateName}`;
}

async function sendAutoReply(
  queueItem: QueueItem,
  conversation: Conversation,
  latestCandidateText: string,
  snapshot: BossChatSnapshot,
): Promise<string> {
  const job = resolveConversationJob(conversation);
  if (job.aiReply) {
    return sendAiReply(queueItem, conversation, latestCandidateText, snapshot);
  }
  return sendTemplateReply(queueItem, conversation, latestCandidateText);
}

async function runSendMessage(queueItem: QueueItem): Promise<string> {
  const text = queueItem.payload.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("SEND_MESSAGE payload.text is required.");
  }
  updateQueueStep(queueItem.id, "sending-message");
  await sendMessage(text);
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
  return `已发送消息：${text.slice(0, 80)}`;
}

async function runQueueItem(queueItem: QueueItem): Promise<string> {
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
      return runCheckLogin(queueItem);
    case "SYNC_POSITIONS":
      return runSyncPositions(queueItem);
    case "SYNC_UNREAD":
      return runSyncUnread(queueItem);
    case "SYNC_ALL_CONVERSATIONS":
      return runSyncAllConversations(queueItem);
    case "SYNC_ARCHIVED_CONVERSATIONS":
      return runSyncArchivedConversations(queueItem);
    case "PROCESS_CONVERSATION":
      return runProcessConversation(queueItem);
    case "SEND_MESSAGE":
      return runSendMessage(queueItem);
    default:
      throw new Error(`Unsupported queue type: ${queueItem.type satisfies never}`);
  }
}

async function workerTick(): Promise<void> {
  recordWorkerHeartbeat();
  await maybeEnqueueListeningSync();
  const queueItem = claimNextQueueItem();
  if (!queueItem) {
    return;
  }
  try {
    const resultMessage = await runQueueItem(queueItem);
    finishQueueItemWithResult({
      queueId: queueItem.id,
      status: "SUCCEEDED",
      resultMessage,
    });
    insertLog({
      level: "INFO",
      event: "queue-succeeded",
      bossAccountId: queueItem.bossAccountId,
      conversationId: queueItem.conversationId,
      queueItemId: queueItem.id,
      message: `队列任务完成：${queueItem.type}；${resultMessage}`,
    });
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
  const tickStartedAtMs = Date.now();
  await workerTick();
  await sleepUntilNextWorkerTick(tickStartedAtMs);
}
