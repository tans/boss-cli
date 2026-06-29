import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BossChatSnapshot } from "@boss/shared";

type AgentConfig = {
  agentName: string;
  language: string;
  scenario: string;
  escalateSalary: boolean;
  wecomMaxSends: number;
};

type ScalarYamlValue = string | number | boolean;
type YamlValue = ScalarYamlValue | string[];

type AgentFiles = {
  config: AgentConfig;
  recruitingPrompt: string;
  knowledge: string;
  flow: string[];
};

type Intent =
  | "job_inquiry"
  | "interview_scheduling"
  | "application_status"
  | "salary_question"
  | "candidate_screening"
  | "general";

type Escalation = {
  kind: "escalate";
  reason: string;
};

type Reply = {
  kind: "reply";
  text: string;
  wecomIncluded: boolean;
};

export type AiReplyAgentResult = Escalation | Reply;

export type AiReplyAgentInput = {
  candidateName: string;
  jobName: string;
  wecomId: string;
  wecomSendCount: number;
  chatRules: string;
  latestCandidateText: string;
  snapshot: BossChatSnapshot;
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const defaultAgentFilesDir = join(repoRoot, "agent-files");

function parseScalar(rawValue: string, file: string, lineNumber: number): ScalarYamlValue {
  const value = rawValue.trim();
  if (!value) {
    throw new Error(`${file}:${lineNumber} YAML 标量值不能为空。`);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const quote = value[0];
  if ((quote === `"` || quote === `'`) && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlRecord(text: string, file: string): Record<string, YamlValue> {
  const out: Record<string, YamlValue> = {};
  let currentListKey: string | null = null;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (currentListKey) {
      const listMatch = rawLine.match(/^\s+-\s+(.+)$/);
      if (listMatch) {
        (out[currentListKey] as string[]).push(String(parseScalar(listMatch[1]!, file, lineNumber)));
        continue;
      }
      currentListKey = null;
    }

    const keyMatch = rawLine.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!keyMatch) {
      throw new Error(`${file}:${lineNumber} 仅支持顶层 key: value 或 key: 后接列表。`);
    }
    const key = keyMatch[1]!;
    const rawValue = keyMatch[2] ?? "";
    if (!rawValue.trim()) {
      out[key] = [];
      currentListKey = key;
      continue;
    }
    out[key] = parseScalar(rawValue, file, lineNumber);
  }

  return out;
}

function requireString(record: Record<string, YamlValue>, key: string, file: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${file} 缺少字符串配置：${key}`);
  }
  return value.trim();
}

function requireBoolean(record: Record<string, YamlValue>, key: string, file: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${file} 缺少布尔配置：${key}`);
  }
  return value;
}

