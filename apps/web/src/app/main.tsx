import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ActivityIcon,
  BarChart3Icon,
  BotIcon,
  BriefcaseBusinessIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ClockIcon,
  FileTextIcon,
  GaugeIcon,
  KeyRoundIcon,
  Loader2Icon,
  LogInIcon,
  LogsIcon,
  MessageSquareTextIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RouteIcon,
  Settings2Icon,
  UserCheckIcon,
} from "lucide-react";
import { toast } from "sonner";

import type {
  AISetting,
  AutomationLog,
  BotBehaviorSetting,
  Conversation,
  ConversationAnalysis,
  ConversationStatus,
  DashboardSummary,
  JobSetting,
  Message,
  QueueItem,
  QueueStatus,
  WorkingHours,
} from "@boss/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";

import "./styles.css";

type PageId =
  | "dashboard"
  | "jobs"
  | "rules"
  | "autoFilter"
  | "ai"
  | "behavior"
  | "analytics"
  | "conversations"
  | "hours"
  | "logs";

const navItems = [
  { id: "dashboard", label: "仪表盘", icon: GaugeIcon },
  { id: "analytics", label: "分析", icon: BarChart3Icon },
  { id: "conversations", label: "会话中心", icon: MessageSquareTextIcon },
  { id: "jobs", label: "岗位管理", icon: BriefcaseBusinessIcon },
  { id: "rules", label: "聊天规则", icon: FileTextIcon },
  { id: "autoFilter", label: "自动筛选", icon: Settings2Icon },
  { id: "ai", label: "AI设置", icon: BotIcon },
  { id: "behavior", label: "机器人行为", icon: Settings2Icon },
  { id: "hours", label: "工作时间", icon: CalendarClockIcon },
  { id: "logs", label: "日志", icon: LogsIcon },
] satisfies Array<{ id: PageId; label: string; icon: typeof KeyRoundIcon }>;

const pageTitles: Record<PageId, string> = {
  dashboard: "仪表盘",
  jobs: "岗位管理",
  rules: "聊天规则",
  autoFilter: "自动筛选",
  ai: "AI设置",
  behavior: "机器人行为",
  analytics: "分析",
  conversations: "会话中心",
  hours: "工作时间",
  logs: "日志",
};

type ChatRuleConfig = {
  id: string;
  label: string;
  title: string;
  description: string;
  suggestedContent: string;
  workflow: string[];
};

const chatRuleConfigs = [
  {
    id: "PERSONA",
    label: "AI人设",
    title: "AI人设：招聘专员助手",
    description: "明确 AI 在聊天中的身份、语气和职责边界。",
    suggestedContent: [
      "你是招聘专员 AI 助手，负责在 BOSS 直聘聊天中协助 HR 与候选人沟通。",
      "你必须保持简洁、专业、友好，不要表现成客服机器人或销售。",
      "你只负责岗位咨询、信息收集、初步匹配和引导添加企业微信。",
      "你不能承诺录用、薪资、面试结果或任何未配置的信息。",
    ].join("\n"),
    workflow: ["确认身份", "保持专业", "聚焦招聘", "不越权承诺"],
  },
  {
    id: "COMPANY",
    label: "公司背景",
    title: "公司背景：基于资料介绍",
    description: "候选人询问公司、团队、流程时，只基于后台资料回答。",
    suggestedContent: [
      "候选人询问公司信息时，按照公司背景内容进行介绍。",
      "可以介绍公司业务、招聘流程和岗位方向。",
      "如果候选人询问未配置的信息，直接说明需要 HR 进一步确认。",
      "不要编造公司规模、融资、福利、团队人数或办公地址。",
    ].join("\n"),
    workflow: ["识别公司问题", "基于资料回答", "说明待确认项", "继续推进"],
  },
  {
    id: "JOB",
    label: "岗位信息",
    title: "岗位信息：围绕岗位匹配",
    description: "候选人问岗位内容、要求、地点、薪资时，先回答可确认信息，再追问匹配信息。",
    suggestedContent: [
      "候选人问岗位内容时，先概括岗位职责，再询问其相关经验。",
      "候选人问地点时，回答已配置地点；未配置具体地址时说明以后续 HR 确认为准。",
      "候选人问薪资时，不承诺具体数字，先询问期望薪资范围。",
      "候选人问流程时，说明招聘流程，并提示具体安排由 HR 确认。",
    ].join("\n"),
    workflow: ["回答岗位问题", "追问经验", "确认意向", "推进后续"],
  },
  {
    id: "FLOW",
    label: "沟通逻辑",
    title: "沟通逻辑：标准工作流",
    description: "参考截图的做法，把聊天拆成可执行步骤，逐步推动候选人完成初筛。",
    suggestedContent: [
      "下面是你要开展的工作步骤，请一步一步进行，推动事件发展。",
      "1. 如果候选人没有提问，先问候选人想了解的岗位或当前求职意向。",
      "2. 确认岗位后，询问候选人的工作年限、核心技能和最近一段经历。",
      "3. 如果岗位有城市要求，询问候选人当前所在城市，以及是否接受该城市工作。",
      "4. 如果候选人提出薪资问题，先询问期望薪资，不直接承诺具体数字。",
      "5. 当候选人基本匹配且愿意继续沟通时，引导添加企业微信，并提醒备注姓名、岗位和所在地。",
      "6. 如果候选人问公司或岗位情况，按照公司背景和岗位信息回答；信息不足时直接说明需要 HR 确认。",
      "7. 如果候选人表达拒绝、不匹配或需要人工处理，礼貌结束或转人工。",
    ].join("\n"),
    workflow: ["确认意向", "收集信息", "判断匹配", "引导企微"],
  },
  {
    id: "INFO_COLLECTION",
    label: "主动索要信息",
    title: "主动索要信息：单轮一个问题",
    description: "按招聘初筛需要收集信息，避免一次性追问过多。",
    suggestedContent: [
      "优先收集候选人的目标岗位、工作年限、核心技能、期望薪资、到岗时间、所在城市和简历状态。",
      "每一轮只问一个最关键的问题，等待候选人回答后再推进下一步。",
      "候选人已经提供的信息不要重复索要。",
      "如果候选人提供的信息不完整，明确指出缺少哪一项并继续追问。",
    ].join("\n"),
    workflow: ["识别缺口", "单点追问", "记录信息", "进入下一步"],
  },
  {
    id: "BOUNDARIES",
    label: "注意事项",
    title: "注意事项：失败和转人工边界",
    description: "明确不能回答、必须转人工和必须暴露配置问题的场景。",
    suggestedContent: [
      "不编造岗位、薪资、面试结果、录用结果、福利和公司信息。",
      "不暴露内部评价，不解释详细拒绝原因。",
      "涉及争议、法律、歧视、强烈情绪、投诉或候选人要求人工时，转人工。",
      "岗位未配置企业微信时，不生成替代联系方式，应直接暴露配置错误。",
      "输出只包含要发送给候选人的正文，不输出解释、标签或代码块。",
    ].join("\n"),
    workflow: ["不编造", "不越权", "清晰转人工", "暴露配置错误"],
  },
] satisfies ChatRuleConfig[];

