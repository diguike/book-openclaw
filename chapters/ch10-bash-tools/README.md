---
title: 第 10 章 — Bash 工具：进程管理、PTY 与沙箱执行
feishu_url: "https://www.feishu.cn/wiki/WvwWwf4T4ieh8Lkm1Mtckdkwncf"
last_synced: "2026-05-03"
---

# 第 10 章 — Bash 工具：进程管理、PTY 与沙箱执行

读完这章，你会理解 OpenClaw 如何安全地执行 Shell 命令：进程注册表怎么追踪每一个 exec 会话，PTY 模式和普通子进程模式的取舍，审批机制如何拦截危险操作，沙箱容器怎么隔离执行环境，以及后台进程的生命周期管理。这些是 Agent 系统中最复杂也最关键的基础设施。

## 10.1 Bash 工具为什么是 Agent 的命脉

一个 Agent 系统的能力上限，取决于它能调用的工具。在所有工具中，Shell 命令执行是最底层、也是最有威力的一个——文件读写、代码编译、包管理、数据库操作、系统管理，几乎所有任务最终都会落到 Shell 命令上。

OpenClaw 把 Bash 功能拆成两个工具：**exec** 和 **process**。exec 负责启动命令，process 负责管理已经启动的命令。这个拆分不是随意的——它把"执行"和"管理"解耦，让 LLM 在需要查看后台任务状态时不需要重新理解 exec 的全部参数。

从源码结构来看，Bash 工具涉及十多个文件，是 `src/agents/` 下最大的子系统之一：

| 文件 | 职责 |
|------|------|
| `bash-tools.ts` | 入口，re-export exec/process |
| `bash-tools.exec.ts` | exec 工具主逻辑（~1880 行） |
| `bash-tools.exec-runtime.ts` | 进程启动、输出收集、退出处理 |
| `bash-tools.exec-host-node.ts` | 远程 Node 主机执行 |
| `bash-tools.process.ts` | process 工具（list/poll/log/write/kill） |
| `bash-process-registry.ts` | 进程注册表 |
| `bash-tools.schemas.ts` | TypeBox 参数 Schema |
| `bash-tools.shared.ts` | Docker 参数构建、沙箱工作目录 |
| `pty-keys.ts` | PTY 按键编码 |
| `sandbox.ts` | 沙箱配置 re-export |
| `exec-approval-result.ts` | 审批结果解析 |

## 10.2 exec 工具的参数设计

exec 的参数 Schema 定义在 `bash-tools.schemas.ts:3`：

```typescript
export const execSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  workdir: Type.Optional(Type.String()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  yieldMs: Type.Optional(Type.Number()),
  background: Type.Optional(Type.Boolean()),
  timeout: Type.Optional(Type.Number()),
  pty: Type.Optional(Type.Boolean()),
  elevated: Type.Optional(Type.Boolean()),
  host: Type.Optional(Type.String()),  // auto|sandbox|gateway|node
  security: Type.Optional(Type.String()),  // deny|allowlist|full
  ask: Type.Optional(Type.String()),  // off|on-miss|always
  node: Type.Optional(Type.String()),
});
```

关键参数说明：

- **`yieldMs` 和 `background`**：控制前台/后台执行行为。`background=true` 立即后台化，`yieldMs` 指定等待多少毫秒后自动后台化。默认 10 秒。
- **`host`**：exec 的执行目标有四种——`auto`（自动选择）、`gateway`（本地主机）、`sandbox`（Docker 容器）、`node`（远程 Node 主机）。
- **`security` 和 `ask`**：安全策略和审批模式，后面详细展开。
- **`pty`**：是否用伪终端。需要交互式 TUI 程序（如 vim、htop、coding agent）时设为 true。

## 10.3 进程注册表（Process Registry）

进程注册表是整个 Bash 工具的数据中心，定义在 `bash-process-registry.ts`。它维护两个 Map：

```typescript
// bash-process-registry.ts:80-81
const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedSession>();
```

