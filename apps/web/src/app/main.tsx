import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ActivityIcon,
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
  ShieldAlertIcon,
  UserCheckIcon,
  UserRoundCogIcon,
} from "lucide-react";
import { toast } from "sonner";

import type {
  AISetting,
  AutomationLog,
  BossAccount,
  Conversation,
  ConversationStatus,
  DashboardSummary,
  JobSetting,
  Message,
  QueueItem,
  QueueStatus,
  ReplyTemplate,
  ReplyTemplateType,
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";

import "./styles.css";

type PageId =
  | "dashboard"
  | "account"
  | "jobs"
  | "rules"
  | "ai"
  | "conversations"
  | "hours"
  | "logs";

const navItems = [
  { id: "dashboard", label: "仪表盘", icon: GaugeIcon },
  { id: "account", label: "Boss账号", icon: UserRoundCogIcon },
  { id: "jobs", label: "岗位管理", icon: BriefcaseBusinessIcon },
  { id: "rules", label: "回复规则", icon: FileTextIcon },
  { id: "ai", label: "AI设置", icon: BotIcon },
  { id: "conversations", label: "会话中心", icon: MessageSquareTextIcon },
  { id: "hours", label: "工作时间", icon: CalendarClockIcon },
  { id: "logs", label: "日志", icon: LogsIcon },
] satisfies Array<{ id: PageId; label: string; icon: typeof KeyRoundIcon }>;

const pageTitles: Record<PageId, { title: string; description: string }> = {
  dashboard: { title: "仪表盘", description: "查看桌面挂机、队列和自动聊天运行状态。" },
  account: { title: "Boss账号", description: "V1 只维护一个 Boss 账号和一个本机浏览器会话。" },
  jobs: { title: "岗位管理", description: "按岗位控制自动回复、AI增强和企业微信导流。" },
  rules: { title: "回复规则", description: "维护确定性模板，支持少量变量替换。" },
  ai: { title: "AI设置", description: "配置模型、密钥和招聘专员系统提示词。" },
  conversations: { title: "会话中心", description: "查看候选人消息、AI状态和人工接管。" },
  hours: { title: "工作时间", description: "控制工作时间内自动回复和非工作时间处理。" },
  logs: { title: "日志", description: "排查队列、AI和 Boss CLI 调用过程。" },
};

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
                  <span className="truncate text-xs text-muted-foreground">真实队列控制台</span>
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
                <p className="text-xs text-muted-foreground">单账号串行队列，响应不追求即时。</p>
              </div>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-medium">{title.title}</h1>
                <p className="truncate text-sm text-muted-foreground">{title.description}</p>
              </div>
              <Badge variant="outline">V1 单账号</Badge>
            </header>
            <main className="flex flex-1 flex-col gap-4 p-4">
              {dashboard.error && <ErrorAlert message={dashboard.error} />}
              {activePage === "dashboard" && (
                <DashboardPage summary={dashboard.data} refresh={dashboard.refresh} />
              )}
              {activePage === "account" && (
                <AccountPage account={dashboard.data?.account ?? null} refresh={dashboard.refresh} />
              )}
              {activePage === "jobs" && <JobsPage />}
              {activePage === "rules" && <RulesPage />}
              {activePage === "ai" && <AIPage />}
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
  const listening = summary?.account.listeningStatus === "RUNNING";

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="运行状态" value={listening ? "监听中" : "已停止"} detail="worker 串行执行" />
        <MetricCard title="今日会话" value={String(summary?.metrics.todayConversations ?? 0)} detail="新增候选人消息" />
        <MetricCard title="AI回复" value={String(summary?.metrics.todayAiReplies ?? 0)} detail="真实 message 表统计" />
        <MetricCard title="企微发送" value={String(summary?.metrics.todayWecomSends ?? 0)} detail="单会话最多 2 次" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <CardTitle>自动化队列</CardTitle>
            <CardDescription>Boss 操作需要模拟真人节奏，同一账号只执行一个任务。</CardDescription>
          </CardHeader>
          <CardContent>
            <QueueTable queue={summary?.queue ?? []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>监听控制</CardTitle>
            <CardDescription>停止监听不会中断正在点击或发送的原子步骤。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Alert>
              <ShieldAlertIcon />
              <AlertTitle>真实执行约束</AlertTitle>
              <AlertDescription>启动后 API 只入队，worker 串行调用根目录 CLI。</AlertDescription>
            </Alert>
            <Progress value={listening ? 68 : 0} />
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              onClick={async () => {
                await api.startListening();
                toast.success("监听已启动并创建未读同步任务");
                await refresh();
              }}
            >
              <PlayIcon data-icon="inline-start" />
              启动监听
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await api.stopListening();
                toast("监听将在当前步骤结束后停止");
                await refresh();
              }}
            >
              <PauseIcon data-icon="inline-start" />
              停止监听
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}