type ChatRuleSectionId = (typeof chatRuleConfigs)[number]["id"];

const standardChatRules = chatRuleConfigs
  .map((config) => `## ${config.label}\n${config.suggestedContent}`)
  .join("\n\n");

function useResource<T>(loader: () => Promise<T>, deps: React.DependencyList, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await loader();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    if (!intervalMs) {
      return;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, deps);

  return { data, error, refresh };
}

function App() {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const dashboard = useResource(api.dashboard, [], 3000);
  const title = pageTitles[activePage];
  const listening = dashboard.data?.account.listeningStatus === "RUNNING";

  return (
    <StrictMode>
      <TooltipProvider>
        <SidebarProvider>
          <Sidebar collapsible="icon">
            <SidebarHeader>
              <div className="flex items-center gap-2 px-2 py-2">
                <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <BotIcon />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Boss Chat MVP</span>
                </div>
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>产品页面</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={activePage === item.id}
                          onClick={() => setActivePage(item.id)}
                          tooltip={item.label}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
              <div className="flex flex-col gap-2 p-2">
                <Badge variant={listening ? "default" : "secondary"} className="w-fit">
                  {listening ? "监听中" : "已停止"}
                </Badge>
              </div>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-medium">{title}</h1>
              </div>
            </header>
            <main className="flex flex-1 flex-col gap-4 p-4">
              {dashboard.error && <ErrorAlert message={dashboard.error} />}
              {activePage === "dashboard" && (
                <DashboardPage summary={dashboard.data} refresh={dashboard.refresh} />
              )}
              {activePage === "jobs" && <JobsPage />}
              {activePage === "rules" && <RulesPage />}
              {activePage === "autoFilter" && <AutoFilterPage />}
              {activePage === "ai" && <AIPage />}
              {activePage === "behavior" && <BotBehaviorPage />}
              {activePage === "analytics" && <AnalyticsPage />}
              {activePage === "conversations" && <ConversationsPage />}
              {activePage === "hours" && <WorkingHoursPage />}
              {activePage === "logs" && <LogsPage />}
            </main>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </StrictMode>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>请求失败</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function DashboardPage({
  summary,
  refresh,
}: {
  summary: DashboardSummary | null;
  refresh: () => Promise<void>;
}) {
  const workerAlive = summary?.worker.isAlive === true;

  return (
    <>
      <DashboardSummaryCard
        summary={summary}
        workerAlive={workerAlive}
        refresh={refresh}
      />
      <div>
        <Card>
          <CardHeader>
            <CardTitle>自动化队列</CardTitle>
          </CardHeader>
          <CardContent>
            <QueueTable queue={summary?.queue ?? []} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function DashboardSummaryCard({
  summary,
  workerAlive,
  refresh,
}: {
  summary: DashboardSummary | null;
  workerAlive: boolean;
  refresh: () => Promise<void>;
}) {
  const account = summary?.account ?? null;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-5">
        <div className="flex min-w-64 flex-1 items-center gap-3">
          <Avatar className="size-10">
            <AvatarFallback>{account?.nickname?.[0] ?? "B"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-medium">{account?.nickname ?? "未读取昵称"}</div>
              <Badge variant={account?.loginStatus === "LOGGED_IN" ? "default" : "secondary"}>
                {account?.loginStatus ?? "UNKNOWN"}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>岗位 {account?.jobCount ?? 0}</span>
              <span>最近检查 {formatDateTime(account?.lastCheckedAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <CompactStat label="今日会话" value={String(summary?.metrics.todayConversations ?? 0)} />
          <CompactStat label="AI回复" value={String(summary?.metrics.todayAiReplies ?? 0)} />
          <CompactStatus
            label="监听"
            value={account?.listeningStatus === "RUNNING" ? "运行中" : "已停止"}
            active={account?.listeningStatus === "RUNNING"}
          />
          <CompactStatus label="Worker" value={workerAlive ? "online" : "offline"} active={workerAlive} />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await api.login();
              toast("已创建重新登录/会话检查队列任务");
              await refresh();
            }}
          >
            <LogInIcon data-icon="inline-start" />
            重新登录
          </Button>
          <Button
            onClick={async () => {
              await api.startListening();
              await refresh();
            }}
          >
            <PlayIcon data-icon="inline-start" />
            启动监听
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await api.stopListening();
              await refresh();
            }}
          >
            <PauseIcon data-icon="inline-start" />
            停止监听
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await api.syncUnread();
              toast("已创建未读同步任务");
              await refresh();
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            同步未读
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await api.syncAllConversations();
              toast("已创建全部沟通同步任务");
              await refresh();
            }}
          >
            <MessageSquareTextIcon data-icon="inline-start" />
            同步全部沟通
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await api.syncPositions();
              toast("已创建岗位同步任务");
              await refresh();
            }}
          >
            <BriefcaseBusinessIcon data-icon="inline-start" />
            同步岗位
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-16">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-none">{value}</div>
    </div>
  );
}