function requirePositiveInteger(record: Record<string, YamlValue>, key: string, file: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${file} 缺少正整数配置：${key}`);
  }
  return value;
}

function requireStringArray(record: Record<string, YamlValue>, key: string, file: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !item.trim())) {
    throw new Error(`${file} 缺少非空字符串列表：${key}`);
  }
  return value;
}

function formatChatHistory(snapshot: BossChatSnapshot): string {
  return snapshot.messages
    .map((message) => {
      const sender =
        message.sender === "candidate" ? "候选人" : message.sender === "hr" ? "HR" : message.sender;
      const sentAt = message.sentAt ? ` ${message.sentAt}` : "";
      return `[${sender}${sentAt}] ${message.text}`;
    })
    .join("\n");
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function detectIntent(text: string): Intent {
  if (includesAny(text, ["岗位", "职位", "JD", "招聘"])) {
    return "job_inquiry";
  }
  if (includesAny(text, ["面试", "预约", "时间"])) {
    return "interview_scheduling";
  }
  if (includesAny(text, ["进度", "结果", "状态"])) {
    return "application_status";
  }
  if (includesAny(text, ["薪资", "工资", "薪水", "待遇", "offer"])) {
    return "salary_question";
  }
  if (includesAny(text, ["简历", "经验", "技能", "背景", "年限", "到岗"])) {
    return "candidate_screening";
  }
  return "general";
}

function salaryQuestionNeedsEscalation(text: string): boolean {
  return includesAny(text, ["薪资多少", "工资多少", "薪水多少", "薪资范围", "薪资待遇", "待遇怎么样", "offer"]);
}

function shouldEscalate(text: string, intent: Intent, config: AgentConfig): string | null {
  if (includesAny(text, ["人工", "真人", "投诉"])) {
    return "候选人要求人工处理。";
  }
  if (includesAny(text, ["歧视", "违法", "劳动仲裁"])) {
    return "候选人消息涉及争议、法律或歧视风险。";
  }
  if (intent === "salary_question" && config.escalateSalary && salaryQuestionNeedsEscalation(text)) {
    return "候选人询问薪资待遇，需要人工确认。";
  }
  return null;
}

function currentFlowStep(intent: Intent, flow: string[], snapshot: BossChatSnapshot): string {
  if (intent !== "candidate_screening") {
    return "无固定流程";
  }
  const answeredCount = snapshot.messages.filter((message) => message.sender === "candidate").length;
  return flow[Math.min(answeredCount, flow.length - 1)]!;
}

function loadAgentFiles(baseDir = defaultAgentFilesDir): AgentFiles {
  const configFile = "config.yaml";
  const flowFile = "flow.yaml";
  const configYaml = parseYamlRecord(readFileSync(join(baseDir, configFile), "utf8"), configFile);
  const flowYaml = parseYamlRecord(readFileSync(join(baseDir, flowFile), "utf8"), flowFile);
  return {
    config: {
      agentName: requireString(configYaml, "agentName", configFile),
      language: requireString(configYaml, "language", configFile),
      scenario: requireString(configYaml, "scenario", configFile),
      escalateSalary: requireBoolean(configYaml, "escalateSalary", configFile),
      wecomMaxSends: requirePositiveInteger(configYaml, "wecomMaxSends", configFile),
    },
    recruitingPrompt: readFileSync(join(baseDir, "recruiting.md"), "utf8").trim(),
    knowledge: readFileSync(join(baseDir, "knowledge.md"), "utf8").trim(),
    flow: requireStringArray(flowYaml, "steps", flowFile),
  };
}

function buildPrompt(files: AgentFiles, input: AiReplyAgentInput, intent: Intent, flowStep: string): string {
  const mustIncludeWecom = input.wecomSendCount < files.config.wecomMaxSends;
  const wecomInstruction = mustIncludeWecom
    ? `本轮必须自然引导候选人添加企业微信：${input.wecomId}`
    : "本轮不需要重复发送企业微信。";

  return `
${files.recruitingPrompt}

Agent 配置：
- 名称：${files.config.agentName}
- 语言：${files.config.language}
- 场景：${files.config.scenario}

公司与岗位知识：
${files.knowledge}

当前会话上下文：
- 候选人：${input.candidateName}
- 沟通岗位：${input.jobName}
- 简历状态：${input.snapshot.hasResume ? "已获取" : "未获取"}
- 候选人基础信息：${input.snapshot.basicFacts.join(" / ") || "未读取到"}
- 当前用户意图：${intent}
- 当前流程步骤：${flowStep}
- 企业微信规则：${wecomInstruction}

后台聊天规则：
${input.chatRules}

完整聊天消息：
${formatChatHistory(input.snapshot) || "暂无"}

用户最新输入：
${input.latestCandidateText}

请生成要发送给候选人的回复。
要求：
- 只基于以上文件和会话上下文回答
- 不编造薪资、岗位、面试结果、录用结果
- 如果信息不足，继续追问
- 回复简洁、专业、友好
- 只输出将发送给候选人的正文，不要输出解释、标签或代码块
`.trim();
}

async function callOpenAIChatCompletion(input: {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  prompt: string;
}): Promise<string> {
  const apiKey = input.apiKey?.trim();
  const baseUrl = input.baseUrl.trim();
  if (!apiKey) {
    throw new Error("AI API Key 未配置，请先在 AI 设置中保存 API Key。");
  }
  if (!baseUrl) {
    throw new Error("AI 接口地址未配置，请先在 AI 设置中保存 OpenAI 兼容接口地址。");
  }
  if (!input.model.trim()) {
    throw new Error("AI 模型未配置。");
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
    }),
  });

  const bodyText = await response.text();
  let body: OpenAIChatCompletionResponse;
  try {
    body = JSON.parse(bodyText) as OpenAIChatCompletionResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAI 兼容接口响应不是合法 JSON：${message}`);
  }

  if (!response.ok) {
    const detail = body.error?.message || bodyText;
    throw new Error(`OpenAI 兼容接口请求失败：${endpoint}；HTTP ${response.status} ${response.statusText}；${detail}`);
  }

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI 兼容接口响应缺少 choices[0].message.content。");
  }
  return content.trim();
}

export class AiReplyAgent {
  private readonly files: AgentFiles;

  constructor(baseDir = defaultAgentFilesDir) {
    this.files = loadAgentFiles(baseDir);
  }

  async chat(
    input: AiReplyAgentInput,
    llm: {
      apiKey: string | null;
      model: string;
      baseUrl: string;
    },
  ): Promise<AiReplyAgentResult> {
    const intent = detectIntent(input.latestCandidateText);
    const escalationReason = shouldEscalate(input.latestCandidateText, intent, this.files.config);
    if (escalationReason) {
      return {
        kind: "escalate",
        reason: escalationReason,
      };
    }

    if (!input.chatRules.trim()) {
      throw new Error("AI 聊天规则未配置，请先在聊天规则页面保存规则。");
    }

    const mustIncludeWecom = input.wecomSendCount < this.files.config.wecomMaxSends;
    if (mustIncludeWecom && !input.wecomId.trim()) {
      throw new Error(`岗位 ${input.jobName} 未配置企业微信，无法生成 AI 回复。`);
    }

    const prompt = buildPrompt(
      this.files,
      input,
      intent,
      currentFlowStep(intent, this.files.flow, input.snapshot),
    );
    const text = await callOpenAIChatCompletion({
      apiKey: llm.apiKey,
      model: llm.model,
      baseUrl: llm.baseUrl,
      prompt,
    });

    if (mustIncludeWecom && !text.includes(input.wecomId)) {
      throw new Error(`AI 回复未包含岗位 ${input.jobName} 的企业微信：${input.wecomId}`);
    }

    return {
      kind: "reply",
      text,
      wecomIncluded: mustIncludeWecom,
    };
  }
}
