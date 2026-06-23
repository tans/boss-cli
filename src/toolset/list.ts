import type { Page } from 'puppeteer-core';
import { createHash } from 'node:crypto';
import { LIST_MIN_BEFORE_EMPTY_OK_MS, LIST_POLL_MS, sleepRandom } from '../browser/index.js';
import { isBossChatIndexUrl } from '../common/auth.js';
import { withBossSessionPage } from '../common/boss_session_page.js';
import { clickBossSidebarMenuToPath } from '../common/boss_sidebar_nav.js';

export type CandidateItem = {
  bossConversationId: string;
  stableSource: string;
  name: string;
  job: string;
  time: string;
  message: string;
  unreadCount: number;
};

type CandidateDomItem = Omit<CandidateItem, 'bossConversationId'> & {
  stableSource: string;
};

export type ChatFilterLabel = '全部' | '归档';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function bossConversationIdFromStableSource(stableSource: string): string {
  if (!stableSource.trim()) {
    throw new Error('Boss 会话缺少可定位的 DOM 标识，无法生成稳定 conversation id。');
  }
  return hash(stableSource).slice(0, 24);
}

function mapCandidateDomItem(item: CandidateDomItem): CandidateItem {
  return {
    bossConversationId: bossConversationIdFromStableSource(item.stableSource),
    stableSource: item.stableSource,
    name: item.name,
    job: item.job,
    time: item.time,
    message: item.message,
    unreadCount: item.unreadCount,
  };
}

async function waitForCandidateListSettled(
  page: Page,
  opts: { timeoutMs: number; pollMsMin: number; pollMsMax: number; minMsBeforeEmptyOk: number },
): Promise<void> {
  const start = Date.now();
  let prev = -1;
  let stable = 0;
  while (Date.now() - start < opts.timeoutMs) {
    const n = (await page.evaluate(
      `(() => document.querySelectorAll(".geek-item").length)()`,
    )) as number;
    const elapsed = Date.now() - start;
    if (n === prev) {
      stable++;
    } else {
      prev = n;
      stable = 1;
    }
    if (stable >= 2) {
      if (n > 0) {
        return;
      }
      if (n === 0 && elapsed >= opts.minMsBeforeEmptyOk) {
        return;
      }
    }
    await sleepRandom(opts.pollMsMin, opts.pollMsMax);
  }
}

async function clickChatFilterTab(page: Page, label: ChatFilterLabel): Promise<void> {
  const clicked = (await page.evaluate(
    `((targetText) => {
    const container = document.querySelector(".chat-message-filter-left");
    if (!container) {
      throw new Error("未找到聊天列表筛选容器（.chat-message-filter-left）。");
    }
    const spans = Array.from(container.querySelectorAll("span"));
    const norm = (v) => (v ?? "").replace(/\\s+/g, "");
    const target = spans.find((el) => norm(el.textContent).includes(targetText));
    if (!target) return false;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    target.click();
    return true;
  })`,
    label,
  )) as boolean;
  if (!clicked) {
    throw new Error(`未找到聊天列表筛选标签：${label}`);
  }
}

async function waitForChatFilterSelected(page: Page, label: ChatFilterLabel): Promise<void> {
  await page.waitForFunction(
    `((targetText) => {
      const container = document.querySelector(".chat-message-filter-left");
      if (!container) return false;
      const norm = (v) => (v ?? "").replace(/\\s+/g, "");
      const tabs = Array.from(container.querySelectorAll("span"));
      const targetTab = tabs.find((el) => norm(el.textContent).includes(targetText));
      if (!targetTab) return false;
      const cls = String(targetTab.className || "");
      const selectedByClass = /active|selected|current|checked/.test(cls);
      const selectedByAria = targetTab.getAttribute("aria-selected") === "true";
      const selectedByAncestor = !!targetTab.closest(".active, .selected, .current, .checked");
      return selectedByClass || selectedByAria || selectedByAncestor;
    })`,
    { timeout: 6_000 },
    label,
  );
}

/**
 * 与 `list` 一致：若当前不在沟通列表则点侧栏「沟通」进入 `/web/chat/index`，
 * 再点左侧筛选「全部」并等待列表稳定。`chat` 在按姓名找人前需处于该状态。
 */
export async function ensureChatIndexAllFilter(page: Page): Promise<void> {
  await ensureChatIndexFilter(page, '全部');
}

export async function ensureChatIndexFilter(page: Page, label: ChatFilterLabel): Promise<void> {
  const currentUrl = page.url();
  if (!isBossChatIndexUrl(currentUrl)) {
    await clickBossSidebarMenuToPath(page, '沟通', '/web/chat/index');
  }

  if (!isBossChatIndexUrl(page.url())) {
    throw new Error('通过侧边栏“沟通”进入聊天列表页失败，请确认已登录并可访问 /web/chat/index。');
  }

  await page.waitForFunction(
    `(() => {
      const filter = document.querySelector(".chat-message-filter-left");
      if (!filter) return false;
      const tabs = Array.from(filter.querySelectorAll("span"));
      if (tabs.length < 2) return false;
      const list = document.querySelector(".chat-list, .chat-item-list, .geek-list");
      const hasItems = document.querySelectorAll(".geek-item").length > 0;
      return !!list || hasItems;
    })()`,
    { timeout: 12_000 },
  );

  await clickChatFilterTab(page, label);
  await waitForChatFilterSelected(page, label);
  await waitForCandidateListSettled(page, {
    timeoutMs: 14_000,
    pollMsMin: LIST_POLL_MS.min,
    pollMsMax: LIST_POLL_MS.max,
    minMsBeforeEmptyOk: LIST_MIN_BEFORE_EMPTY_OK_MS,
  });
}

