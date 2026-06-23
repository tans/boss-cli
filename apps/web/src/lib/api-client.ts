import type {
  AISetting,
  AISettingInput,
  AutomationLog,
  BossAccount,
  Conversation,
  DashboardSummary,
  JobSetting,
  Message,
  QueueItem,
  ReplyTemplate,
  ReplyTemplateType,
  WorkingHours,
} from "@boss/shared";

const API_BASE = import.meta.env.VITE_BOSS_API_BASE ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const data = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  dashboard: () => request<DashboardSummary>("/api/dashboard"),
  account: () => request<BossAccount>("/api/account"),
  login: () => request<QueueItem>("/api/account/login", { method: "POST" }),
  startListening: () =>
    request<{ account: BossAccount; queueItem: QueueItem }>("/api/listening/start", {
      method: "POST",
    }),
  stopListening: () => request<BossAccount>("/api/listening/stop", { method: "POST" }),
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
  workingHours: () => request<WorkingHours>("/api/working-hours"),
  updateWorkingHours: (body: Omit<WorkingHours, "id">) =>
    request<WorkingHours>("/api/working-hours", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
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
