import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

export type BossListItem = {
  bossConversationId: string;
  candidateName: string;
  jobName: string | null;
  unreadCount: number;
  latestMessage: string | null;
  latestMessageAt: string | null;
};

export type BossChatMessage = {
  sender: "candidate" | "ai" | "hr" | "system";
  text: string;
  sentAt: string | null;
  sourceHash: string;
};

export type BossChatSnapshot = {
  candidateName: string;
  jobName: string | null;
  messages: BossChatMessage[];
  hasResume: boolean;
};

export type BossPosition = {
  bossJobId: string;
  name: string;
};

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliEntry = join(repoRoot, "dist", "cli", "index.js");

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableConversationId(candidateName: string, jobName: string | null): string {
  return hash(`${candidateName}|${jobName ?? ""}`).slice(0, 24);
}

export async function listUnreadBossConversations(): Promise<BossListItem[]> {
  const output = await runBossCli(["list", "--unread"]);
  return parseCandidateList(output);
}

export async function listBossPositions(): Promise<BossPosition[]> {
  const output = await runBossCli(["positions"]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^\d+\.\s*(.+?)(?:｜|$)/);
      if (!match) {
        return null;
      }
      const name = match[1]?.trim();
      if (!name) {
        return null;
      }
      return {
        bossJobId: hash(name).slice(0, 24),
        name,
      };
    })
    .filter((item): item is BossPosition => item !== null);
}

export async function openBossConversation(
  candidateName: string,
): Promise<BossChatSnapshot> {
  const output = await runBossCli(["chat", candidateName]);
  return parseChatSnapshot(output, candidateName);
}

export async function sendBossMessage(text: string): Promise<string> {
  return runBossCli(["send", "--text", text]);
}

async function runBossCli(args: string[]): Promise<string> {
  try {
    await access(cliEntry);
  } catch {
    throw new Error(`Boss CLI build not found at ${cliEntry}. Run npm run build before starting the worker.`);
  }
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
  if (stderr.trim()) {
    throw new Error(stderr.trim());
  }
  return stdout;
}

function parseCandidateList(output: string): BossListItem[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s/.test(line))
    .map((line) => {
      const withoutIndex = line.replace(/^\d+\.\s*/, "");
      const parts = withoutIndex.split("｜").map((part) => part.trim());
      const candidateName = parts[0] ?? "";
      const jobName = parts[1] && !parts[1].startsWith("未读:") ? parts[1] : null;
      const unreadRaw = parts.find((part) => part.startsWith("未读:"));
      const timeRaw = parts.find((part) => part.startsWith("时间:"));
      const messageRaw = parts.find((part) => part.startsWith("消息:"));
      const unreadCount = Number.parseInt(unreadRaw?.replace("未读:", "") ?? "0", 10) || 0;
      return {
        bossConversationId: stableConversationId(candidateName, jobName),
        candidateName,
        jobName,
        unreadCount,
        latestMessageAt: timeRaw?.replace("时间:", "") || null,
        latestMessage: messageRaw?.replace("消息:", "") || null,
      };
    })
    .filter((item) => item.candidateName.length > 0);
}

function parseChatSnapshot(output: string, fallbackName: string): BossChatSnapshot {
  const candidateName =
    output.match(/成功进入候选人聊天：(.+)/)?.[1]?.trim() ||
    output.match(/姓名:\s*(.+)/)?.[1]?.trim() ||
    fallbackName;
  const jobName = output.match(/沟通职位:\s*(.+)/)?.[1]?.trim() ?? null;
  const hasResume = output.includes("简历获取状态: 已获取");
  const messagesStart = output.indexOf("完整聊天消息：");
  const messageLines =
    messagesStart === -1 ? [] : output.slice(messagesStart).split("\n").slice(1);
  const messages = messageLines
    .map((line, index): BossChatMessage | null => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "(暂无)") {
        return null;
      }
      const match = trimmed.match(/^\[(candidate|you|system|unknown)\](?:\s+([^\s]+))?\s*(.*)$/);
      if (!match) {
        return null;
      }
      const rawSender = match[1];
      const sender =
        rawSender === "candidate"
          ? "candidate"
          : rawSender === "you"
            ? "hr"
            : rawSender === "system"
              ? "system"
              : "system";
      const sentAt = match[2] ?? null;
      const text = match[3]?.trim() ?? "";
      if (!text) {
        return null;
      }
      return {
        sender,
        sentAt,
        text,
        sourceHash: hash(`${candidateName}|${index}|${sender}|${sentAt ?? ""}|${text}`),
      };
    })
    .filter((item): item is BossChatMessage => item !== null);

  return {
    candidateName,
    jobName,
    messages,
    hasResume,
  };
}
