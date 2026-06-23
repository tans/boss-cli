import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { loadAppConfig } from "@boss/config";
import type {
  AISetting,
  AISettingInput,
  AutomationLog,
  BossAccount,
  Conversation,
  ConversationStatus,
  DashboardSummary,
  JobSetting,
  ListeningStatus,
  LogLevel,
  Message,
  MessageSender,
  QueueItem,
  QueueStatus,
  QueueType,
  ReplyTemplate,
  ReplyTemplateType,
  WorkingHours,
} from "@boss/shared";

type DbBoolean = 0 | 1;

let dbRef: Database | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function bool(value: boolean): DbBoolean {
  return value ? 1 : 0;
}

function fromBool(value: number): boolean {
  return value === 1;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Queue payload must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function getDb(): Database {
  if (dbRef) {
    return dbRef;
  }
  const config = loadAppConfig();
  mkdirSync(dirname(config.databasePath), { recursive: true });
  dbRef = new Database(config.databasePath);
  dbRef.exec("PRAGMA journal_mode = WAL;");
  dbRef.exec("PRAGMA foreign_keys = ON;");
  migrate(dbRef);
  seedDefaults(dbRef);
  return dbRef;
}

export function closeDb(): void {
  dbRef?.close();
  dbRef = null;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS boss_account (
      id TEXT PRIMARY KEY,
      nickname TEXT,
      job_count INTEGER NOT NULL DEFAULT 0,
      login_status TEXT NOT NULL,
      listening_status TEXT NOT NULL,
      last_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS job_setting (
      id TEXT PRIMARY KEY,
      boss_job_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      wecom_id TEXT NOT NULL,
      auto_reply INTEGER NOT NULL,
      ai_reply INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reply_template (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_setting (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      api_key TEXT,
      prompt TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS working_hours (
      id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      days_json TEXT NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      off_hours_reply_enabled INTEGER NOT NULL,
      off_hours_template TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation (
      id TEXT PRIMARY KEY,
      boss_conversation_id TEXT NOT NULL UNIQUE,
      candidate_name TEXT NOT NULL,
      job_setting_id TEXT REFERENCES job_setting(id),
      job_name TEXT,
      status TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      wecom_send_count INTEGER NOT NULL DEFAULT 0,
      latest_message TEXT,
      latest_message_at TEXT,
      human_takeover_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      sent_at TEXT,
      source_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queue_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      boss_account_id TEXT NOT NULL REFERENCES boss_account(id),
      conversation_id TEXT REFERENCES conversation(id),
      payload_json TEXT NOT NULL,
      current_step TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_queue_claim ON queue_item(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_queue_conversation ON queue_item(conversation_id);

    CREATE TABLE IF NOT EXISTS automation_log (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      boss_account_id TEXT REFERENCES boss_account(id),
      conversation_id TEXT REFERENCES conversation(id),
      queue_item_id TEXT REFERENCES queue_item(id),
      message TEXT NOT NULL,
      error_detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_log_created ON automation_log(created_at DESC);
  `);
}

function seedDefaults(db: Database): void {
  const account = db.query("SELECT id FROM boss_account WHERE id = 'default'").get();
  if (!account) {
    db.query(
      `INSERT INTO boss_account
       (id, nickname, job_count, login_status, listening_status, last_checked_at)
       VALUES ('default', NULL, 0, 'UNKNOWN', 'STOPPED', NULL)`,
    ).run();
  }

  const templates: Array<{ type: ReplyTemplateType; content: string }> = [
    {
      type: "WELCOME",
      content: "您好，\n\n感谢投递职位。\n\n我是招聘助手，很高兴为您服务。",
    },
    {
      type: "JOB_INTRO",
      content: "{job_name} 主要负责业务系统研发，团队重视稳定交付和协作沟通。",
    },
    {
      type: "LOCATION",
      content: "工作地点会由招聘专员结合岗位安排确认，可先线上沟通。",
    },
    {
      type: "SALARY",
      content: "薪资会结合经验和面试情况沟通，具体以 HR 确认为准。",
    },
    {
      type: "WECOM",
      content: "为了方便沟通，\n\n请添加企业微信：\n\n{wecom}",
    },
    {
      type: "OFF_HOURS",
      content: "您好，\n\n当前为非工作时间。\n\n稍后会有招聘专员联系您。",
    },
  ];

  const insertTemplate = db.query(
    `INSERT OR IGNORE INTO reply_template (id, type, content, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const template of templates) {
    insertTemplate.run(id("tpl"), template.type, template.content, nowIso());
  }

  const ai = db.query("SELECT id FROM ai_setting WHERE id = 'default'").get();
  if (!ai) {
    db.query(
      `INSERT INTO ai_setting (id, model, api_key, prompt, updated_at)
       VALUES ('default', 'gpt-5.5', NULL, ?, ?)`,
    ).run(
      "你是招聘专员。\n\n目标：\n\n1 回答岗位问题\n2 保持礼貌\n3 引导企业微信\n4 不承诺录用\n5 不讨论敏感内容",
      nowIso(),
    );
  }

  const hours = db.query("SELECT id FROM working_hours WHERE id = 'default'").get();
  if (!hours) {
    db.query(
      `INSERT INTO working_hours
       (id, timezone, days_json, start, end, off_hours_reply_enabled, off_hours_template)
       VALUES ('default', 'Asia/Shanghai', '[1,2,3,4,5]', '09:00', '18:00', 1, ?)`,
    ).run("您好，\n\n当前为非工作时间。\n\n稍后会有招聘专员联系您。");
  }
}

type BossAccountRow = {
  id: string;
  nickname: string | null;
  job_count: number;
  login_status: BossAccount["loginStatus"];
  listening_status: ListeningStatus;
  last_checked_at: string | null;
};

function mapBossAccount(row: BossAccountRow): BossAccount {
  return {
    id: row.id,
    nickname: row.nickname,
    jobCount: row.job_count,
    loginStatus: row.login_status,
    listeningStatus: row.listening_status,
    lastCheckedAt: row.last_checked_at,
  };
}

type JobSettingRow = {
  id: string;
  boss_job_id: string;
  name: string;
  enabled: number;
  wecom_id: string;
  auto_reply: number;
  ai_reply: number;
};

function mapJobSetting(row: JobSettingRow): JobSetting {
  return {
    id: row.id,
    bossJobId: row.boss_job_id,
    name: row.name,
    enabled: fromBool(row.enabled),
    wecomId: row.wecom_id,
    autoReply: fromBool(row.auto_reply),
    aiReply: fromBool(row.ai_reply),
  };
}

type ReplyTemplateRow = {
  id: string;
  type: ReplyTemplateType;
  content: string;
  updated_at: string;
};

function mapReplyTemplate(row: ReplyTemplateRow): ReplyTemplate {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    updatedAt: row.updated_at,
  };
}

type AISettingRow = {
  id: string;
  model: string;
  api_key: string | null;
  prompt: string;
  updated_at: string;
};

function mapAISetting(row: AISettingRow): AISetting {
  return {
    id: row.id,
    model: row.model,
    apiKeySet: !!row.api_key,
    prompt: row.prompt,
    updatedAt: row.updated_at,
  };
}

type WorkingHoursRow = {
  id: string;
  timezone: string;
  days_json: string;
  start: string;
  end: string;
  off_hours_reply_enabled: number;
  off_hours_template: string;
};

function mapWorkingHours(row: WorkingHoursRow): WorkingHours {
  return {
    id: row.id,
    timezone: row.timezone,
    days: JSON.parse(row.days_json) as number[],
    start: row.start,
    end: row.end,
    offHoursReplyEnabled: fromBool(row.off_hours_reply_enabled),
    offHoursTemplate: row.off_hours_template,
  };
}

type ConversationRow = {
  id: string;
  boss_conversation_id: string;
  candidate_name: string;
  job_setting_id: string | null;
  job_name: string | null;
  status: ConversationStatus;
  message_count: number;
  wecom_send_count: number;
  latest_message: string | null;
  latest_message_at: string | null;
  human_takeover_at: string | null;
  updated_at: string;
};

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    bossConversationId: row.boss_conversation_id,
    candidateName: row.candidate_name,
    jobSettingId: row.job_setting_id,
    jobName: row.job_name,
    status: row.status,
    messageCount: row.message_count,
    wecomSendCount: row.wecom_send_count,
    latestMessage: row.latest_message,
    latestMessageAt: row.latest_message_at,
    humanTakeoverAt: row.human_takeover_at,
    updatedAt: row.updated_at,
  };
}

type MessageRow = {
  id: string;
  conversation_id: string;
  sender: MessageSender;
  text: string;
  sent_at: string | null;
  source_hash: string;
  created_at: string;
};

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender,
    text: row.text,
    sentAt: row.sent_at,
    sourceHash: row.source_hash,
    createdAt: row.created_at,
  };
}

type QueueItemRow = {
  id: string;
  type: QueueType;
  status: QueueStatus;
  boss_account_id: string;
  conversation_id: string | null;
  payload_json: string;
  current_step: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function mapQueueItem(row: QueueItemRow): QueueItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    bossAccountId: row.boss_account_id,
    conversationId: row.conversation_id,
    payload: parseJsonObject(row.payload_json),
    currentStep: row.current_step,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

type AutomationLogRow = {
  id: string;
  level: LogLevel;
  event: string;
  boss_account_id: string | null;
  conversation_id: string | null;
  queue_item_id: string | null;
  message: string;
  error_detail: string | null;
  created_at: string;
};

function mapAutomationLog(row: AutomationLogRow): AutomationLog {
  return {
    id: row.id,
    level: row.level,
    event: row.event,
    bossAccountId: row.boss_account_id,
    conversationId: row.conversation_id,
    queueItemId: row.queue_item_id,
    message: row.message,
    errorDetail: row.error_detail,
    createdAt: row.created_at,
  };
}

export function getAccount(): BossAccount {
  const row = getDb()
    .query<BossAccountRow, []>("SELECT * FROM boss_account WHERE id = 'default'")
    .get();
  if (!row) {
    throw new Error("Default Boss account was not initialized.");
  }
  return mapBossAccount(row);
}

export function updateListeningStatus(status: ListeningStatus): BossAccount {
  getDb()
    .query("UPDATE boss_account SET listening_status = ? WHERE id = 'default'")
    .run(status);
  return getAccount();
}

export function updateAccountStatus(input: {
  nickname?: string | null;
  jobCount?: number;
  loginStatus?: BossAccount["loginStatus"];
  lastCheckedAt?: string | null;
}): BossAccount {
  const current = getAccount();
  getDb()
    .query(
      `UPDATE boss_account
       SET nickname = ?, job_count = ?, login_status = ?, last_checked_at = ?
       WHERE id = 'default'`,
    )
    .run(
      input.nickname === undefined ? current.nickname : input.nickname,
      input.jobCount ?? current.jobCount,
      input.loginStatus ?? current.loginStatus,
      input.lastCheckedAt === undefined ? current.lastCheckedAt : input.lastCheckedAt,
    );
  return getAccount();
}

export function listJobs(): JobSetting[] {
  return getDb()
    .query<JobSettingRow, []>("SELECT * FROM job_setting ORDER BY name ASC")
    .all()
    .map(mapJobSetting);
}

export function upsertJob(input: {
  bossJobId: string;
  name: string;
  enabled?: boolean;
  wecomId?: string;
  autoReply?: boolean;
  aiReply?: boolean;
}): JobSetting {
  const existing = getDb()
    .query<JobSettingRow, [string]>("SELECT * FROM job_setting WHERE boss_job_id = ?")
    .get(input.bossJobId);
  const rowId = existing?.id ?? id("job");
  getDb()
    .query(
      `INSERT INTO job_setting
       (id, boss_job_id, name, enabled, wecom_id, auto_reply, ai_reply)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(boss_job_id) DO UPDATE SET
         name = excluded.name,
         enabled = excluded.enabled,
         wecom_id = excluded.wecom_id,
         auto_reply = excluded.auto_reply,
         ai_reply = excluded.ai_reply`,
    )
    .run(
      rowId,
      input.bossJobId,
      input.name,
      bool(input.enabled ?? (existing ? fromBool(existing.enabled) : true)),
      input.wecomId ?? existing?.wecom_id ?? "",
      bool(input.autoReply ?? (existing ? fromBool(existing.auto_reply) : true)),
      bool(input.aiReply ?? (existing ? fromBool(existing.ai_reply) : true)),
    );
  const row = getDb()
    .query<JobSettingRow, [string]>("SELECT * FROM job_setting WHERE id = ?")
    .get(rowId);
  if (!row) {
    throw new Error(`Job ${rowId} was not saved.`);
  }
  return mapJobSetting(row);
}

export function updateJob(idValue: string, input: Partial<Omit<JobSetting, "id">>): JobSetting {
  const current = getDb()
    .query<JobSettingRow, [string]>("SELECT * FROM job_setting WHERE id = ?")
    .get(idValue);
  if (!current) {
    throw new Error(`Job setting ${idValue} was not found.`);
  }
  getDb()
    .query(
      `UPDATE job_setting
       SET boss_job_id = ?, name = ?, enabled = ?, wecom_id = ?, auto_reply = ?, ai_reply = ?
       WHERE id = ?`,
    )
    .run(
      input.bossJobId ?? current.boss_job_id,
      input.name ?? current.name,
      bool(input.enabled ?? fromBool(current.enabled)),
      input.wecomId ?? current.wecom_id,
      bool(input.autoReply ?? fromBool(current.auto_reply)),
      bool(input.aiReply ?? fromBool(current.ai_reply)),
      idValue,
    );
  return mapJobSetting(
    getDb().query<JobSettingRow, [string]>("SELECT * FROM job_setting WHERE id = ?").get(idValue)!,
  );
}

export function listTemplates(): ReplyTemplate[] {
  return getDb()
    .query<ReplyTemplateRow, []>("SELECT * FROM reply_template ORDER BY type ASC")
    .all()
    .map(mapReplyTemplate);
}

export function updateTemplate(type: ReplyTemplateType, content: string): ReplyTemplate {
  if (!content.trim()) {
    throw new Error(`Template ${type} content cannot be empty.`);
  }
  getDb()
    .query("UPDATE reply_template SET content = ?, updated_at = ? WHERE type = ?")
    .run(content, nowIso(), type);
  const row = getDb()
    .query<ReplyTemplateRow, [ReplyTemplateType]>("SELECT * FROM reply_template WHERE type = ?")
    .get(type);
  if (!row) {
    throw new Error(`Template ${type} was not found.`);
  }
  return mapReplyTemplate(row);
}

export function getAISetting(): AISetting {
  const row = getDb().query<AISettingRow, []>("SELECT * FROM ai_setting WHERE id = 'default'").get();
  if (!row) {
    throw new Error("Default AI setting was not initialized.");
  }
  return mapAISetting(row);
}

export function getAISettingSecret(): AISettingRow {
  const row = getDb().query<AISettingRow, []>("SELECT * FROM ai_setting WHERE id = 'default'").get();
  if (!row) {
    throw new Error("Default AI setting was not initialized.");
  }
  return row;
}

export function updateAISetting(input: AISettingInput): AISetting {
  if (!input.model.trim()) {
    throw new Error("AI model cannot be empty.");
  }
  if (!input.prompt.trim()) {
    throw new Error("AI prompt cannot be empty.");
  }
  const current = getAISettingSecret();
  const apiKey = input.apiKey === undefined ? current.api_key : input.apiKey.trim() || null;
  getDb()
    .query("UPDATE ai_setting SET model = ?, api_key = ?, prompt = ?, updated_at = ? WHERE id = 'default'")
    .run(input.model.trim(), apiKey, input.prompt, nowIso());
  return getAISetting();
}

export function getWorkingHours(): WorkingHours {
  const row = getDb()
    .query<WorkingHoursRow, []>("SELECT * FROM working_hours WHERE id = 'default'")
    .get();
  if (!row) {
    throw new Error("Default working hours were not initialized.");
  }
  return mapWorkingHours(row);
}

export function updateWorkingHours(input: Omit<WorkingHours, "id">): WorkingHours {
  if (input.days.some((day) => day < 0 || day > 6)) {
    throw new Error("Working days must be numbers between 0 and 6.");
  }
  getDb()
    .query(
      `UPDATE working_hours
       SET timezone = ?, days_json = ?, start = ?, end = ?, off_hours_reply_enabled = ?, off_hours_template = ?
       WHERE id = 'default'`,
    )
    .run(
      input.timezone,
      JSON.stringify(input.days),
      input.start,
      input.end,
      bool(input.offHoursReplyEnabled),
      input.offHoursTemplate,
    );
  return getWorkingHours();
}

export function listConversations(): Conversation[] {
  return getDb()
    .query<ConversationRow, []>("SELECT * FROM conversation ORDER BY updated_at DESC")
    .all()
    .map(mapConversation);
}

export function getConversation(idValue: string): Conversation {
  const row = getDb()
    .query<ConversationRow, [string]>("SELECT * FROM conversation WHERE id = ?")
    .get(idValue);
  if (!row) {
    throw new Error(`Conversation ${idValue} was not found.`);
  }
  return mapConversation(row);
}

export function listMessages(conversationId: string): Message[] {
  return getDb()
    .query<MessageRow, [string]>(
      "SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at ASC",
    )
    .all(conversationId)
    .map(mapMessage);
}

export function upsertConversation(input: {
  bossConversationId: string;
  candidateName: string;
  jobName?: string | null;
  latestMessage?: string | null;
  latestMessageAt?: string | null;
  unreadCount?: number;
}): Conversation {
  const existing = getDb()
    .query<ConversationRow, [string]>(
      "SELECT * FROM conversation WHERE boss_conversation_id = ?",
    )
    .get(input.bossConversationId);
  const rowId = existing?.id ?? id("conv");
  const nextStatus: ConversationStatus =
    existing?.status === "HUMAN" || existing?.status === "CLOSED" ? existing.status : "NEW";
  getDb()
    .query(
      `INSERT INTO conversation
       (id, boss_conversation_id, candidate_name, job_setting_id, job_name, status, message_count,
        wecom_send_count, latest_message, latest_message_at, human_takeover_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 0, 0, ?, ?, NULL, ?)
       ON CONFLICT(boss_conversation_id) DO UPDATE SET
         candidate_name = excluded.candidate_name,
         job_name = excluded.job_name,
         latest_message = excluded.latest_message,
         latest_message_at = excluded.latest_message_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      rowId,
      input.bossConversationId,
      input.candidateName,
      input.jobName ?? null,
      nextStatus,
      input.latestMessage ?? null,
      input.latestMessageAt ?? null,
      nowIso(),
    );
  return getConversation(rowId);
}

export function setConversationStatus(
  conversationId: string,
  status: ConversationStatus,
): Conversation {
  const humanTakeoverAt = status === "HUMAN" ? nowIso() : null;
  getDb()
    .query(
      `UPDATE conversation
       SET status = ?, human_takeover_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(status, humanTakeoverAt, nowIso(), conversationId);
  return getConversation(conversationId);
}

export function insertMessage(input: {
  conversationId: string;
  sender: MessageSender;
  text: string;
  sentAt?: string | null;
  sourceHash: string;
}): Message | null {
  const rowId = id("msg");
  const createdAt = nowIso();
  const result = getDb()
    .query(
      `INSERT OR IGNORE INTO message
       (id, conversation_id, sender, text, sent_at, source_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      input.conversationId,
      input.sender,
      input.text,
      input.sentAt ?? null,
      input.sourceHash,
      createdAt,
    );
  if (result.changes === 0) {
    return null;
  }
  getDb()
    .query(
      `UPDATE conversation
       SET message_count = message_count + 1,
           latest_message = ?,
           latest_message_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(input.text, input.sentAt ?? createdAt, createdAt, input.conversationId);
  const row = getDb().query<MessageRow, [string]>("SELECT * FROM message WHERE id = ?").get(rowId);
  if (!row) {
    throw new Error(`Message ${rowId} was not saved.`);
  }
  return mapMessage(row);
}

export function incrementWecomSendCount(conversationId: string): Conversation {
  getDb()
    .query(
      `UPDATE conversation
       SET wecom_send_count = wecom_send_count + 1, updated_at = ?
       WHERE id = ?`,
    )
    .run(nowIso(), conversationId);
  return getConversation(conversationId);
}

export function enqueue(input: {
  type: QueueType;
  bossAccountId?: string;
  conversationId?: string | null;
  payload?: Record<string, unknown>;
}): QueueItem {
  const rowId = id("queue");
  getDb()
    .query(
      `INSERT INTO queue_item
       (id, type, status, boss_account_id, conversation_id, payload_json, current_step,
        error_message, created_at, started_at, finished_at)
       VALUES (?, ?, 'QUEUED', ?, ?, ?, NULL, NULL, ?, NULL, NULL)`,
    )
    .run(
      rowId,
      input.type,
      input.bossAccountId ?? "default",
      input.conversationId ?? null,
      JSON.stringify(input.payload ?? {}),
      nowIso(),
    );
  return getQueueItem(rowId);
}

export function getQueueItem(idValue: string): QueueItem {
  const row = getDb()
    .query<QueueItemRow, [string]>("SELECT * FROM queue_item WHERE id = ?")
    .get(idValue);
  if (!row) {
    throw new Error(`Queue item ${idValue} was not found.`);
  }
  return mapQueueItem(row);
}

export function listQueue(limit = 50): QueueItem[] {
  return getDb()
    .query<QueueItemRow, [number]>(
      "SELECT * FROM queue_item ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit)
    .map(mapQueueItem);
}

export function claimNextQueueItem(): QueueItem | null {
  const db = getDb();
  const row = db
    .query<QueueItemRow, []>(
      "SELECT * FROM queue_item WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1",
    )
    .get();
  if (!row) {
    return null;
  }
  const startedAt = nowIso();
  const result = db
    .query(
      `UPDATE queue_item
       SET status = 'RUNNING', started_at = ?, current_step = 'claimed'
       WHERE id = ? AND status = 'QUEUED'`,
    )
    .run(startedAt, row.id);
  if (result.changes === 0) {
    return null;
  }
  return getQueueItem(row.id);
}

export function updateQueueStep(queueId: string, currentStep: string): QueueItem {
  getDb()
    .query("UPDATE queue_item SET current_step = ? WHERE id = ?")
    .run(currentStep, queueId);
  return getQueueItem(queueId);
}

export function finishQueueItem(queueId: string, status: Exclude<QueueStatus, "QUEUED" | "RUNNING">, errorMessage?: string): QueueItem {
  getDb()
    .query(
      `UPDATE queue_item
       SET status = ?, error_message = ?, finished_at = ?
       WHERE id = ?`,
    )
    .run(status, errorMessage ?? null, nowIso(), queueId);
  return getQueueItem(queueId);
}

export function insertLog(input: {
  level: LogLevel;
  event: string;
  bossAccountId?: string | null;
  conversationId?: string | null;
  queueItemId?: string | null;
  message: string;
  errorDetail?: string | null;
}): AutomationLog {
  const rowId = id("log");
  getDb()
    .query(
      `INSERT INTO automation_log
       (id, level, event, boss_account_id, conversation_id, queue_item_id, message, error_detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rowId,
      input.level,
      input.event,
      input.bossAccountId ?? null,
      input.conversationId ?? null,
      input.queueItemId ?? null,
      input.message,
      input.errorDetail ?? null,
      nowIso(),
    );
  const row = getDb()
    .query<AutomationLogRow, [string]>("SELECT * FROM automation_log WHERE id = ?")
    .get(rowId);
  if (!row) {
    throw new Error(`Log ${rowId} was not saved.`);
  }
  return mapAutomationLog(row);
}

export function listLogs(limit = 100): AutomationLog[] {
  return getDb()
    .query<AutomationLogRow, [number]>(
      "SELECT * FROM automation_log ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit)
    .map(mapAutomationLog);
}

export function getDashboardSummary(): DashboardSummary {
  return {
    account: getAccount(),
    queue: listQueue(10),
    metrics: {
      todayConversations: getDb()
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM conversation WHERE date(updated_at) = date('now')")
        .get()?.count ?? 0,
      todayAiReplies: getDb()
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM message WHERE sender = 'ai' AND date(created_at) = date('now')",
        )
        .get()?.count ?? 0,
      todayWecomSends: getDb()
        .query<{ count: number }, []>(
          "SELECT COALESCE(SUM(wecom_send_count), 0) AS count FROM conversation WHERE date(updated_at) = date('now')",
        )
        .get()?.count ?? 0,
      latestFailures: getDb()
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM queue_item WHERE status = 'FAILED'",
        )
        .get()?.count ?? 0,
    },
  };
}