每次 exec 启动命令，都会创建一个 `ProcessSession` 并注册到 `runningSessions`。这个 Session 记录了进程的完整状态：

```typescript
// bash-process-registry.ts:30-61
export interface ProcessSession {
  id: string;
  command: string;
  pid?: number;
  startedAt: number;
  cwd?: string;
  maxOutputChars: number;
  totalOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  aggregated: string;      // 全量输出（有上限截断）
  tail: string;            // 最后 2000 字符
  exited: boolean;
  exitCode?: number | null;
  backgrounded: boolean;
  cursorKeyMode: "unknown" | "normal" | "application";
  // ...更多字段
}
```

关键设计点：

**双缓冲输出**。`pendingStdout` / `pendingStderr` 是增量缓冲区，poll 操作会 drain 它们。`aggregated` 是全量输出的滑动窗口，上限默认 200,000 字符（`DEFAULT_MAX_OUTPUT`）。超过上限时从头部截断，保留最新的输出。这个设计让 LLM 既能通过 poll 获取增量数据，也能通过 log 查看完整历史。

```typescript
// bash-process-registry.ts:111-139
export function appendOutput(session: ProcessSession, stream: "stdout" | "stderr", chunk: string) {
  // ...缓冲到 pending
  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;
  session.aggregated = aggregated;
  session.tail = tail(session.aggregated, 2000);
}
```

**生命周期管理**。进程退出后，`moveToFinished` 把 Session 从 `runningSessions` 移到 `finishedSessions`，同时清理子进程的 stdio 流和事件监听器，防止文件描述符泄漏。只有被标记为 `backgrounded` 的 Session 才会保留到 `finishedSessions`——前台完成的命令不需要保留，结果已经直接返回给 LLM 了。

```typescript
// bash-process-registry.ts:170-223
function moveToFinished(session: ProcessSession, status: ProcessStatus) {
  runningSessions.delete(session.id);
  if (session.child) {
    session.child.stdin?.destroy?.();
    session.child.stdout?.destroy?.();
    session.child.stderr?.destroy?.();
    session.child.removeAllListeners();
    delete session.child;
  }
  // ...stdin 清理
  if (!session.backgrounded) {
    return;  // 前台完成，不保留
  }
  finishedSessions.set(session.id, { /* 快照 */ });
}
```

**定期清扫**。一个 sweeper 定时器每隔 `jobTtlMs / 6` 清理过期的 finished sessions，默认 TTL 是 30 分钟，范围 1 分钟到 3 小时。定时器用 `unref()` 避免阻止 Node.js 进程退出。

## 10.4 exec 的执行流程

`createExecTool` 是工厂函数，返回一个符合 `AgentToolWithMeta` 接口的工具对象。exec 的 `execute` 方法是一条长链路，大致分为以下阶段：

### 阶段一：参数解析与策略决策

```
command → 解析 host/security/ask
        → 决定执行目标（gateway/sandbox/node）
        → 解析工作目录
        → 安全校验
```

执行目标的解析逻辑在 `resolveExecTarget`（`bash-tools.exec-runtime.ts:235`）中。核心规则是：

- 如果配置了沙箱且 target 为 `auto`，走沙箱
- elevated 模式强制走 gateway 或 node（绕过沙箱）
- 用户请求的 target 必须在配置允许范围内

```typescript
// bash-tools.exec-runtime.ts:275
const effectiveHost =
  resolvedTarget === "auto" ? (params.sandboxAvailable ? "sandbox" : "gateway") : resolvedTarget;
```

### 阶段二：安全拦截

在命令到达进程启动之前，经过三道安全检查。

**第一道：危险命令拦截**。`rejectUnsafeControlShellCommand`（`bash-tools.exec.ts:1139`）会解析命令的 argv，层层剥开 `env`、`sudo`、`exec`、`command`、`builtin` 等前缀包装，检查最终要执行的命令是否在黑名单中。比如 `/approve` 命令和 `openclaw channels login` 被禁止通过 exec 执行——前者必须走审批处理器，后者需要交互式终端。

