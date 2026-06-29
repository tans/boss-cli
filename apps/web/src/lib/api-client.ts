import type {
  AISetting,
  AISettingInput,
  AutoFilterSetting,
  AutomationLog,
  BotBehaviorSetting,
  BossAccount,
  ChatTestInput,
  ChatTestResult,
  Conversation,
  ConversationAnalysis,
  DashboardSummary,
  JobSetting,
  Message,
  QueueItem,
  ReplyTemplate,
  ReplyTemplateType,
  SopSetting,
  SopSettingInput,
  WorkingHours,
} from "@boss/shared";

const API_BASE = import.meta.env.VITE_BOSS_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const data = parseJsonResponse(path, response.status, contentType, text);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed: ${response.status} ${path}`;
    throw new Error(message);
  }
  return data as T;
}

function parseJsonResponse(path: string, status: number, contentType: string, text: string): unknown {
  if (!text.trim()) {
    throw new Error(`接口 ${path} 返回空响应（HTTP ${status}）。请确认 boss-api 正在运行且 Vite 代理指向正确端口。`);
  }
  if (!contentType.includes("application/json")) {
    throw new Error(`接口 ${path} 返回非 JSON 响应（HTTP ${status}, content-type: ${contentType || "unknown"}）。`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`接口 ${path} JSON 解析失败（HTTP ${status}）：${message}`);
  }
}

export const api = {
  dashboard: () => request<DashboardSummary>("/api/dashboard"),
  conversationAnalysis: () => request<ConversationAnalysis>("/api/analytics/conversations"),
  account: () => request<BossAccount>("/api/account"),
  login: () => request<QueueItem>("/api/account/login", { method: "POST" }),
  startListening: () =>
    request<BossAccount>("/api/listening/start", {
      method: "POST",
    }),
  stopListening: () => request<BossAccount>("/api/listening/stop", { method: "POST" }),
  runQueueOnce: () => request<BossAccount>("/api/queue/run-once", { method: "POST" }),
  syncUnread: () => request<QueueItem>("/api/queue/sync-unread", { method: "POST" }),
  syncAllConversations: () =>
    request<QueueItem>("/api/queue/sync-all-conversations", { method: "POST" }),
  syncArchivedConversations: () =>
    request<QueueItem>("/api/queue/sync-archived-conversations", { method: "POST" }),
  syncPositions: () => request<QueueItem>("/api/queue/sync-positions", { method: "POST" }),
  jobs: () => request<JobSetting[]>("/api/jobs"),
  updateJob: (id: string, body: Partial<Omit<JobSetting, "id">>) =>
    request<JobSetting>(`/api/jobs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  templates: () => request<ReplyTemplate[]>("/api/templates"),
  updateTemplate: (type: ReplyTemplateType, content: string) =>
    request<ReplyTemplate>(`/api/templates/${type}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  aiSettings: () => request<AISetting>("/api/ai-settings"),
  updateAISettings: (body: AISettingInput) =>
    request<AISetting>("/api/ai-settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  runChatTest: (body: ChatTestInput) =>
    request<ChatTestResult>("/api/ai-settings/chat-test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  workingHours: () => request<WorkingHours>("/api/working-hours"),
  updateWorkingHours: (body: Omit<WorkingHours, "id">) =>
    request<WorkingHours>("/api/working-hours", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  autoFilter: () => request<AutoFilterSetting>("/api/auto-filter"),
  updateAutoFilter: (body: Omit<AutoFilterSetting, "id">) =>
    request<AutoFilterSetting>("/api/auto-filter", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  botBehavior: () => request<BotBehaviorSetting>("/api/bot-behavior"),
  updateBotBehavior: (body: Omit<BotBehaviorSetting, "id" | "updatedAt">) =>
    request<BotBehaviorSetting>("/api/bot-behavior", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  sop: () => request<SopSetting>("/api/sop"),
  updateSop: (body: SopSettingInput) =>
    request<SopSetting>("/api/sop", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  runSop: () => request<QueueItem>("/api/sop/run", { method: "POST" }),
  conversations: () => request<Conversation[]>("/api/conversations"),
  conversation: (id: string) =>
    request<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}`),
  takeover: (id: string) =>
    request<Conversation>(`/api/conversations/${id}/takeover`, { method: "POST" }),
  resumeAI: (id: string) =>
    request<Conversation>(`/api/conversations/${id}/resume-ai`, { method: "POST" }),
  closeConversation: (id: string) =>
    request<Conversation>(`/api/conversations/${id}/close`, { method: "POST" }),
  processConversation: (id: string) =>
    request<QueueItem>(`/api/conversations/${id}/process`, { method: "POST" }),
  queue: () => request<QueueItem[]>("/api/queue"),
  logs: () => request<AutomationLog[]>("/api/logs"),
};