function CompactStatus({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="min-w-16">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">
        <Badge variant={active ? "default" : "secondary"}>{value}</Badge>
      </div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function JobsPage() {
  const jobs = useResource(api.jobs, [], 5000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = jobs.data?.find((job) => job.id === selectedId) ?? jobs.data?.[0] ?? null;

  useEffect(() => {
    if (!selectedId && jobs.data?.[0]) {
      setSelectedId(jobs.data[0].id);
    }
  }, [jobs.data, selectedId]);

  if (jobs.error) return <ErrorAlert message={jobs.error} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>岗位列表</CardTitle>
        </CardHeader>
        <CardFooter className="border-b">
          <Button
            variant="outline"
            onClick={async () => {
              await api.syncPositions();
              toast("已创建岗位同步任务");
              await jobs.refresh();
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            同步岗位
          </Button>
        </CardFooter>
        <CardContent>
          {(jobs.data ?? []).length === 0 ? (
            <EmptyAction
              title="暂无岗位"
              actionLabel="同步岗位"
              onAction={async () => {
                await api.syncPositions();
                toast("已创建岗位同步任务");
                await jobs.refresh();
              }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>岗位</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>企微</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobs.data ?? []).map((job) => (
                  <TableRow key={job.id} onClick={() => setSelectedId(job.id)}>
                    <TableCell className="font-medium">{job.name}</TableCell>
                    <TableCell>
                      <Badge variant={job.enabled ? "default" : "secondary"}>
                        {job.enabled ? "自动回复" : "暂停"}
                      </Badge>
                    </TableCell>
                    <TableCell>{job.wecomId || "未配置"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <JobEditor job={selected} refresh={jobs.refresh} />
    </div>
  );
}

function JobEditor({ job, refresh }: { job: JobSetting | null; refresh: () => Promise<void> }) {
  const [wecomId, setWecomId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [aiReply, setAiReply] = useState(true);

  useEffect(() => {
    setWecomId(job?.wecomId ?? "");
    setEnabled(job?.enabled ?? true);
    setAutoReply(job?.autoReply ?? true);
    setAiReply(job?.aiReply ?? true);
  }, [job]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{job?.name ?? "暂无岗位"}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>启用岗位</FieldTitle>
            </FieldContent>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!job} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>自动回复</FieldTitle>
            </FieldContent>
            <Switch checked={autoReply} onCheckedChange={setAutoReply} disabled={!job} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>AI增强回复</FieldTitle>
            </FieldContent>
            <Switch checked={aiReply} onCheckedChange={setAiReply} disabled={!job} />
          </Field>
          <Field>
            <FieldLabel htmlFor="wecom">企业微信</FieldLabel>
            <Input id="wecom" value={wecomId} onChange={(event) => setWecomId(event.target.value)} disabled={!job} />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button
          disabled={!job}
          onClick={async () => {
            if (!job) return;
            await api.updateJob(job.id, { enabled, autoReply, aiReply, wecomId });
            toast.success("岗位配置已保存");
            await refresh();
          }}
        >
          保存配置
        </Button>
      </CardFooter>
    </Card>
  );
}

function RulesPage() {
  const resource = useResource(api.aiSettings, []);
  const [activeSection, setActiveSection] = useState<ChatRuleSectionId>("FLOW");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!resource.data) return;
    setPrompt(resource.data.prompt);
  }, [resource.data]);

  if (resource.error) return <ErrorAlert message={resource.error} />;
  const activeConfig = chatRuleConfigs.find((config) => config.id === activeSection)!;

  return (
    <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>核心模块</CardTitle>
          <CardDescription>按聊天流程拆分规则，逐项配置。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {chatRuleConfigs.map((config) => {
            const selected = config.id === activeSection;
            return (
              <Button
                key={config.id}
                type="button"
                variant={selected ? "secondary" : "ghost"}
                className="h-auto justify-start gap-3 px-3 py-3 text-left"
                onClick={() => setActiveSection(config.id)}
              >
                <RouteIcon data-icon="inline-start" />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="truncate font-medium">{config.label}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {config.title}
                  </span>
                </span>
              </Button>
            );
          })}
        </CardContent>
      </Card>
      <ChatRuleCard
        config={activeConfig}
        prompt={prompt}
        aiSetting={resource.data}
        setPrompt={setPrompt}
        refresh={resource.refresh}
      />
    </div>
  );
}

function AutoFilterPage() {
  const resource = useResource(api.autoFilter, [], 5000);
  const [enabled, setEnabled] = useState(false);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [allowedEducations, setAllowedEducations] = useState<string[]>([]);
  const [rejectMessageTemplate, setRejectMessageTemplate] = useState("");

  useEffect(() => {
    if (!resource.data) return;
    setEnabled(resource.data.enabled);
    setMinAge(resource.data.minAge === null ? "" : String(resource.data.minAge));
    setMaxAge(resource.data.maxAge === null ? "" : String(resource.data.maxAge));
    setAllowedEducations(resource.data.allowedEducations);
    setRejectMessageTemplate(resource.data.rejectMessageTemplate);
  }, [resource.data]);

  if (resource.error) return <ErrorAlert message={resource.error} />;

  const educationOptions = ["博士", "硕士", "本科", "大专", "高中", "中专", "初中"];
  const toAge = (value: string): number | null => {
    const trimmed = value.trim();
    return trimmed ? Number.parseInt(trimmed, 10) : null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>自动筛选</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>启用自动筛选</FieldTitle>
            </FieldContent>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="filter-min-age">最低年龄</FieldLabel>
              <Input id="filter-min-age" inputMode="numeric" value={minAge} onChange={(event) => setMinAge(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="filter-max-age">最高年龄</FieldLabel>
              <Input id="filter-max-age" inputMode="numeric" value={maxAge} onChange={(event) => setMaxAge(event.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel>允许学历</FieldLabel>
            <ToggleGroup type="multiple" value={allowedEducations} onValueChange={setAllowedEducations} spacing={1}>
              {educationOptions.map((item) => (
                <ToggleGroupItem key={item} value={item}>{item}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-reject-message">筛选不通过回复</FieldLabel>
            <Textarea
              id="filter-reject-message"
              className="min-h-32"
              value={rejectMessageTemplate}
              onChange={(event) => setRejectMessageTemplate(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button
          onClick={async () => {
            await api.updateAutoFilter({
              enabled,
              minAge: toAge(minAge),
              maxAge: toAge(maxAge),
              allowedEducations,
              rejectMessageTemplate,
            });
            toast.success("自动筛选已保存");
            await resource.refresh();
          }}
        >
          保存筛选
        </Button>
      </CardFooter>
    </Card>
  );
}

function AIPage() {
  const resource = useResource(api.aiSettings, [], 5000);
  const [model, setModel] = useState("gpt-5.5");
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!resource.data) return;
    setModel(resource.data.model);
    setPrompt(resource.data.prompt);
    setApiKey("");
  }, [resource.data]);

  if (resource.error) return <ErrorAlert message={resource.error} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <Card>
        <CardHeader>
          <CardTitle>模型配置</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>模型</FieldLabel>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="gpt-5.5">gpt-5.5</SelectItem>
                    <SelectItem value="gpt-5">gpt-5</SelectItem>
                    <SelectItem value="gpt-4.1">gpt-4.1</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key">API Key</FieldLabel>
              <Input
                id="api-key"
                type="password"
                placeholder={resource.data?.apiKeySet ? "已保存，留空则不变" : "请输入 API Key"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>系统 Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="prompt">Prompt</FieldLabel>
            <Textarea id="prompt" className="min-h-72" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            onClick={async () => {
              await api.updateAISettings(apiKey ? { model, prompt, apiKey } : { model, prompt });
              toast.success("AI 设置已保存");
              await resource.refresh();
            }}
          >
            保存设置
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function BotBehaviorPage() {
  const resource = useResource(api.botBehavior, [], 5000);
  const [workerPollMs, setWorkerPollMs] = useState("");
  const [unreadListenLoopMinMs, setUnreadListenLoopMinMs] = useState("");
  const [unreadListenLoopMaxMs, setUnreadListenLoopMaxMs] = useState("");
  const [archiveOpenDelayMinMs, setArchiveOpenDelayMinMs] = useState("");
  const [archiveOpenDelayMaxMs, setArchiveOpenDelayMaxMs] = useState("");

  useEffect(() => {
    if (!resource.data) return;
    setWorkerPollMs(String(resource.data.workerPollMs));
    setUnreadListenLoopMinMs(String(resource.data.unreadListenLoopMinMs));
    setUnreadListenLoopMaxMs(String(resource.data.unreadListenLoopMaxMs));
    setArchiveOpenDelayMinMs(String(resource.data.archiveOpenDelayMinMs));
    setArchiveOpenDelayMaxMs(String(resource.data.archiveOpenDelayMaxMs));
  }, [resource.data]);

  if (resource.error) return <ErrorAlert message={resource.error} />;

  const parseMs = (label: string, value: string): number => {
    const trimmed = value.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!/^\d+$/.test(trimmed) || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${label}必须是正整数毫秒。`);
    }
    return parsed;
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>基础轮询</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="worker-poll-ms">Worker 队列轮询间隔（ms）</FieldLabel>
              <Input
                id="worker-poll-ms"
                inputMode="numeric"
                value={workerPollMs}
                onChange={(event) => setWorkerPollMs(event.target.value)}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="unread-listen-loop-min-ms">未读监听循环最小间隔（ms）</FieldLabel>
                <Input
                  id="unread-listen-loop-min-ms"
                  inputMode="numeric"
                  value={unreadListenLoopMinMs}
                  onChange={(event) => setUnreadListenLoopMinMs(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="unread-listen-loop-max-ms">未读监听循环最大间隔（ms）</FieldLabel>
                <Input
                  id="unread-listen-loop-max-ms"
                  inputMode="numeric"
                  value={unreadListenLoopMaxMs}
                  onChange={(event) => setUnreadListenLoopMaxMs(event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="archive-open-delay-min-ms">归档聊天打开最小延时（ms）</FieldLabel>
                <Input
                  id="archive-open-delay-min-ms"
                  inputMode="numeric"
                  value={archiveOpenDelayMinMs}
                  onChange={(event) => setArchiveOpenDelayMinMs(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="archive-open-delay-max-ms">归档聊天打开最大延时（ms）</FieldLabel>
                <Input
                  id="archive-open-delay-max-ms"
                  inputMode="numeric"
                  value={archiveOpenDelayMaxMs}
                  onChange={(event) => setArchiveOpenDelayMaxMs(event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            onClick={async () => {
              const next: Omit<BotBehaviorSetting, "id" | "updatedAt"> = {
                workerPollMs: parseMs("Worker 队列轮询间隔", workerPollMs),
                unreadListenLoopMinMs: parseMs("未读监听循环最小间隔", unreadListenLoopMinMs),
                unreadListenLoopMaxMs: parseMs("未读监听循环最大间隔", unreadListenLoopMaxMs),
                archiveOpenDelayMinMs: parseMs("归档聊天打开最小延时", archiveOpenDelayMinMs),
                archiveOpenDelayMaxMs: parseMs("归档聊天打开最大延时", archiveOpenDelayMaxMs),
              };
              if (next.unreadListenLoopMinMs > next.unreadListenLoopMaxMs) {
                throw new Error("未读监听循环最小间隔不能大于最大间隔。");
              }
              if (next.archiveOpenDelayMinMs > next.archiveOpenDelayMaxMs) {
                throw new Error("归档聊天打开最小延时不能大于最大延时。");
              }
              await api.updateBotBehavior(next);
              toast.success("机器人行为已保存");
              await resource.refresh();
            }}
          >
            保存行为设置
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>当前值</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>Worker 队列轮询</TableCell>
                <TableCell>{resource.data?.workerPollMs ?? ""} ms</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>未读监听循环区间</TableCell>
                <TableCell>
                  {resource.data
                    ? `${resource.data.unreadListenLoopMinMs} - ${resource.data.unreadListenLoopMaxMs} ms`
                    : ""}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>归档聊天打开延时</TableCell>
                <TableCell>
                  {resource.data
                    ? `${resource.data.archiveOpenDelayMinMs} - ${resource.data.archiveOpenDelayMaxMs} ms`
                    : ""}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>更新时间</TableCell>
                <TableCell>{resource.data?.updatedAt ?? ""}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AnalyticsPage() {
  const analysis = useResource(api.conversationAnalysis, [], 5000);

  if (analysis.error) return <ErrorAlert message={analysis.error} />;

  const data = analysis.data;
  const totals = data?.totals;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>会话分析</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api.syncAllConversations();
                  toast("已创建全部沟通含归档同步任务");
                  await analysis.refresh();
                }}
              >
                <RefreshCwIcon data-icon="inline-start" />
                同步列表
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api.syncArchivedConversations();
                  toast("已创建归档聊天记录同步任务");
                  await analysis.refresh();
                }}
              >
                <MessageSquareTextIcon data-icon="inline-start" />
                同步归档记录
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="总会话" value={totals?.conversations ?? 0} />
          <MetricTile label="归档会话" value={totals?.archivedConversations ?? 0} />
          <MetricTile label="消息总数" value={totals?.messages ?? 0} />
          <MetricTile label="企微发送" value={totals?.wecomSends ?? 0} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>消息构成</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <MetricTile label="候选人" value={totals?.candidateMessages ?? 0} compact />
            <MetricTile label="HR" value={totals?.hrMessages ?? 0} compact />
            <MetricTile label="AI" value={totals?.aiMessages ?? 0} compact />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>状态</TableHead>
                  <TableHead>数量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.byStatus ?? []).map((row) => (
                  <TableRow key={row.status}>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>岗位分布</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>岗位</TableHead>
                <TableHead>会话</TableHead>
                <TableHead>消息</TableHead>
                <TableHead>企微</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.byJob ?? []).map((row) => (
                <TableRow key={row.jobName}>
                  <TableCell className="font-medium">{row.jobName}</TableCell>
                  <TableCell>{row.conversationCount}</TableCell>
                  <TableCell>{row.messageCount}</TableCell>
                  <TableCell>{row.wecomSends}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricTile({
  label,
  value,
  compact,
}: {
  label: string;
  value: number;
  compact?: boolean;
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={compact ? "mt-2 text-2xl font-semibold" : "mt-2 text-3xl font-semibold"}>
        {value}
      </div>
    </div>
  );
}

function ConversationsPage() {
  const conversations = useResource(api.conversations, [], 3000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useResource(
    () => (selectedId ? api.conversation(selectedId) : Promise.resolve(null)),
    [selectedId],
    selectedId ? 3000 : undefined,
  );

  useEffect(() => {
    if (!selectedId && conversations.data?.[0]) {
      setSelectedId(conversations.data[0].id);
    }
  }, [conversations.data, selectedId]);

  if (conversations.error) return <ErrorAlert message={conversations.error} />;
  if (selected.error) return <ErrorAlert message={selected.error} />;

  const selectedConversation = selected.data?.conversation ?? null;
  const messages = selected.data?.messages ?? [];

  return (
    <div className="grid min-h-[calc(100vh-7rem)] gap-4 xl:grid-cols-[20rem_1fr_20rem]">
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>会话列表</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api.syncAllConversations();
                  toast("已创建全部沟通含归档同步任务");
                  await conversations.refresh();
                }}
              >
                <RefreshCwIcon data-icon="inline-start" />
                同步全部
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api.syncArchivedConversations();
                  toast("已创建归档聊天记录同步任务");
                  await conversations.refresh();
                }}
              >
                <MessageSquareTextIcon data-icon="inline-start" />
                归档记录
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[32rem]">
            <div className="flex flex-col gap-1 p-2">
              {(conversations.data ?? []).length === 0 ? (
                <EmptyAction
                  title="暂无会话"
                  actionLabel="同步全部沟通"
                  onAction={async () => {
                    await api.syncAllConversations();
                    toast("已创建全部沟通含归档同步任务");
                    await conversations.refresh();
                  }}
                />
              ) : (
                (conversations.data ?? []).map((conversation) => (
                  <Button
                    key={conversation.id}
                    variant={conversation.id === selectedId ? "secondary" : "ghost"}
                    className="h-auto justify-start"
                    onClick={() => setSelectedId(conversation.id)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                      <div className="flex w-full items-center gap-2">
                        <span className="truncate font-medium">{conversation.candidateName}</span>
                        {conversation.archived ? <Badge variant="outline">归档</Badge> : null}
                        <StatusBadge status={conversation.status} />
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {conversation.latestMessage ?? "暂无消息"}
                      </span>
                    </div>
                  </Button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{selectedConversation?.candidateName ?? "暂无会话"}</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[31rem] pr-4">
            <div className="flex flex-col gap-4">
              {messages.map((message) => (
                <div key={message.id} className="flex gap-3">
                  <Avatar>
                    <AvatarFallback>{message.sender === "candidate" ? selectedConversation?.candidateName[0] ?? "候" : message.sender === "ai" ? "AI" : "HR"}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{message.sender}</span>
                      <span className="text-muted-foreground">{message.sentAt ?? message.createdAt}</span>
                    </div>
                    <div className="rounded-md border bg-card p-3 text-sm">{message.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>会话信息</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldTitle>状态</FieldTitle>
              {selectedConversation && <StatusBadge status={selectedConversation.status} />}
            </Field>
            <Field orientation="horizontal">
              <FieldTitle>归档</FieldTitle>
              <Badge variant={selectedConversation?.archived ? "outline" : "secondary"}>
                {selectedConversation?.archived ? "是" : "否"}
              </Badge>
            </Field>
            <Field orientation="horizontal">
              <FieldTitle>沟通次数</FieldTitle>
              <Badge variant="secondary">{selectedConversation?.messageCount ?? 0}</Badge>
            </Field>
            <Field orientation="horizontal">
              <FieldTitle>企微次数</FieldTitle>
              <Badge variant="secondary">{selectedConversation?.wecomSendCount ?? 0}/2</Badge>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-2">
          <Button
            disabled={!selectedConversation}
            onClick={async () => {
              if (!selectedConversation) return;
              if (selectedConversation.status === "HUMAN") {
                await api.resumeAI(selectedConversation.id);
                toast("AI 已恢复，等待队列调度");
              } else {
                await api.takeover(selectedConversation.id);
                toast("AI 将在当前原子步骤后停止");
              }
              await conversations.refresh();
              await selected.refresh();
            }}
          >
            {selectedConversation?.status === "HUMAN" ? <BotIcon data-icon="inline-start" /> : <UserCheckIcon data-icon="inline-start" />}
            {selectedConversation?.status === "HUMAN" ? "恢复AI" : "立即接管"}
          </Button>
          <Button
            variant="outline"
            disabled={!selectedConversation || selectedConversation.archived}
            onClick={async () => {
              if (!selectedConversation) return;
              if (selectedConversation.archived) {
                throw new Error("归档会话不可入队处理。");
              }
              await api.processConversation(selectedConversation.id);
              toast("已入队处理当前会话");
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            入队处理
          </Button>
          <Button
            variant="outline"
            disabled={!selectedConversation}
            onClick={async () => {
              if (!selectedConversation) return;
              await api.closeConversation(selectedConversation.id);
              toast("会话已标记结束");
              await conversations.refresh();
              await selected.refresh();
            }}
          >
            <CheckCircle2Icon data-icon="inline-start" />
            标记结束
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function WorkingHoursPage() {
  const resource = useResource(api.workingHours, [], 5000);
  const [hours, setHours] = useState<WorkingHours | null>(null);

  useEffect(() => {
    if (resource.data) setHours(resource.data);
  }, [resource.data]);

  if (resource.error) return <ErrorAlert message={resource.error} />;
  if (!hours) return <Card><CardHeader><CardTitle>加载中</CardTitle></CardHeader></Card>;

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>工作时间</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>工作日</FieldLabel>
              <ToggleGroup type="multiple" value={hours.days.map(String)} onValueChange={(values) => setHours({ ...hours, days: values.map(Number) })} spacing={1}>
                <ToggleGroupItem value="1">一</ToggleGroupItem>
                <ToggleGroupItem value="2">二</ToggleGroupItem>
                <ToggleGroupItem value="3">三</ToggleGroupItem>
                <ToggleGroupItem value="4">四</ToggleGroupItem>
                <ToggleGroupItem value="5">五</ToggleGroupItem>
                <ToggleGroupItem value="6">六</ToggleGroupItem>
                <ToggleGroupItem value="0">日</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="start">开始</FieldLabel>
                <Input id="start" value={hours.start} onChange={(event) => setHours({ ...hours, start: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="end">结束</FieldLabel>
                <Input id="end" value={hours.end} onChange={(event) => setHours({ ...hours, end: event.target.value })} />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button
            onClick={async () => {
              await api.updateWorkingHours({
                timezone: hours.timezone,
                days: hours.days,
                start: hours.start,
                end: hours.end,
                offHoursReplyEnabled: hours.offHoursReplyEnabled,
                offHoursTemplate: hours.offHoursTemplate,
              });
              toast.success("工作时间已保存");
              await resource.refresh();
            }}
          >
            保存时间
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>非工作时间回复</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea className="min-h-48" value={hours.offHoursTemplate} onChange={(event) => setHours({ ...hours, offHoursTemplate: event.target.value })} />
        </CardContent>
      </Card>
    </div>
  );
}

function LogsPage() {
  const logs = useResource(api.logs, [], 3000);
  if (logs.error) return <ErrorAlert message={logs.error} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>运行日志</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>级别</TableHead>
              <TableHead>事件</TableHead>
              <TableHead>详情</TableHead>
              <TableHead>错误</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(logs.data ?? []).map((log) => (
              <TableRow key={log.id}>
                <TableCell>{log.createdAt}</TableCell>
                <TableCell>
                  <Badge variant={log.level === "ERROR" ? "destructive" : log.level === "WARN" ? "secondary" : "outline"}>
                    {log.level}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{log.event}</TableCell>
                <TableCell>{log.message}</TableCell>
                <TableCell>{log.errorDetail ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EmptyAction({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => Promise<void>;
}) {
  return (
    <div className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-md border border-dashed p-4">
      <div className="font-medium">{title}</div>
      <Button variant="outline" onClick={() => void onAction()}>
        <RefreshCwIcon data-icon="inline-start" />
        {actionLabel}
      </Button>
    </div>
  );
}

function QueueTable({ queue }: { queue: QueueItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>状态</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>步骤</TableHead>
          <TableHead>结果</TableHead>
          <TableHead>错误</TableHead>
          <TableHead>创建时间</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {queue.map((item) => (
          <TableRow key={item.id}>
            <TableCell><QueueBadge status={item.status} /></TableCell>
            <TableCell className="font-medium">{item.type}</TableCell>
            <TableCell>{item.currentStep ?? ""}</TableCell>
            <TableCell className="max-w-80 truncate">{item.resultMessage ?? ""}</TableCell>
            <TableCell>{item.errorMessage ?? ""}</TableCell>
            <TableCell>{item.createdAt}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ChatRuleCard({
  config,
  prompt,
  aiSetting,
  setPrompt,
  refresh,
}: {
  config: ChatRuleConfig;
  prompt: string;
  aiSetting: AISetting | null;
  setPrompt: (value: string) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card>
        <CardHeader>
          <CardTitle>{config.title}</CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor={`chat-rule-${config.id}`}>聊天规则</FieldLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPrompt(standardChatRules)}
                >
                  引用整套规则
                </Button>
              </div>
              <Textarea
                id={`chat-rule-${config.id}`}
                className="min-h-96 font-mono text-sm leading-relaxed"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {aiSetting ? `最近更新 ${formatDateTime(aiSetting.updatedAt)}` : "AI 设置未加载"}
          </span>
          <Button
            disabled={!aiSetting}
            onClick={async () => {
              if (!aiSetting) return;
              await api.updateAISettings({ model: aiSetting.model, prompt });
              toast.success("聊天规则已保存");
              await refresh();
            }}
          >
            保存规则
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>撰写思路：标准工作流</CardTitle>
          <CardDescription>按顺序推进聊天，不要一次性展开所有问题。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            {config.workflow.map((item, index) => (
              <div key={item} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <Badge variant="secondary">{index + 1}</Badge>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <Separator />
          <div className="grid gap-2">
            <div className="text-sm font-medium">当前规则预览</div>
            <ScrollArea className="h-72 rounded-md border bg-muted p-4">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{prompt}</div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: ConversationStatus }) {
  const labels: Record<ConversationStatus, string> = {
    NEW: "新会话",
    ACTIVE: "活跃",
    WAITING_CANDIDATE: "等候选人",
    WAITING_HR: "等待HR",
    HUMAN: "人工",
    CLOSED: "结束",
  };
  return <Badge variant={status === "WAITING_HR" ? "destructive" : status === "HUMAN" || status === "CLOSED" ? "secondary" : "outline"}>{labels[status]}</Badge>;
}

function QueueBadge({ status }: { status: QueueStatus }) {
  const labels: Record<QueueStatus, string> = {
    QUEUED: "排队",
    RUNNING: "运行中",
    SUCCEEDED: "成功",
    FAILED: "失败",
    CANCELLED: "取消",
  };
  const icon =
    status === "RUNNING" ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> :
    status === "FAILED" ? <CircleAlertIcon data-icon="inline-start" /> :
    status === "SUCCEEDED" ? <CheckCircle2Icon data-icon="inline-start" /> :
    status === "QUEUED" ? <ClockIcon data-icon="inline-start" /> :
    <ActivityIcon data-icon="inline-start" />;
  return (
    <Badge variant={status === "FAILED" ? "destructive" : status === "RUNNING" ? "default" : "secondary"}>
      {icon}
      {labels[status]}
    </Badge>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("React root element #root was not found.");
}

type BossChatWindow = Window & typeof globalThis & {
  __bossChatRoot?: ReturnType<typeof createRoot>;
};

const bossChatWindow = window as BossChatWindow;
const root = bossChatWindow.__bossChatRoot ?? createRoot(rootElement);
bossChatWindow.__bossChatRoot = root;
root.render(<App />);
