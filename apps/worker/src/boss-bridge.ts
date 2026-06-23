import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withBossSessionPage } from "../../../src/common/boss_session_page.js";
import { listOpenPositionsWithStableIds } from "../../../src/toolset/jd.js";
import { listCandidates, listCandidatesIncludingArchived } from "../../../src/toolset/list.js";
import { openCandidateChatSnapshot } from "../../../src/toolset/chat.js";

export type BossListItem = {
  bossConversationId: string;
  conversationStableSource: string;
  candidateName: string;
  jobName: string | null;
  archived: boolean;
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
  basicFacts: string[];
  messages: BossChatMessage[];
  hasResume: boolean;
};

export type BossPosition = {
  bossJobId: string;
  name: string;
};

export type BossAccountSnapshot = {
  nickname: string;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliEntry = join(repoRoot, "dist", "cli", "index.js");

function mapSender(from: "friend" | "myself" | "system" | "unknown"): BossChatMessage["sender"] {
  if (from === "friend") {
    return "candidate";
  }
  if (from === "myself") {
    return "hr";
  }
  return "system";
}

export async function listUnreadConversations(): Promise<BossListItem[]> {
  const items = await listCandidates({ unreadOnly: true });
  return items.map((item) => ({
    bossConversationId: item.bossConversationId,
    conversationStableSource: item.stableSource,
    candidateName: item.name,
    jobName: item.job || null,
    archived: false,
    unreadCount: item.unreadCount,
    latestMessage: item.message || null,
    latestMessageAt: item.time || null,
  }));
}

export async function listAllConversations(): Promise<BossListItem[]> {
  const items = await listCandidatesIncludingArchived();
  return items.map((item) => ({
    bossConversationId: item.bossConversationId,
    conversationStableSource: item.stableSource,
    candidateName: item.name,
    jobName: item.job || null,
    archived: item.archived,
    unreadCount: item.unreadCount,
    latestMessage: item.message || null,
    latestMessageAt: item.time || null,
  }));
}

export async function readAccountSnapshot(): Promise<BossAccountSnapshot> {
  return withBossSessionPage(async (page) => {
    const snapshot = (await page.evaluate(`(() => {
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const selectors = [
        ".user-name",
        "span.user-name",
        "[class*='user-name']",
        ".label-name",
        ".nav-user .name",
        ".nav-user-name",
        "a.nav-user",
        ".header-nav [class*='name']",
        ".user-info [class*='name']",
      ];
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          const text = norm(node.textContent);
          if (text && !/^(我要登录|登录|注册|登录\\/注册)$/u.test(text)) {
            return { nickname: text };
          }
        }
      }
      const bodyText = document.body instanceof HTMLElement ? document.body.innerText || "" : "";
      if (/\\b我要登录\\b/u.test(bodyText)) {
        throw new Error("Boss 当前页面显示未登录入口，无法读取账号信息。");
      }
      throw new Error("Boss 已进入主界面，但未找到账号昵称节点。");
    })()`)) as BossAccountSnapshot;
    return snapshot;
  });
}

export async function listPositions(): Promise<BossPosition[]> {
  const positions = await listOpenPositionsWithStableIds();
  return positions.map((position) => {
    if (!position.id) {
      throw new Error(`Boss 职位 ${position.title} 缺少 DOM data-id，无法同步为稳定岗位。`);
    }
    return {
      bossJobId: position.id,
      name: position.title,
    };
  });
}

export async function openConversationSnapshot(input: {
  candidateName: string;
  bossConversationId: string;
  archived?: boolean;
}): Promise<BossChatSnapshot> {
  const snapshot = await withBossSessionPage((page) =>
    openCandidateChatSnapshot(
      page,
      input.candidateName,
      true,
      input.bossConversationId,
      input.archived ? "归档" : "全部",
    ),
  );
  return {
    candidateName: snapshot.candidateName,
    jobName: snapshot.jobName || null,
    basicFacts: snapshot.summary.basicFacts,
    hasResume: snapshot.hasResume,
    messages: snapshot.messages.map((message, index) => {
      const sender = mapSender(message.from);
      return {
        sender,
        sentAt: message.time || null,
        text: message.text,
        sourceHash: hash(
          [
            snapshot.candidateName,
            snapshot.jobName,
            index,
            sender,
            message.time,
            message.text,
          ].join("|"),
        ),
      };
    }),
  };
}

export async function sendMessage(text: string): Promise<string> {
  try {
    await access(cliEntry);
  } catch {
    throw new Error(`Boss CLI build not found at ${cliEntry}. Run npm run build before starting the worker.`);
  }
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, "send", "--text", text], {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 1024 * 1024 * 10,
  });
  if (stderr.trim()) {
    throw new Error(stderr.trim());
  }
  return stdout;
}