**第二道：环境变量安全**。`sanitizeHostExecEnvWithDiagnostics` 会过滤掉危险的环境变量（如 `LD_PRELOAD`），并严格禁止自定义 `PATH`，防止二进制劫持。

**第三道：脚本注入检测**。`validateScriptFileForShellBleed`（`bash-tools.exec.ts:942`）专门解决一个 LLM 常见的错误模式：生成 Python 或 Node.js 脚本时，把 Shell 变量语法（`$HOME`、`$PATH`）写进脚本。这个函数会在执行前读取目标脚本文件，检测是否有 `$UPPER_CASE_VAR` 的模式，如果发现就拒绝执行并给出修复建议。

```typescript
// bash-tools.exec.ts:1011-1029
const envVarRegex = /\$[A-Z_][A-Z0-9_]{1,}/g;
const first = envVarRegex.exec(content);
if (first) {
  throw new Error(
    `exec preflight: detected likely shell variable injection (${token}) ` +
    `in ${target.kind} script: ${path.basename(absPath)}:${line}.\n` +
    `In Python, use os.environ.get(...) instead of raw ${token}.`
  );
}
```

### 阶段三：进程启动

`runExecProcess`（`bash-tools.exec-runtime.ts:543`）是进程启动的核心函数。它做三件事：

1. 创建 `ProcessSession` 并注册到进程注册表
2. 构造 spawn 参数（区分 child/pty/sandbox 模式）
3. 通过 `ProcessSupervisor` 启动进程

沙箱模式下，命令被包装成 `docker exec` 调用。`buildDockerExecArgs`（`bash-tools.shared.ts:62`）负责拼装 Docker 参数，用 `/bin/sh -lc` 执行用户命令，PATH 通过环境变量注入而不是直接嵌入命令行，避免路径跨平台问题。

### 阶段四：后台化与结果返回

进程启动后，exec 返回一个 Promise。这里有一个精妙的 yield 机制：

```typescript
// bash-tools.exec.ts:1837-1850
if (allowBackground && yieldWindow !== null) {
  if (yieldWindow === 0) {
    onYieldNow();  // 立即后台化
  } else {
    yieldTimer = setTimeout(() => {
      yielded = true;
      markBackgrounded(run.session);
      resolveRunning();
    }, yieldWindow);
  }
}
```

如果命令在 `yieldMs`（默认 10 秒）内完成，直接返回结果。如果超时还没完成，进程被标记为 `backgrounded`，返回一个"命令还在运行"的提示，让 LLM 用 process 工具跟进。

这个设计解决了一个实际问题：LLM 不知道一条命令会跑多久。`npm install` 可能 3 秒完成，也可能 30 秒。如果每个命令都 block 等待，响应时间不可控。如果每个命令都后台化，简单命令也需要额外的 poll 调用，浪费 token。yield 窗口在两者之间取了平衡。

## 10.5 process 工具的操作

process 工具（`bash-tools.process.ts:97`）对已启动的进程提供以下操作：

| 操作 | 用途 |
|------|------|
| `list` | 列出所有后台 Session（running + finished） |
| `poll` | 获取增量输出，可选 timeout 等待 |
| `log` | 分页查看全量输出 |
| `write` | 向 stdin 写入数据 |
| `send-keys` | 发送按键序列（用于 PTY 会话） |
| `submit` | 发送回车（CR） |
| `paste` | 粘贴文本（支持 bracketed paste 模式） |
| `kill` | 终止进程 |
| `clear` | 清除已完成的 Session 记录 |
| `remove` | 终止并清除（kill + clear） |

`poll` 的实现有一个可选的等待机制：如果传入 `timeout`，在进程未退出时会以 250ms 间隔轮询直到超时。这避免了 LLM 在命令快要完成时做无意义的重试。

