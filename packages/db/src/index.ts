import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { loadAppConfig } from "@boss/config";
import type {
  AISetting,
  AISettingInput,
  AutoFilterSetting,
  AutomationLog,
  BotBehaviorSetting,
  BossAccount,
  Conversation,
  ConversationAnalysis,
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
  WorkerHeartbeat,
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

    CREATE TABLE IF NOT EXISTS auto_filter_setting (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      min_age INTEGER,
      max_age INTEGER,
      allowed_educations_json TEXT NOT NULL,
      reject_message_template TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS bot_behavior_setting (
      id TEXT PRIMARY KEY,
      worker_poll_ms INTEGER NOT NULL,
      unread_listen_loop_min_ms INTEGER NOT NULL,
      unread_listen_loop_max_ms INTEGER NOT NULL,
      archive_open_delay_min_ms INTEGER NOT NULL DEFAULT 3000,
      archive_open_delay_max_ms INTEGER NOT NULL DEFAULT 7000,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation (
      id TEXT PRIMARY KEY,
      boss_conversation_id TEXT NOT NULL UNIQUE,
      candidate_name TEXT NOT NULL,
      job_setting_id TEXT REFERENCES job_setting(id),
      job_name TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
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
      result_message TEXT,
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

    CREATE TABLE IF NOT EXISTS worker_heartbeat (
      id TEXT PRIMARY KEY,
      last_seen_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "queue_item", "result_message", "TEXT");
  ensureColumn(db, "conversation", "archived", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "bot_behavior_setting", "archive_open_delay_min_ms", "INTEGER NOT NULL DEFAULT 3000");
  ensureColumn(db, "bot_behavior_setting", "archive_open_delay_max_ms", "INTEGER NOT NULL DEFAULT 7000");
  ensureColumn(db, "auto_filter_setting", "reject_message_template", "TEXT NOT NULL DEFAULT ''");
  renameColumnIfPresent(db, "bot_behavior_setting", "listen_loop_min_ms", "unread_listen_loop_min_ms");
  renameColumnIfPresent(db, "bot_behavior_setting", "listen_loop_max_ms", "unread_listen_loop_max_ms");
}

function ensureColumn(db: Database, tableName: string, columnName: string, definition: string): void {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${tableName})`).all();
  if (rows.some((row) => row.name === columnName)) {
    return;
  }
  db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

function renameColumnIfPresent(
  db: Database,
  tableName: string,
  fromColumnName: string,
  toColumnName: string,
): void {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${tableName})`).all();
  const hasFrom = rows.some((row) => row.name === fromColumnName);
  const hasTo = rows.some((row) => row.name === toColumnName);
  if (!hasFrom) {
    return;
  }
  if (hasTo) {
    throw new Error(`Cannot rename ${tableName}.${fromColumnName}: ${toColumnName} already exists.`);
  }
  db.query(`ALTER TABLE ${tableName} RENAME COLUMN ${fromColumnName} TO ${toColumnName}`).run();
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
      [
        "## AI人设",
        "你是招聘专员 AI 助手，负责在 BOSS 直聘聊天中协助 HR 与候选人沟通。",
        "你必须保持简洁、专业、友好，不要表现成客服机器人或销售。",
        "你只负责岗位咨询、信息收集、初步匹配和引导添加企业微信。",
        "你不能承诺录用、薪资、面试结果或任何未配置的信息。",
        "",
        "## 公司背景",
        "候选人询问公司信息时，按照公司背景内容进行介绍。",
        "可以介绍公司业务、招聘流程和岗位方向。",
        "如果候选人询问未配置的信息，直接说明需要 HR 进一步确认。",
        "不要编造公司规模、融资、福利、团队人数或办公地址。",
        "",
        "## 岗位信息",
        "候选人问岗位内容时，先概括岗位职责，再询问其相关经验。",
        "候选人问地点时，回答已配置地点；未配置具体地址时说明以后续 HR 确认为准。",
        "候选人问薪资时，不承诺具体数字，先询问期望薪资范围。",
        "候选人问流程时，说明招聘流程，并提示具体安排由 HR 确认。",
        "",
        "## 沟通逻辑",
        "下面是你要开展的工作步骤，请一步一步进行，推动事件发展。",
        "1. 如果候选人没有提问，先问候选人想了解的岗位或当前求职意向。",
        "2. 确认岗位后，询问候选人的工作年限、核心技能和最近一段经历。",
        "3. 如果岗位有城市要求，询问候选人当前所在城市，以及是否接受该城市工作。",
        "4. 如果候选人提出薪资问题，先询问期望薪资，不直接承诺具体数字。",
        "5. 当候选人基本匹配且愿意继续沟通时，引导添加企业微信，并提醒备注姓名、岗位和所在地。",
        "6. 如果候选人问公司或岗位情况，按照公司背景和岗位信息回答；信息不足时直接说明需要 HR 确认。",
        "7. 如果候选人表达拒绝、不匹配或需要人工处理，礼貌结束或转人工。",
        "",
        "## 主动索要信息",
        "优先收集候选人的目标岗位、工作年限、核心技能、期望薪资、到岗时间、所在城市和简历状态。",
        "每一轮只问一个最关键的问题，等待候选人回答后再推进下一步。",
        "候选人已经提供的信息不要重复索要。",
        "如果候选人提供的信息不完整，明确指出缺少哪一项并继续追问。",
        "",
        "## 注意事项",
        "不编造岗位、薪资、面试结果、录用结果、福利和公司信息。",
        "不暴露内部评价，不解释详细拒绝原因。",
        "涉及争议、法律、歧视、强烈情绪、投诉或候选人要求人工时，转人工。",
        "岗位未配置企业微信时，不生成替代联系方式，应直接暴露配置错误。",
        "输出只包含要发送给候选人的正文，不输出解释、标签或代码块。",
      ].join("\n"),
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

  const filter = db.query("SELECT id FROM auto_filter_setting WHERE id = 'default'").get();
  if (!filter) {
    db.query(
      `INSERT INTO auto_filter_setting
       (id, enabled, min_age, max_age, allowed_educations_json, reject_message_template)
       VALUES ('default', 0, NULL, NULL, ?, '')`,
    ).run(JSON.stringify(["本科", "硕士", "博士"]));
  }

  const behavior = db.query("SELECT id FROM bot_behavior_setting WHERE id = 'default'").get();
  if (!behavior) {
    const config = loadAppConfig();
    db.query(
      `INSERT INTO bot_behavior_setting
       (id, worker_poll_ms, unread_listen_loop_min_ms, unread_listen_loop_max_ms,
        archive_open_delay_min_ms, archive_open_delay_max_ms, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?)`,
    ).run(
      config.workerPollMs,
      config.unreadListenLoopMinMs,
      config.unreadListenLoopMaxMs,
      3000,
      7000,
      nowIso(),
    );
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

type AutoFilterSettingRow = {
  id: string;
  enabled: number;
  min_age: number | null;
  max_age: number | null;
  allowed_educations_json: string;
  reject_message_template: string;
};

type BotBehaviorSettingRow = {
  id: string;
  worker_poll_ms: number;
  unread_listen_loop_min_ms: number;
  unread_listen_loop_max_ms: number;
  archive_open_delay_min_ms: number;
  archive_open_delay_max_ms: number;
  updated_at: string;
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

function mapAutoFilterSetting(row: AutoFilterSettingRow): AutoFilterSetting {
  return {
    id: row.id,
    enabled: fromBool(row.enabled),
    minAge: row.min_age,
    maxAge: row.max_age,
    allowedEducations: JSON.parse(row.allowed_educations_json) as string[],
    rejectMessageTemplate: row.reject_message_template,
  };
}

function mapBotBehaviorSetting(row: BotBehaviorSettingRow): BotBehaviorSetting {
  return {
    id: row.id,
    workerPollMs: row.worker_poll_ms,
    unreadListenLoopMinMs: row.unread_listen_loop_min_ms,
    unreadListenLoopMaxMs: row.unread_listen_loop_max_ms,
    archiveOpenDelayMinMs: row.archive_open_delay_min_ms,
    archiveOpenDelayMaxMs: row.archive_open_delay_max_ms,
    updatedAt: row.updated_at,
  };
}

type ConversationRow = {
  id: string;
  boss_conversation_id: string;
  candidate_name: string;
  job_setting_id: string | null;
  job_name: string | null;
  archived: DbBoolean;
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
    archived: fromBool(row.archived),
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
  result_message: string | null;
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
    resultMessage: row.result_message,
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

type WorkerHeartbeatRow = {
  id: string;
  last_seen_at: string;
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

export function getAutoFilterSetting(): AutoFilterSetting {
  const row = getDb()
    .query<AutoFilterSettingRow, []>("SELECT * FROM auto_filter_setting WHERE id = 'default'")
    .get();
  if (!row) {
    throw new Error("Default auto filter setting was not initialized.");
  }
  return mapAutoFilterSetting(row);
}

export function updateAutoFilterSetting(input: Omit<AutoFilterSetting, "id">): AutoFilterSetting {
  if (input.minAge !== null && input.minAge <= 0) {
    throw new Error("Auto filter min age must be a positive number.");
  }
  if (input.maxAge !== null && input.maxAge <= 0) {
    throw new Error("Auto filter max age must be a positive number.");
  }
  if (input.minAge !== null && input.maxAge !== null && input.minAge > input.maxAge) {
    throw new Error("Auto filter min age cannot be greater than max age.");
  }
  const educations = input.allowedEducations.map((item) => item.trim()).filter(Boolean);
  const rejectMessageTemplate = input.rejectMessageTemplate.trim();
  if (input.enabled && !rejectMessageTemplate) {
    throw new Error("Auto filter reject message template is required when auto filter is enabled.");
  }
  getDb()
    .query(
      `UPDATE auto_filter_setting
       SET enabled = ?, min_age = ?, max_age = ?, allowed_educations_json = ?, reject_message_template = ?
       WHERE id = 'default'`,
    )
    .run(
      bool(input.enabled),
      input.minAge,
      input.maxAge,
      JSON.stringify(educations),
      rejectMessageTemplate,
    );
  return getAutoFilterSetting();
}

export function getBotBehaviorSetting(): BotBehaviorSetting {
  const row = getDb()
    .query<BotBehaviorSettingRow, []>("SELECT * FROM bot_behavior_setting WHERE id = 'default'")
    .get();
  if (!row) {
    throw new Error("Default bot behavior setting was not initialized.");
  }
  return mapBotBehaviorSetting(row);
}

export function updateBotBehaviorSetting(input: Omit<BotBehaviorSetting, "id" | "updatedAt">): BotBehaviorSetting {
  if (!Number.isInteger(input.workerPollMs) || input.workerPollMs <= 0) {
    throw new Error("Worker poll interval must be a positive integer.");
  }
  if (!Number.isInteger(input.unreadListenLoopMinMs) || input.unreadListenLoopMinMs <= 0) {
    throw new Error("Unread listen loop minimum interval must be a positive integer.");
  }
  if (!Number.isInteger(input.unreadListenLoopMaxMs) || input.unreadListenLoopMaxMs <= 0) {
    throw new Error("Unread listen loop maximum interval must be a positive integer.");
  }
  if (input.unreadListenLoopMinMs > input.unreadListenLoopMaxMs) {
    throw new Error("Unread listen loop minimum interval cannot be greater than maximum interval.");
  }
  if (!Number.isInteger(input.archiveOpenDelayMinMs) || input.archiveOpenDelayMinMs <= 0) {
    throw new Error("Archive open delay minimum must be a positive integer.");
  }
  if (!Number.isInteger(input.archiveOpenDelayMaxMs) || input.archiveOpenDelayMaxMs <= 0) {
    throw new Error("Archive open delay maximum must be a positive integer.");
  }
  if (input.archiveOpenDelayMinMs > input.archiveOpenDelayMaxMs) {
    throw new Error("Archive open delay minimum cannot be greater than maximum interval.");
  }
  getDb()
    .query(
      `UPDATE bot_behavior_setting
       SET worker_poll_ms = ?,
           unread_listen_loop_min_ms = ?,
           unread_listen_loop_max_ms = ?,
           archive_open_delay_min_ms = ?,
           archive_open_delay_max_ms = ?,
           updated_at = ?
       WHERE id = 'default'`,
    )
    .run(
      input.workerPollMs,
      input.unreadListenLoopMinMs,
      input.unreadListenLoopMaxMs,
      input.archiveOpenDelayMinMs,
      input.archiveOpenDelayMaxMs,
      nowIso(),
    );
  return getBotBehaviorSetting();
}

export function listConversations(): Conversation[] {
  return getDb()
    .query<ConversationRow, []>("SELECT * FROM conversation ORDER BY updated_at DESC")
    .all()
    .map(mapConversation);
}

export function listArchivedConversations(): Conversation[] {
  return getDb()
    .query<ConversationRow, []>(
      "SELECT * FROM conversation WHERE archived = 1 ORDER BY updated_at DESC",
    )
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
  archived?: boolean;
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
       (id, boss_conversation_id, candidate_name, job_setting_id, job_name, archived, status, message_count,
        wecom_send_count, latest_message, latest_message_at, human_takeover_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 0, ?, ?, NULL, ?)
       ON CONFLICT(boss_conversation_id) DO UPDATE SET
         candidate_name = excluded.candidate_name,
         job_name = excluded.job_name,
         archived = excluded.archived,
         latest_message = excluded.latest_message,
         latest_message_at = excluded.latest_message_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      rowId,
      input.bossConversationId,
      input.candidateName,
      input.jobName ?? null,
      bool(input.archived === true),
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
        result_message, error_message, created_at, started_at, finished_at)
       VALUES (?, ?, 'QUEUED', ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL)`,
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

export function finishQueueItemWithResult(input: {
  queueId: string;
  status: Exclude<QueueStatus, "QUEUED" | "RUNNING">;
  resultMessage?: string | null;
  errorMessage?: string | null;
}): QueueItem {
  getDb()
    .query(
      `UPDATE queue_item
       SET status = ?, result_message = ?, error_message = ?, finished_at = ?
       WHERE id = ?`,
    )
    .run(
      input.status,
      input.resultMessage ?? null,
      input.errorMessage ?? null,
      nowIso(),
      input.queueId,
    );
  return getQueueItem(input.queueId);
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

const WORKER_HEARTBEAT_ID = "default";
const WORKER_STALE_AFTER_SECONDS = 15;

export function recordWorkerHeartbeat(): WorkerHeartbeat {
  const seenAt = nowIso();
  getDb()
    .query(
      `INSERT INTO worker_heartbeat (id, last_seen_at)
       VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    )
    .run(WORKER_HEARTBEAT_ID, seenAt);
  return getWorkerHeartbeat();
}

export function getWorkerHeartbeat(now = new Date()): WorkerHeartbeat {
  const row = getDb()
    .query<WorkerHeartbeatRow, [string]>("SELECT * FROM worker_heartbeat WHERE id = ?")
    .get(WORKER_HEARTBEAT_ID);
  const lastSeenAt = row?.last_seen_at ?? null;
  const isAlive = lastSeenAt
    ? now.getTime() - new Date(lastSeenAt).getTime() <= WORKER_STALE_AFTER_SECONDS * 1000
    : false;
  return {
    id: WORKER_HEARTBEAT_ID,
    lastSeenAt,
    staleAfterSeconds: WORKER_STALE_AFTER_SECONDS,
    isAlive,
  };
}

export function getDashboardSummary(): DashboardSummary {
  return {
    account: getAccount(),
    worker: getWorkerHeartbeat(),
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

export function getConversationAnalysis(): ConversationAnalysis {
  const conversationTotals = getDb()
    .query<{
      conversations: number;
      archived_conversations: number;
      active_conversations: number;
      wecom_sends: number;
    }, []>(
      `SELECT
         COUNT(*) AS conversations,
         COALESCE(SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END), 0) AS archived_conversations,
         COALESCE(SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END), 0) AS active_conversations,
         COALESCE(SUM(wecom_send_count), 0) AS wecom_sends
       FROM conversation`,
    )
    .get();
  if (!conversationTotals) {
    throw new Error("Conversation analysis totals query returned no row.");
  }

  const messageTotals = getDb()
    .query<{
      messages: number;
      candidate_messages: number;
      hr_messages: number;
      ai_messages: number;
    }, []>(
      `SELECT
         COUNT(*) AS messages,
         COALESCE(SUM(CASE WHEN sender = 'candidate' THEN 1 ELSE 0 END), 0) AS candidate_messages,
         COALESCE(SUM(CASE WHEN sender = 'hr' THEN 1 ELSE 0 END), 0) AS hr_messages,
         COALESCE(SUM(CASE WHEN sender = 'ai' THEN 1 ELSE 0 END), 0) AS ai_messages
       FROM message`,
    )
    .get();
  if (!messageTotals) {
    throw new Error("Conversation analysis message totals query returned no row.");
  }

  const byStatus = getDb()
    .query<{ status: ConversationStatus; count: number }, []>(
      `SELECT status, COUNT(*) AS count
       FROM conversation
       GROUP BY status
       ORDER BY count DESC, status ASC`,
    )
    .all();

  const byJob = getDb()
    .query<{
      job_name: string;
      conversation_count: number;
      message_count: number;
      wecom_sends: number;
    }, []>(
      `SELECT
         job_name,
         COUNT(*) AS conversation_count,
         COALESCE(SUM(message_count), 0) AS message_count,
         COALESCE(SUM(wecom_send_count), 0) AS wecom_sends
       FROM (
         SELECT
           COALESCE(NULLIF(c.job_name, ''), '未识别岗位') AS job_name,
           c.wecom_send_count,
           COUNT(m.id) AS message_count
         FROM conversation c
         LEFT JOIN message m ON m.conversation_id = c.id
         GROUP BY c.id
       ) rows
       GROUP BY job_name
       ORDER BY conversation_count DESC, message_count DESC, job_name ASC
       LIMIT 20`,
    )
    .all();

  return {
    totals: {
      conversations: conversationTotals.conversations,
      archivedConversations: conversationTotals.archived_conversations,
      activeConversations: conversationTotals.active_conversations,
      messages: messageTotals.messages,
      candidateMessages: messageTotals.candidate_messages,
      hrMessages: messageTotals.hr_messages,
      aiMessages: messageTotals.ai_messages,
      wecomSends: conversationTotals.wecom_sends,
    },
    byStatus,
    byJob: byJob.map((row) => ({
      jobName: row.job_name,
      conversationCount: row.conversation_count,
      messageCount: row.message_count,
      wecomSends: row.wecom_sends,
    })),
  };
}