function AccountPage({
  account,
  refresh,
}: {
  account: BossAccount | null;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Boss账号</CardTitle>
          <CardDescription>V1 不做账号列表，只维护默认账号。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>{account?.nickname?.[0] ?? "B"}</AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium">{account?.nickname ?? "未读取昵称"}</div>
              <div className="text-sm text-muted-foreground">岗位数：{account?.jobCount ?? 0}</div>
            </div>
            <Badge className="ml-auto" variant={account?.loginStatus === "LOGGED_IN" ? "default" : "secondary"}>
              {account?.loginStatus ?? "UNKNOWN"}
            </Badge>
          </div>
          <Separator />
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldTitle>监听状态</FieldTitle>
              <Badge variant={account?.listeningStatus === "RUNNING" ? "default" : "secondary"}>
                {account?.listeningStatus === "RUNNING" ? "运行中" : "已停止"}
              </Badge>
            </Field>
            <Field orientation="horizontal">
              <FieldTitle>最近检查</FieldTitle>
              <span className="text-sm text-muted-foreground">{account?.lastCheckedAt ?? "暂无"}</span>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="gap-2">
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
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>执行原则</CardTitle>
          <CardDescription>调用根目录 CLI 能力必须经过 worker 队列。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>调用链路</TableCell>
                <TableCell>web → api → queue → worker → CLI → Boss</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>并发策略</TableCell>
                <TableCell>同一 Boss 会话串行执行</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>响应目标</TableCell>
                <TableCell>展示排队和步骤，不追求快速完成</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
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
          <CardDescription>worker 同步岗位后会出现在这里。</CardDescription>
        </CardHeader>
        <CardContent>
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
        <CardDescription>先启动 worker 同步岗位，再配置自动回复。</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>启用岗位</FieldTitle>
              <FieldDescription>关闭后该岗位不触发自动回复。</FieldDescription>
            </FieldContent>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!job} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>自动回复</FieldTitle>
              <FieldDescription>启用后 worker 会为该岗位创建回复队列。</FieldDescription>
            </FieldContent>
            <Switch checked={autoReply} onCheckedChange={setAutoReply} disabled={!job} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>AI增强回复</FieldTitle>
              <FieldDescription>AI 错误会暴露在队列中，不隐藏兜底。</FieldDescription>
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
  const templates = useResource(api.templates, [], 5000);
  if (templates.error) return <ErrorAlert message={templates.error} />;
  const byType = Object.fromEntries((templates.data ?? []).map((item) => [item.type, item]));

  return (
    <Tabs defaultValue="WELCOME" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="WELCOME">欢迎语</TabsTrigger>
        <TabsTrigger value="JOB_INTRO">岗位介绍</TabsTrigger>
        <TabsTrigger value="LOCATION">工作地点</TabsTrigger>
        <TabsTrigger value="SALARY">薪资回复</TabsTrigger>
        <TabsTrigger value="WECOM">企微引导</TabsTrigger>
        <TabsTrigger value="OFF_HOURS">非工作时间</TabsTrigger>
      </TabsList>
      {(["WELCOME", "JOB_INTRO", "LOCATION", "SALARY", "WECOM", "OFF_HOURS"] as ReplyTemplateType[]).map((type) => (
        <TabsContent key={type} value={type}>
          <TemplateCard template={byType[type] ?? null} refresh={templates.refresh} />
        </TabsContent>
      ))}
    </Tabs>
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
          <CardDescription>API Key 已保存时不会回显明文。</CardDescription>
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
          <CardDescription>限制 AI 不承诺录用、不讨论敏感内容。</CardDescription>
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
          <CardTitle>会话列表</CardTitle>
          <CardDescription>由 worker 同步 Boss 未读列表。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[32rem]">
            <div className="flex flex-col gap-1 p-2">
              {(conversations.data ?? []).map((conversation) => (
                <Button
                  key={conversation.id}
                  variant={conversation.id === selectedId ? "secondary" : "ghost"}
                  className="h-auto justify-start"
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <div className="flex w-full items-center gap-2">
                      <span className="truncate font-medium">{conversation.candidateName}</span>
                      <StatusBadge status={conversation.status} />
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {conversation.latestMessage ?? "暂无消息"}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{selectedConversation?.candidateName ?? "暂无会话"}</CardTitle>
          <CardDescription>{selectedConversation?.jobName ?? "等待 worker 同步"}</CardDescription>
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
          <CardDescription>人工接管只影响当前会话。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldTitle>状态</FieldTitle>
              {selectedConversation && <StatusBadge status={selectedConversation.status} />}
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
            disabled={!selectedConversation}
            onClick={async () => {
              if (!selectedConversation) return;
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
          <CardDescription>V1 不做节假日规则。</CardDescription>
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
          <CardDescription>超出时间后确定性处理，不添加隐藏分支。</CardDescription>
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
        <CardDescription>每个队列状态和 CLI 调用都需要清晰上下文。</CardDescription>
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

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
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
            <TableCell>{item.errorMessage ?? ""}</TableCell>
            <TableCell>{item.createdAt}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TemplateCard({ template, refresh }: { template: ReplyTemplate | null; refresh: () => Promise<void> }) {
  const [content, setContent] = useState("");
  useEffect(() => setContent(template?.content ?? ""), [template]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader>
          <CardTitle>{template?.type ?? "模板"}</CardTitle>
          <CardDescription>支持变量：{"{wecom}"}、{"{job_name}"}、{"{hr_name}"}、{"{candidate_name}"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor={`template-${template?.type ?? "unknown"}`}>模板内容</FieldLabel>
            <Textarea id={`template-${template?.type ?? "unknown"}`} className="min-h-64" value={content} onChange={(event) => setContent(event.target.value)} />
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            disabled={!template}
            onClick={async () => {
              if (!template) return;
              await api.updateTemplate(template.type, content);
              toast.success(`${template.type} 已保存`);
              await refresh();
            }}
          >
            保存模板
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>预览</CardTitle>
          <CardDescription>保存前校验变量，不在发送时兜底。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="whitespace-pre-wrap rounded-md border bg-muted p-4 text-sm">{content}</div>
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

createRoot(rootElement).render(<App />);
