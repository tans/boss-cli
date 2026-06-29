export type LoginStatus = "UNKNOWN" | "LOGGED_OUT" | "LOGGED_IN" | "EXPIRED" | "BLOCKED";
export type ListeningStatus = "STOPPED" | "RUNNING" | "RUN_ONCE";
export type ConversationStatus =
  | "NEW"
  | "ACTIVE"
  | "WAITING_CANDIDATE"
  | "WAITING_HR"
  | "HUMAN"
  | "CLOSED";
export type QueueStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type QueueType =
  | "CHECK_LOGIN"
  | "SYNC_POSITIONS"
  | "SYNC_UNREAD"
  | "SYNC_ALL_CONVERSATIONS"
  | "SYNC_ARCHIVED_CONVERSATIONS"
  | "PROCESS_CONVERSATION"
  | "SEND_MESSAGE"
  | "RUN_DAILY_SOP";
export type LogLevel = "INFO" | "WARN" | "ERROR";
export type MessageSender = "candidate" | "ai" | "hr" | "system";
export type SopStepAction =
  | "CHECK_LOGIN"
  | "SYNC_POSITIONS"
  | "SYNC_UNREAD"
  | "SYNC_ALL_CONVERSATIONS"
  | "SYNC_ARCHIVED_CONVERSATIONS"
  | "PROCESS_UNREAD_CONVERSATIONS"
  | "REFRESH_JOBS"
  | "GREET_CANDIDATES"
  | "REVIEW_RESUMES"
  | "INVITE_INTERVIEW"
  | "REVIEW_ANALYTICS"
  | "PRIVATE_DOMAIN_SYNC";
export type ReplyTemplateType =
  | "WELCOME"
  | "JOB_INTRO"
  | "LOCATION"
  | "SALARY"
  | "WECOM"
  | "OFF_HOURS";

export type BossAccount = {
  id: string;
  nickname: string | null;
  jobCount: number;
  loginStatus: LoginStatus;
  listeningStatus: ListeningStatus;
  lastCheckedAt: string | null;
};

export type JobSetting = {
  id: string;
  bossJobId: string;
  name: string;
  enabled: boolean;
  wecomId: string;
  autoReply: boolean;
  aiReply: boolean;
};

export type ReplyTemplate = {
  id: string;
  type: ReplyTemplateType;
  content: string;
  updatedAt: string;
};

export type AISetting = {
  id: string;
  model: string;
  baseUrl: string;
  apiKeySet: boolean;
  prompt: string;
  updatedAt: string;
};

export type AISettingInput = {
  model: string;
  baseUrl: string;
  apiKey?: string;
  prompt: string;
};

export type BossChatMessage = {
  sender: MessageSender;
  text: string;
  sentAt: string | null;
  sourceHash: string;
};

export type BossChatSnapshot = {
  candidateName: string;
  jobName: string | null;
  basicFacts: string[];
  messages: BossChatMessage[];
  hasResume: boolean;
};

export type ChatTestInput = {
  candidateName: string;
  jobName: string;
  wecomId: string;
  wecomSendCount: number;
  latestCandidateText: string;
  snapshot: BossChatSnapshot;
};

export type ChatTestResult = {
  kind: "reply" | "escalate";
  text?: string;
  reason?: string;
  wecomIncluded?: boolean;
};

export type WorkingHours = {
  id: string;
  timezone: string;
  days: number[];
  start: string;
  end: string;
  offHoursReplyEnabled: boolean;
  offHoursTemplate: string;
};

export type AutoFilterSetting = {
  id: string;
  enabled: boolean;
  minAge: number | null;
  maxAge: number | null;
  allowedEducations: string[];
  rejectMessageTemplate: string;
};

export type BotBehaviorSetting = {
  id: string;
  workerPollMs: number;
  unreadListenLoopMinMs: number;
  unreadListenLoopMaxMs: number;
  archiveOpenDelayMinMs: number;
  archiveOpenDelayMaxMs: number;
  updatedAt: string;
};

export type SopHumanBehaviorSetting = {
  stepDelayMinMs: number;
  stepDelayMaxMs: number;
  batchDelayMinMs: number;
  batchDelayMaxMs: number;
  resumeViewMinMs: number;
  resumeViewMaxMs: number;
  replyTargetMinutes: number;
};

export type SopStep = {
  id: string;
  time: string;
  title: string;
  action: SopStepAction;
  enabled: boolean;
  jobKeywords: string[];
  batchSize: number;
  dailyLimit: number;
  notes: string;
};

export type SopSetting = {
  id: string;
  enabled: boolean;
  timezone: string;
  humanBehavior: SopHumanBehaviorSetting;
  steps: SopStep[];
  updatedAt: string;
};

export type SopSettingInput = Omit<SopSetting, "id" | "updatedAt">;

export type Conversation = {
  id: string;
  bossConversationId: string;
  candidateName: string;
  jobSettingId: string | null;
  jobName: string | null;
  archived: boolean;
  status: ConversationStatus;
  messageCount: number;
  wecomSendCount: number;
  latestMessage: string | null;
  latestMessageAt: string | null;
  humanTakeoverAt: string | null;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  sender: MessageSender;
  text: string;
  sentAt: string | null;
  sourceHash: string;
  createdAt: string;
};

export type QueueItem = {
  id: string;
  type: QueueType;
  status: QueueStatus;
  bossAccountId: string;
  conversationId: string | null;
  payload: Record<string, unknown>;
  currentStep: string | null;
  resultMessage: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type QueueRunOnceResult = {
  ran: boolean;
  queueItem: QueueItem | null;
  message: string;
};

export type AutomationLog = {
  id: string;
  level: LogLevel;
  event: string;
  bossAccountId: string | null;
  conversationId: string | null;
  queueItemId: string | null;
  message: string;
  errorDetail: string | null;
  createdAt: string;
};

export type DashboardSummary = {
  account: BossAccount;
  worker: WorkerHeartbeat;
  queue: QueueItem[];
  metrics: {
    todayConversations: number;
    todayAiReplies: number;
    todayWecomSends: number;
    latestFailures: number;
  };
};

export type ConversationAnalysis = {
  totals: {
    conversations: number;
    archivedConversations: number;
    activeConversations: number;
    messages: number;
    candidateMessages: number;
    hrMessages: number;
    aiMessages: number;
    wecomSends: number;
  };
  byStatus: Array<{
    status: ConversationStatus;
    count: number;
  }>;
  byJob: Array<{
    jobName: string;
    conversationCount: number;
    messageCount: number;
    wecomSends: number;
  }>;
};

export type ServiceHealth = {
  ok: true;
  service: string;
};

export type WorkerHeartbeat = {
  id: string;
  lastSeenAt: string | null;
  staleAfterSeconds: number;
  isAlive: boolean;
};