```typescript
// bash-tools.process.ts:307-314
if (pollWaitMs > 0 && !scopedSession.exited) {
  const deadline = Date.now() + pollWaitMs;
  while (!scopedSession.exited && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Math.min(250, deadline - Date.now()))),
    );
  }
}
```

`kill` 操作优先使用 `ProcessSupervisor` 的 `cancel` 方法，如果 supervisor 中找不到记录，回退到 `killProcessTree` 杀掉整个进程树。

## 10.6 PTY 模式 vs 非 PTY 模式

PTY（伪终端）模式解决的是交互式程序的支持问题。`vim`、`htop`、`less`、coding agent 这类程序需要 TTY 才能正常运行。

exec 的参数中有一个 `pty: boolean`，但实际使用时有限制：沙箱模式下 PTY 被禁用（`usePty = params.pty === true && !sandbox`），因为 Docker exec 已经通过 `-t` 标志提供了 TTY。

进程启动时根据模式构造不同的 spawn 规格：

```typescript
// bash-tools.exec-runtime.ts:715-732
if (opts.usePty) {
  return {
    mode: "pty",
    ptyCommand: execCommand,
    childFallbackArgv: childArgv,
    env: shellRuntimeEnv,
    stdinMode: "pipe-open",
  };
}
return {
  mode: "child",
  argv: childArgv,
  env: shellRuntimeEnv,
  stdinMode: "pipe-closed",  // 非 PTY 默认关闭 stdin
};
```

注意 `stdinMode` 的区别：PTY 模式 stdin 保持打开（交互式程序需要持续输入），而普通子进程默认关闭 stdin。

### PTY 的降级处理

PTY spawn 可能失败（比如系统不支持 PTY 或 node-pty 未安装）。OpenClaw 的处理方式是降级到普通子进程模式，而不是直接报错：

```typescript
// bash-tools.exec-runtime.ts:779-801
} catch (err) {
  if (spawnSpec.mode === "pty") {
    opts.warnings.push(`Warning: PTY spawn failed; retrying without PTY.`);
    usingPty = false;
    managedRun = await supervisor.spawn({
      mode: "child",
      argv: spawnSpec.childFallbackArgv,
      stdinMode: "pipe-open",  // 降级后打开 stdin，因为用户期望交互
      // ...
    });
  }
}
```

### 光标键模式追踪

PTY 会话中，终端可以在两种光标键模式之间切换：正常模式（CSI 序列）和应用模式（SS3 序列）。`vim` 等编辑器在启动时会切换到应用模式（发送 SMKX 转义序列 `\x1b[?1h`），退出时切回正常模式（`\x1b[?1l`）。

`detectCursorKeyMode`（`bash-tools.exec-runtime.ts:62`）从 PTY 输出中检测这些切换序列，`ProcessSession.cursorKeyMode` 记录当前模式。`send-keys` 操作在编码箭头键时会根据当前模式选择正确的转义序列。

### 按键编码

`pty-keys.ts` 实现了一套完整的终端按键编码系统。它把高层的按键名称（如 `C-c`、`M-x`、`Up`、`F5`）转换成终端转义序列：