async function scrapeCandidateDomItemsOnCurrentPage(page: Page): Promise<CandidateDomItem[]> {
  return (await page.evaluate(
    `(() => {
      const norm = (v) => (v ?? "").replace(/\\s+/g, " ").trim();
      const stableAttrNames = [
        "data-geek-id",
        "data-geekid",
        "data-uid",
        "data-user-id",
        "data-userid",
        "data-card-id",
        "data-cardid",
        "data-id",
        "data-lid",
        "data-expect-id",
        "ka",
      ];
      function stableSourceFor(el) {
        const wrap = el.closest(".geek-item-wrap") ?? el;
        const nodes = [wrap, el];
        const pairs = [];
        for (const node of nodes) {
          for (const name of stableAttrNames) {
            const value = node.getAttribute(name);
            if (value) pairs.push(name + "=" + value);
          }
          const id = node.getAttribute("id");
          if (id) pairs.push("id=" + id);
        }
        return pairs.join("|");
      }
      return Array.from(document.querySelectorAll(".geek-item")).map((el) => {
        const name = norm(el.querySelector(".geek-name")?.textContent);
        const job = norm(el.querySelector(".source-job")?.textContent);
        const time = norm(el.querySelector(".time")?.textContent);
        const message = norm(el.querySelector(".push-text")?.textContent);
        const badge = el.querySelector(".badge-count");
        let unreadCount = 0;
        if (badge) {
          const digits = norm(badge.textContent).replace(/\\D/g, "");
          if (digits) unreadCount = parseInt(digits, 10) || 0;
        }
        return { name, job, time, message, unreadCount, stableSource: stableSourceFor(el) };
      });
    })()`,
  )) as CandidateDomItem[];
}

export async function listCandidateItemsOnCurrentPage(
  page: Page,
  opts: { unreadOnly?: boolean } = {},
): Promise<CandidateItem[]> {
  const unreadOnly = opts.unreadOnly === true;
  const items = await scrapeCandidateDomItemsOnCurrentPage(page);
  const candidates = items.filter((it) => it.name).map(mapCandidateDomItem);
  return unreadOnly ? candidates.filter((it) => it.unreadCount > 0) : candidates;
}

export async function listCandidates(opts: { unreadOnly?: boolean } = {}): Promise<CandidateItem[]> {
  try {
    return await withBossSessionPage(async (page) => {
      await ensureChatIndexAllFilter(page);
      return listCandidateItemsOnCurrentPage(page, opts);
    });
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(`获取候选人列表失败：${String(e)}`);
  }
}

export type CandidateArchiveItem = CandidateItem & {
  archived: boolean;
};

export async function listCandidatesIncludingArchived(
  opts: { unreadOnly?: boolean } = {},
): Promise<CandidateArchiveItem[]> {
  try {
    return await withBossSessionPage(async (page) => {
      const seen = new Map<string, CandidateArchiveItem>();
      for (const filter of ['全部', '归档'] as const) {
        await ensureChatIndexFilter(page, filter);
        const items = await listCandidateItemsOnCurrentPage(page, opts);
        for (const item of items) {
          seen.set(item.bossConversationId, {
            ...item,
            archived: filter === '归档',
          });
        }
      }
      return Array.from(seen.values());
    });
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(`获取含归档候选人列表失败：${String(e)}`);
  }
}

export async function runGetCandidateList(
  opts: { unreadOnly?: boolean } = {},
): Promise<string> {
  const unreadOnly = opts.unreadOnly === true;

  try {
    return await withBossSessionPage(async (page) => {
      await ensureChatIndexAllFilter(page);

      const domItems = await scrapeCandidateDomItemsOnCurrentPage(page);
      const candidates = domItems.filter((it) => it.name);
      const withUnread = candidates.filter((it) => it.unreadCount > 0).length;
      const visible = unreadOnly ? candidates.filter((it) => it.unreadCount > 0) : candidates;
      const lines = visible.map((it, idx) => {
        const base = `${idx + 1}. ${it.name}${it.job ? `｜${it.job}` : ''}`;
        const meta = [
          it.unreadCount > 0 ? `未读:${it.unreadCount}` : '',
          it.time ? `时间:${it.time}` : '',
          it.message ? `消息:${it.message}` : '',
        ]
          .filter(Boolean)
          .join('｜');
        return meta ? `${base}｜${meta}` : base;
      });
      const previewText =
        lines.length > 0 ? `候选人明细：\n${lines.join('\n')}` : '候选人明细：暂无。';

      return [
        unreadOnly
          ? `未读筛选：共 ${visible.length} 人（全部列表 ${candidates.length} 人中有未读角标者 ${withUnread} 人）。`
          : `沟通列表共 ${candidates.length} 人，其中 ${withUnread} 人有未读消息。`,
        previewText,
      ]
        .filter(Boolean)
        .join('\n');
    });
  } catch (e) {
    if (e instanceof Error) {
      throw e;
    }
    throw new Error(`获取候选人列表失败：${String(e)}`);
  }
}
