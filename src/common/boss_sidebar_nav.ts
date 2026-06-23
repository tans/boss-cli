import type { Page } from 'puppeteer-core';

const SIDEBAR_NAV_WAIT_MS = 15_000;

/**
 * 点击 Boss 左侧 `.menu-list` 中的菜单项，并等待导航到给定 pathname（如 `/web/chat/index`）。
 */
export async function clickBossSidebarMenuToPath(
  page: Page,
  menuLabel: string,
  targetPath: string,
): Promise<void> {
  const args = JSON.stringify({ label: menuLabel, path: targetPath });
  const clicked = (await page.evaluate(
    `((args) => {
      const { label, path } = args;
      const norm = (v) => (v ?? "").replace(/\\s+/g, "");
      const links = Array.from(document.querySelectorAll(".menu-list a"));
      const target = links.find((a) => {
        const href = a.getAttribute("href") ?? "";
        if (href.includes(path)) {
          return true;
        }
        const text = norm(a.querySelector(".menu-item-content span")?.textContent ?? a.textContent);
        return text.includes(label);
      });
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      target.scrollIntoView({ block: "center", inline: "nearest" });
      target.click();
      return true;
    })(${args})`,
  )) as boolean;

  if (!clicked) {
    throw new Error(`未找到侧边栏菜单“${menuLabel}”，无法跳转到 ${targetPath}。`);
  }

  await page.waitForFunction(
    `(() => {
      const path = ${JSON.stringify(targetPath)};
      try {
        const p = window.location.pathname.replace(/\\/+$/, "") || "/";
        return p === path;
      } catch {
        return false;
      }
    })()`,
    { timeout: SIDEBAR_NAV_WAIT_MS },
  );
}