```typescript
// pty-keys.ts:28-83
const namedKeyMap = new Map<string, string>([
  ["enter", CR],
  ["tab", TAB],
  ["escape", ESC],
  ["up", `${ESC}[A`],
  ["down", `${ESC}[B`],
  ["f1", `${ESC}OP`],
  // ...40+ 个按键映射
]);
```

修饰键用 `C-`（Ctrl）、`M-`（Alt）、`S-`（Shift）前缀表示，支持组合。比如 `C-M-x` 表示 Ctrl+Alt+X。对于支持 xterm modifier 的按键（箭头、Home、End 等），会生成带修饰符参数的 CSI 序列。

`encodePaste` 支持 bracketed paste 模式——在粘贴文本前后包裹 `\x1b[200~` 和 `\x1b[201~`，告诉终端"这是粘贴内容，不是用户逐字输入的"。这对交互式编辑器很重要，否则自动补全等功能会干扰粘贴操作。

## 10.7 执行审批机制（Exec Approval）

审批是 exec 工具的安全核心。配合 `security` 和 `ask` 两个参数，OpenClaw 实现了三级安全模型：

| security | ask | 行为 |
|----------|-----|------|
| `full` | `off` | 无限制执行，不需要审批 |
| `allowlist` | `off` | 只有白名单内的命令可以执行 |
| `allowlist` | `on-miss` | 白名单外的命令需要人工审批 |
| `deny` | - | 拒绝所有执行 |
| 任意 | `always` | 所有命令都需要人工审批 |

审批流程在 Gateway 模式下通过 `processGatewayAllowlist`（`bash-tools.exec-host-gateway.ts`）处理，Node 模式下通过 `executeNodeHostCommand`（`bash-tools.exec-host-node.ts`）处理。

当命令需要审批时，exec 返回一个 pending 消息，包含审批 ID 和命令内容：

```typescript
// bash-tools.exec-runtime.ts:356-400
export function buildApprovalPendingMessage(params: { ... }) {
  lines.push(`Approval required (id ${params.approvalSlug}, full ${params.approvalId}).`);
  lines.push(`Host: ${params.host}`);
  lines.push(`CWD: ${params.cwd ?? "(node default)"}`);
  lines.push("Command:");
  lines.push(commandBlock);
  lines.push(`Reply with: /approve ${params.approvalSlug} allow-once|allow-always|deny`);
}
```

用户通过 `/approve <id> <decision>` 命令回复审批。决策有三种：`allow-once`（本次允许）、`allow-always`（永久允许同类命令）、`deny`（拒绝）。

审批结果的解析在 `exec-approval-result.ts` 中。它用正则匹配 `exec denied (...)` 和 `exec finished (...)` 格式的结果文本，提取元数据（如超时、用户拒绝、白名单未命中等原因）并生成面向用户的消息。

### elevated 模式

`elevated` 参数允许绕过常规安全限制。它受两个配置门控：`tools.elevated.enabled` 和 `tools.elevated.allowFrom.<provider>`。启用 elevated 且 level 为 `full` 时，`security` 强制设为 `full`，`ask` 设为 `off`——即完全绕过审批。

```typescript
// bash-tools.exec.ts:1555-1565
if (elevatedRequested && elevatedMode === "full") {
  security = "full";
}
const bypassApprovals = elevatedRequested && elevatedMode === "full";
if (bypassApprovals) {
  ask = "off";
}
```

这是一个有意的设计取舍：在某些场景下（如自动化流水线），速度比交互式审批更重要。但 elevated 模式默认关闭，需要在配置中显式启用。

## 10.8 沙箱执行（Docker 容器隔离）

沙箱是 exec 的第一道物理隔离屏障。当 `host=sandbox` 或 `host=auto` 且沙箱可用时，命令在 Docker 容器内执行。

沙箱配置由 `BashSandboxConfig` 定义（`bash-tools.shared.ts:11`）：

```typescript
export type BashSandboxConfig = {
  containerName: string;
  workspaceDir: string;       // 宿主机上的工作空间目录
  containerWorkdir: string;   // 容器内的工作目录
  env?: Record<string, string>;
  buildExecSpec?: (...) => Promise<SandboxBackendExecSpec>;  // 可扩展的后端
  finalizeExec?: (...) => Promise<void>;
};
```

命令执行时，`buildDockerExecArgs` 把用户命令包装成 Docker exec 调用：

```typescript
// bash-tools.shared.ts:62-100
export function buildDockerExecArgs(params: { ... }) {
  const args = ["exec", "-i"];
  if (params.tty) args.push("-t");
  if (params.workdir) args.push("-w", params.workdir);
  for (const [key, value] of Object.entries(params.env)) {
    if (key === "PATH") continue;  // PATH 特殊处理
    args.push("-e", `${key}=${value}`);
  }
  // PATH 通过 OPENCLAW_PREPEND_PATH 注入，避免覆盖容器内的系统 PATH
  args.push(params.containerName, "/bin/sh", "-lc", `${pathExport}${params.command}`);
  return args;
}
```

PATH 处理的关键在于：Docker 容器内的 `/bin/sh -l` 会 source `/etc/profile`，重置 PATH。如果直接通过 `-e PATH=...` 设置 PATH，会被 profile 覆盖。所以 OpenClaw 把自定义路径放到 `OPENCLAW_PREPEND_PATH` 变量，在 profile 之后追加到 PATH 前面。

沙箱模块本身（`sandbox.ts`）是一组 re-export，实际实现分散在 `sandbox/` 子目录。它支持多种后端：Docker（默认）、SSH 远程容器、以及通过 `SandboxBackendFactory` 注册的自定义后端。沙箱还有一些附加功能：

- **工具策略**（`resolveSandboxToolPolicyForAgent`）：控制沙箱内哪些工具可用
- **文件系统桥接**（`SandboxFsBridge`）：让宿主机上的文件操作工具能透过沙箱边界读写容器内文件
- **生命周期管理**（`listSandboxContainers`、`removeSandboxContainer`）：容器的创建、列举和清理

## 10.9 后台进程管理和超时控制

### 超时机制

exec 支持两种超时：

- **整体超时**（overall-timeout）：命令执行总时长，通过 `timeout` 参数设置，默认 1800 秒
- **无输出超时**（no-output-timeout）：命令长时间没有任何 stdout/stderr 输出

超时由 `ProcessSupervisor` 在底层实现。超时触发后，进程被 kill，并返回带有超时提示的错误信息。消息会建议 LLM 使用更长的 timeout 或改用后台模式：

```
Command timed out after 300 seconds. If this command is expected to take longer,
re-run with a higher timeout (e.g., exec timeout=300). If it should keep running,
start it with exec background=true or yieldMs so OpenClaw can register a pollable
process session.
```

### 退出通知

后台进程退出后，如果 Session 配置了 `notifyOnExit`，系统会通过 `enqueueSystemEvent` 发送一条通知，包含 Session ID、退出码和最后一段输出。同时通过 `requestHeartbeatNow` 唤醒心跳循环，让 Agent 尽快感知到进程退出。

```typescript
// bash-tools.exec-runtime.ts:318-350
function maybeNotifyOnExit(session: ProcessSession, status: "completed" | "failed") {
  if (!session.backgrounded || !session.notifyOnExit || session.exitNotified) return;
  session.exitNotified = true;
  const summary = output
    ? `Exec ${status} (${session.id.slice(0, 8)}, ${exitLabel}) :: ${output}`
    : `Exec ${status} (${session.id.slice(0, 8)}, ${exitLabel})`;
  enqueueSystemEvent(summary, { sessionKey, deliveryContext: session.notifyDeliveryContext });
  requestHeartbeatNow(scopedHeartbeatWakeOptions(sessionKey, { reason: "exec-event" }));
}
```

### abort 信号处理

Agent 运行被取消时，exec 需要区分两种情况。前台进程——直接 kill。后台进程——保持运行，因为用户可能后续还会通过 process 工具查看。

```typescript
// bash-tools.exec.ts:1783-1796
const onAbortSignal = () => {
  run.disableUpdates();  // 先禁用更新回调
  if (yielded || run.session.backgrounded) {
    return;  // 后台进程不受 abort 影响
  }
  run.kill();  // 前台进程直接终止
};
```

`disableUpdates` 在 abort 时立即调用，确保已结束的 Agent run 不会收到迟到的进程输出事件（这个 bug 编号 #62520 在代码注释中有记录）。

## 10.10 安全约束总结

把前面分散提到的安全机制汇总成一张图：

```
┌─────────────────────────────────────────────────────────┐
│                    exec("rm -rf /")                     │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  1. rejectUnsafeControlShellCommand                     │
│     拦截 /approve、openclaw channels login 等控制命令    │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  2. sanitizeHostExecEnvWithDiagnostics                  │
│     过滤 LD_PRELOAD 等危险环境变量，禁止自定义 PATH      │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  3. validateScriptFileForShellBleed                     │
│     检测 Python/JS 脚本中的 Shell 变量注入               │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  4. Gateway Allowlist / Approval                        │
│     白名单匹配 + safeBins 策略 + 人工审批                │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│  5. 执行隔离                                             │
│     sandbox=Docker 容器 / gateway=宿主机 / node=远程     │
└─────────────────────────────────────────────────────────┘
```

几条原则贯穿这个安全模型：

- **Fail closed**：当解析器无法确定命令是否安全时（比如复杂的管道+解释器组合），拒绝执行而不是放行
- **最小权限**：`security` 使用 `minSecurity` 取配置值和请求值中更严格的那个；`ask` 使用 `maxAsk` 取更需要审批的那个
- **纵深防御**：环境变量、命令内容、脚本文件内容、白名单、审批、容器隔离——多层检查叠加

## 10.11 Node 远程执行

当 `host=node` 时，命令不在 Gateway 本机执行，而是发送到注册的远程 Node 主机。`executeNodeHostCommand`（`bash-tools.exec-host-node.ts:32`）通过 Gateway 的 `node.invoke` 工具调用远程执行：

```typescript
const raw = await callGatewayTool(
  "node.invoke",
  { timeoutMs: target.invokeTimeoutMs },
  buildNodeSystemRunInvoke({ target, command: prepared.argv, ... }),
);
```

Node 模式下的审批流程和 Gateway 模式类似，但有一个区别：审批通过后，命令的实际执行异步完成，结果通过系统事件通知回来。如果审批不可用（比如 cron 触发的无人值守场景），会根据 `askFallback` 策略决定是直接执行还是拒绝。

Node 模式的一个特殊处理是工作目录：Gateway 的 `cwd` 对远程 Node 没有意义（尤其是跨平台场景，Linux Gateway + Windows Node），所以只转发用户显式指定的 `workdir`，不转发默认值。

## 10.12 小结

Bash 工具的设计可以提炼出几个可迁移的架构模式。

**exec/process 分离**。把"启动"和"管理"拆成两个工具，降低单个工具的认知负担，也让 LLM 能更精准地使用每个工具。这个模式适用于任何有状态的后台任务管理。

**yield 窗口**。用一个可配置的等待时间来自适应前台/后台模式切换，避免让调用方（LLM）做这个判断。

**分层安全**。不依赖单一检查点，而是把安全约束分散到管道的每个阶段。每层只关注自己的检查维度，组合起来形成纵深防御。

**注册表模式**。用一个集中的 Session 注册表追踪所有活跃和已完成的进程，为 process 工具提供查询、操作的统一入口。双缓冲（pending + aggregated）解决了增量读取和全量回看两种需求。

**优雅降级**。PTY 失败时自动回退到子进程模式，沙箱工作目录无效时回退到默认目录。在可能出错的地方给出降级路径，而不是直接报错终止。

## 练习

**思考题**

1. Bash 工具的进程注册表使用双缓冲（pending + aggregated）来支持增量读取和全量回看。如果 Agent 启动了一个后台进程（比如 `npm run dev`）并且长时间不查看输出，pending buffer 会持续增长。OpenClaw 对此有什么保护措施？如果没有，你会怎么设计一个上限策略？

2. PTY 模式和非 PTY 模式各有什么优劣？为什么 OpenClaw 默认使用 PTY 模式，而在 PTY 不可用时才降级？有哪些命令在非 PTY 模式下行为会不同（比如颜色输出、交互式提示）？

**动手题**

3. 在 OpenClaw 中执行一条需要较长时间的命令（比如 `sleep 10 && echo done`），在命令执行过程中通过 `process` 工具查看进程状态。然后尝试用 `process` 工具的 kill 操作终止该进程，观察进程注册表中的状态变化。
