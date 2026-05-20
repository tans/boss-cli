# boss-cli · Boss直聘 终端自动化 CLI

> **关键词**：boss-cli · Boss直聘自动化 · Boss直聘 CLI · Boss直聘 Agent · 招聘自动化 · HR自动化 · Puppeteer Boss直聘 · boss-direct 自动化 · 终端招聘工具

[![npm version](https://img.shields.io/npm/v/@joohw/boss-cli)](https://www.npmjs.com/package/@joohw/boss-cli)
[![npm downloads](https://img.shields.io/npm/dm/@joohw/boss-cli)](https://www.npmjs.com/package/@joohw/boss-cli)
[![license](https://img.shields.io/github/license/joohw/boss-cli)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/joohw/boss-cli)](https://github.com/joohw/boss-cli)

**boss-cli** 是一个把 Boss 直聘沟通页搬进终端的自动化命令行工具。支持**登录**、**候选人列表**、**打开会话**、**发送消息**、**打招呼**、**深度搜索**等操作，基于 Puppeteer / CDP 驱动本机 Chrome，可作为独立 CLI 使用，也可由 AI Agent（如 Claude、GPT）通过子进程调用，实现全自动化招聘流水线。

> 本仓库是**纯 CLI**（不内置对话式 Agent），适合脚本或外层 AI Agent 编排。想让 Agent 帮你做 HR？接上任何支持工具调用的 LLM 即可。

```bash
npm install -g @joohw/boss-cli@latest
boss help
```

---

## 为什么用 boss-cli？

- **Boss直聘自动化**：无需手动打开网页，在终端完成候选人沟通、打招呼、发简历等全流程
- **AI Agent 友好**：每条命令输出结构清晰，Claude / GPT 等 Agent 可直接解析并编排多步招聘流程
- **无侵入**：使用本机 Chrome，Cookie 落在本地，不经过任何第三方服务器
- **轻量**：纯 CLI，不依赖 Electron，不捆绑浏览器，开箱即用

---

## 依赖

- Node.js **≥ 20**
- 本机 **Chrome / Chromium**（由 Puppeteer 通过 CDP 连接，不随包下载）

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
| `boss login` | 打开登录页（需手动完成扫码/验证） |
| `boss list [--unread]` | 读取「全部」聊天列表候选人；`--unread` 仅显示未读 |
| `boss chat <姓名> [--strict]` | 打开指定联系人会话；默认模糊匹配，`--strict` 精确匹配 |
| `boss action <操作> [--remark <备注>]` | 在当前会话执行操作（见下） |
| `boss send [--text <内容>] [-t <内容>]` | 向当前会话发送文本消息 |
| `boss positions` | 读取职位列表（含开放/待开放/已关闭） |
| `boss jd <名称或序号>` | 抓取职位详情并缓存为 `~/.boss-cli/jd/<name>.md` |
| `boss deep-search [岗位]` / `boss deep-search set ...` | 深度搜索：读列表或触发「立即匹配」；`set` 配置筛选条件 |
| `boss recommend [岗位关键字]` | 进入推荐页读取推荐候选人列表 |
| `boss greet <姓名或序号>` | 对推荐候选人点击「打招呼」（有次数限制，请谨慎） |

**`action` 可用操作**：`resume`、`not-fit`、`remark`、`agree-resume`、`history`、`exchange-wechat`。操作为 `remark` 时需附加 `--remark <备注>`。

### 交互模式

- 支持单引号/双引号包裹含空格参数
- 启动时展示版本号与 GitHub 提示，执行期间显示进度动画
- 输入 `help` 查看帮助，`exit` / `quit` 或 **Ctrl+C** 退出

---

## 典型使用场景

```bash
# 1. 登录
boss login

# 2. 查看未读候选人
boss list --unread

# 3. 打开某位候选人会话
boss chat 张三

# 4. 发送消息
boss send --text "您好，请问方便加微信进一步沟通吗？"

# 5. 查看推荐候选人并打招呼
boss recommend 前端工程师
boss greet 1
```

---

## 与 AI Agent 集成

boss-cli 的每条命令都以纯文本输出结构化结果，天然适合 AI Agent 编排：

```
# 让 Claude / GPT 等 Agent 调用 boss-cli 子进程
boss list --unread   # → 输出候选人列表，Agent 解析后决策
boss chat <姓名>      # → 打开会话
boss send -t "..."   # → 发送消息
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
- 无头运行：设置环境变量 `BOSS_BROWSER_HEADLESS=true`

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
