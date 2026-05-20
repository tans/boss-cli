# boss-cli — Boss直聘自动化命令行工具

[![npm version](https://img.shields.io/npm/v/@joohw/boss-cli)](https://www.npmjs.com/package/@joohw/boss-cli)
[![npm downloads](https://img.shields.io/npm/dm/@joohw/boss-cli)](https://www.npmjs.com/package/@joohw/boss-cli)
[![license](https://img.shields.io/github/license/joohw/boss-cli)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/joohw/boss-cli)](https://github.com/joohw/boss-cli)

**boss-cli** 是开源的 Boss直聘自动化 CLI 工具，基于 Puppeteer / CDP 驱动本机 Chrome，把 Boss直聘沟通页的核心操作全部搬进终端。支持**候选人列表**、**批量发消息**、**自动打招呼**、**简历获取**、**深度搜索**等，可独立使用，也可作为 AI Agent 的子进程工具，实现全自动化招聘流水线。

```bash
npm install -g @joohw/boss-cli@latest
boss help
```

> 本仓库是**纯 CLI**，不内置对话式 Agent。接上任何支持工具调用的 LLM（Claude、GPT、Gemini 等），即可让 AI 代替 HR 完成 Boss直聘日常操作。

---

## 为什么选择 boss-cli？

| 需求 | boss-cli 的解法 |
| --- | --- |
| Boss直聘批量发消息 | `boss send` 向当前会话发送任意文本，配合脚本循环即可批量 |
| Boss直聘自动打招呼 | `boss greet <序号>` 对推荐候选人一键打招呼 |
| Boss直聘候选人筛选 | `boss list` 读取全部聊天列表，`--unread` 过滤未读 |
| Boss直聘脚本/爬虫 | 使用本机 Chrome + CDP，无需 Selenium，反检测能力更强 |
| HR 工作 AI 自动化 | 每条命令输出纯文本，AI Agent 可直接解析并编排多步流程 |
| 无侵入、数据本地 | Cookie 和缓存仅落在 `~/.boss-cli/`，不经过任何第三方服务器 |

---

## 依赖

- Node.js **≥ 20**
- 本机 **Chrome / Chromium**（通过 CDP 连接，不随包下载）

---

## 安装

### 全局安装（推荐）

```bash
npm install -g @joohw/boss-cli@latest
boss help
```

> **macOS / Linux 权限问题**：系统 Node 默认全局前缀在 `/usr/local`，当前账户无写权限。建议先把全局前缀挪到用户目录（一次性配置）：
>
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix ~/.npm-global
> echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc   # bash 用 ~/.bash_profile
> source ~/.zshrc
> ```
>
> 使用 `fnm` / `nvm` / `volta` 的用户可跳过此步。Windows 用户无需此步。

业务数据落在 `~/.boss-cli/` 用户目录，由 CLI 进程自动创建。

### 从源码构建

```bash
git clone https://github.com/joohw/boss-cli.git
cd boss-cli
npm install
npm run build
# 构建产物入口：dist/cli/index.js
```

---

## 命令一览

| 用法 | 说明 |
| --- | --- |
| `boss` | 交互模式（REPL） |
| `boss help` | 打印帮助 |
| `boss version` / `ver` / `-v` / `--version` | 显示版本并检查 npm 是否有更新 |
| `boss login` | 打开 Boss直聘 登录页（需手动完成扫码/验证） |
| `boss list [--unread]` | 读取「全部」聊天列表候选人；`--unread` 仅显示未读 |
| `boss chat <姓名> [--strict]` | 打开指定联系人会话；默认模糊匹配，`--strict` 精确匹配 |
| `boss action <操作> [--remark <备注>]` | 在当前会话执行操作（见下） |
| `boss send [--text <内容>] [-t <内容>]` | 向当前会话发送文本消息 |
| `boss positions` | 读取职位列表（含开放/待开放/已关闭） |
| `boss jd <名称或序号>` | 抓取职位详情并缓存为 `~/.boss-cli/jd/<name>.md` |
| `boss deep-search [岗位]` / `boss deep-search set ...` | 深度搜索：读列表或触发「立即匹配」；`set` 配置筛选条件 |
| `boss recommend [岗位关键字]` | 进入推荐页读取推荐候选人列表 |
| `boss greet <姓名或序号>` | 对推荐候选人点击「打招呼」（有次数限制，请谨慎） |

**`action` 可用操作**：`resume`（索要简历）、`not-fit`（不合适）、`remark`（备注，需 `--remark <内容>`）、`agree-resume`（同意查看简历）、`history`（查看沟通记录）、`exchange-wechat`（交换微信）。

### 交互模式

- 支持单引号/双引号包裹含空格参数
- 启动时展示版本号与 GitHub 提示，执行期间显示进度动画
- 输入 `help` 查看帮助，`exit` / `quit` 或 **Ctrl+C** 退出

---

## 典型使用场景

### 日常招聘流程自动化

```bash
# 1. 登录 Boss直聘
boss login

# 2. 查看未读候选人
boss list --unread

# 3. 打开某位候选人会话
boss chat 张三

# 4. 发送消息（Boss直聘批量发消息场景）
boss send --text "您好，我们正在招聘前端工程师，请问方便发一下简历吗？"

# 5. 索要简历
boss action resume
```

### 推荐候选人自动打招呼

```bash
# 查看前端工程师推荐列表
boss recommend 前端工程师

# 对第 1 位候选人打招呼（Boss直聘自动打招呼）
boss greet 1
```

### 职位管理与深度搜索

```bash
# 查看所有职位
boss positions

# 缓存职位 JD（方便 Agent 读取）
boss jd 前端工程师

# 触发深度搜索立即匹配
boss deep-search 前端工程师
```

---

## 与 AI Agent 集成

boss-cli 的每条命令输出纯文本结构化结果，天然适合 Claude、GPT、Gemini 等 LLM 通过子进程调用，构建**全自动化招聘 Agent**：

```
# Agent 编排示例（伪代码）
1. 运行 boss list --unread  → 获取未读候选人列表
2. 对每位候选人：
   - boss chat <姓名>        → 打开会话
   - boss action resume      → 索要简历
   - boss send -t "..."      → 发送个性化消息
3. 运行 boss recommend       → 读取推荐候选人
4. boss greet <序号>         → 批量打招呼
```

详见仓库内 [AGENTS.md](./AGENTS.md)。

---

## 数据目录

| 路径 | 内容 |
| --- | --- |
| `~/.boss-cli/.cache/` | Cookie、浏览器用户数据目录 |
| `~/.boss-cli/jd/` | 通过 `boss jd` 缓存的岗位描述 `.md` |

---

## Headless / Headful

- 默认 **headful**（显示浏览器窗口），便于扫码登录和调试
- 无头运行（适合服务器/CI）：设置环境变量 `BOSS_BROWSER_HEADLESS=true`

```bash
# macOS / Linux
export BOSS_BROWSER_HEADLESS=true

# Windows PowerShell
$env:BOSS_BROWSER_HEADLESS="true"
```

---

## 开发

| 命令 | 作用 |
| --- | --- |
| `npm run build` | `tsc` 编译到 `dist/` |
| `npm run dev` | 先 `build` 再进入交互模式 |

---

## 许可

本项目以 **GNU General Public License v3.0**（GPL-3.0）发布，详见 [LICENSE](./LICENSE)。

---

## 相关链接

- npm：[@joohw/boss-cli](https://www.npmjs.com/package/@joohw/boss-cli)
- GitHub：[joohw/boss-cli](https://github.com/joohw/boss-cli)
- 问题反馈：[Issues](https://github.com/joohw/boss-cli/issues)

---

<!-- SEO keywords: boss-cli Boss直聘自动化 Boss直聘CLI Boss直聘脚本 Boss直聘爬虫 Boss直聘批量发消息 Boss直聘自动打招呼 招聘自动化工具 HR自动化 Boss直聘Agent AI招聘助手 Puppeteer Boss直聘 候选人管理自动化 boss direct 自动化 bosszp 自动化 -->
