---
title: 第 27 章 — 实战：从零开发一个 OpenClaw Skill
feishu_url: "https://www.feishu.cn/wiki/Nvogw8rIAiJ0ZLkaZ5RcTzhmnxf"
last_synced: "2026-05-03"
---

# 第 27 章 — 实战：从零开发一个 OpenClaw Skill

读完这章你能学到：OpenClaw Skill 的完整开发流程——从需求分析到 SKILL.md 编写、元数据配置、本地测试，到最终发布至 ClawHub。本章以一个 GitHub Issue Tracker Skill 为例，给出完整可运行的代码。

## 27.1 选定场景：GitHub Issue Tracker

我们要构建一个名为 `issue-tracker` 的 Skill，功能如下：

- 查询指定仓库的 Issue 列表（支持按标签、状态筛选）
- 查看单个 Issue 的详情（包括评论）
- 创建新 Issue
- 给 Issue 添加评论

这个场景足够实用，同时覆盖了 Skill 开发中的核心要素：外部工具依赖（`curl`）、环境变量配置（`GH_TOKEN`）、多步骤工作流、错误处理。

OpenClaw 内置的 `gh-issues` Skill 功能更重，包含了自动修复和 PR 创建。我们的 `issue-tracker` 定位为一个轻量版本，专注于 Issue 的查看和管理，适合日常使用。

## 27.2 Skill 文件结构

一个 Skill 的最小结构只需要一个文件：

```
issue-tracker/
  SKILL.md          # 必需：Skill 定义文件
```

实际项目中通常还会包含辅助文件：

```
issue-tracker/
  SKILL.md          # Skill 定义
  .clawhub/         # ClawHub 安装元数据（自动生成）
    origin.json     # 安装来源信息
  examples/         # 使用示例（可选）
  README.md         # 说明文档（可选，不参与加载）
```

OpenClaw 在加载时只关心 `SKILL.md`——其他文件对运行时没有影响。这是 `skills-clawhub.ts` 中 `ensureSkillRoot` 函数的验证逻辑：

```typescript
// src/agents/skills-clawhub.ts:136-142
async function ensureSkillRoot(rootDir: string): Promise<void> {
  for (const candidate of ["SKILL.md", "skill.md", "skills.md", "SKILL.MD"]) {
    if (await fileExists(path.join(rootDir, candidate))) {
      return;
    }
  }
  throw new Error("downloaded archive is missing SKILL.md");
}
```

文件名不区分大小写（支持四种变体），但推荐使用全大写的 `SKILL.md`，这是社区约定。

## 27.3 YAML Frontmatter 配置

`SKILL.md` 的头部是 YAML frontmatter，定义了 Skill 的元数据。先看一个内置 Skill `blogwatcher` 的配置：

```yaml
---
name: blogwatcher
description: Monitor blogs and RSS/Atom feeds for updates using the blogwatcher CLI.
homepage: https://github.com/Hyaxia/blogwatcher
metadata:
  {
    "openclaw":
      {
        "emoji": "📰",
        "requires": { "bins": ["blogwatcher"] },
        "install":
          [
            {
              "id": "go",
              "kind": "go",
              "module": "github.com/Hyaxia/blogwatcher/cmd/blogwatcher@latest",
              "bins": ["blogwatcher"],
              "label": "Install blogwatcher (go)",
            },
          ],
      },
  }
---
```

逐字段解释：

### 基础字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Skill 唯一标识符，用于引用和调用 |
| `description` | string | 一句话描述，出现在 Skill 列表和搜索结果中 |
| `homepage` | string | 项目主页 URL（可选） |
| `user-invocable` | boolean | 用户是否可以通过命令主动触发（默认 true） |

### OpenClaw 元数据（`metadata.openclaw`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `emoji` | string | Skill 的显示图标 |
| `requires.bins` | string[] | 必需的二进制文件，全部存在才加载 |
| `requires.anyBins` | string[] | 任一存在即可 |
| `requires.config` | string[] | 必需的配置路径 |
| `primaryEnv` | string | 主要环境变量名 |
| `install` | InstallSpec[] | 依赖的安装指令 |

### 安装规格（InstallSpec）

`install` 数组中的每个元素定义了一种安装方式：

```typescript
type SkillInstallSpec = {
  id?: string;       // 安装方式的唯一标识
  kind: "brew" | "node" | "go" | "uv" | "download";  // 安装方式
  label?: string;    // 用户可见的安装描述
  bins?: string[];   // 安装后应该存在的二进制文件
  formula?: string;  // brew formula 名称
  package?: string;  // npm/uv 包名
  module?: string;   // Go module 路径
  os?: string[];     // 适用的操作系统
  url?: string;      // 下载 URL（download 类型）
};
```

多种 `kind` 可以并存——OpenClaw 会根据用户环境选择合适的安装方式。比如 `coding-agent` Skill 同时提供了 npm 安装 Claude Code 和 Codex 两个选项：

```yaml
"install": [
  {
    "id": "node-claude",
    "kind": "node",
    "package": "@anthropic-ai/claude-code",
    "bins": ["claude"],
    "label": "Install Claude Code CLI (npm)",
  },
  {
    "id": "node-codex",
    "kind": "node",
    "package": "@openai/codex",
    "bins": ["codex"],
    "label": "Install Codex CLI (npm)",
  },
]
```

## 27.4 编写 SKILL.md

以下是完整的 `issue-tracker` Skill 定义。这个文件已经放在 `examples/issue-tracker/SKILL.md` 中，你可以直接复制使用。

```markdown
---
name: issue-tracker
description: "Query, create, and manage GitHub issues for any repository. Use /issue-tracker to interact."
user-invocable: true
metadata:
  {
    "openclaw":
      {
        "emoji": "🐛",
        "requires": { "bins": ["curl", "jq"] },
        "primaryEnv": "GH_TOKEN",
        "install":
          [
            {
              "id": "brew-jq",
              "kind": "brew",
              "formula": "jq",
              "bins": ["jq"],
              "label": "Install jq (brew)",
            },
          ],
      },
  }
---

# issue-tracker — GitHub Issue 管理

你是一个 GitHub Issue 管理助手。根据用户指令执行以下操作。

## 前置条件

GH_TOKEN 环境变量必须已设置。在执行任何操作前先确认：

\`\`\`bash
if [ -z "$GH_TOKEN" ]; then
  CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/openclaw.json}"
  GH_TOKEN=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.skills.entries["issue-tracker"].apiKey // empty')
fi

if [ -z "$GH_TOKEN" ]; then
  echo "错误：GH_TOKEN 未设置。请在 OpenClaw 配置中设置 skills.entries.issue-tracker.apiKey"
  exit 1
fi
export GH_TOKEN
\`\`\`

所有 GitHub API 调用使用此 Header：
\`\`\`
-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json"
\`\`\`

## 仓库解析

如果用户没有指定 owner/repo，从当前 Git 仓库的 remote 推断：

\`\`\`bash
REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#.*github.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')
\`\`\`

如果推断失败，要求用户明确指定。

## 命令

### /issue-tracker list [owner/repo] [选项]

列出 Issue。

选项：
| 选项 | 默认值 | 说明 |
|------|--------|------|
| --state | open | 状态：open, closed, all |
| --label | (无) | 按标签筛选 |
| --limit | 10 | 返回数量上限 |
| --assignee | (无) | 按负责人筛选 |

执行：
\`\`\`bash
curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues?per_page={limit}&state={state}&labels={label}&assignee={assignee}" \
  | jq '[.[] | select(.pull_request == null) | {number, title, state, labels: [.labels[].name], assignees: [.assignees[].login], created_at, updated_at}]'
\`\`\`

注意：GitHub Issues API 会返回 Pull Request，必须过滤掉 `pull_request` 字段不为 null 的条目。

以 Markdown 表格展示结果：

| # | Title | Labels | Assignee | Updated |
|---|-------|--------|----------|---------|
| 42 | Fix parser bug | bug | alice | 2h ago |

### /issue-tracker show <number> [owner/repo]

查看单个 Issue 详情，包括正文和评论。

\`\`\`bash
# 获取 Issue 详情
curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues/{number}"

# 获取评论
curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues/{number}/comments"
\`\`\`

展示 Issue 的标题、正文、标签、负责人，以及所有评论（按时间排序）。

### /issue-tracker create [owner/repo] --title "标题" --body "正文" [--label bug] [--assignee alice]

创建新 Issue。

\`\`\`bash
curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues" \
  -d '{
    "title": "{title}",
    "body": "{body}",
    "labels": ["{label}"],
    "assignees": ["{assignee}"]
  }'
\`\`\`

创建成功后显示 Issue URL。

### /issue-tracker comment <number> [owner/repo] --body "评论内容"

给 Issue 添加评论。

\`\`\`bash
curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues/{number}/comments" \
  -d '{"body": "{body}"}'
\`\`\`

## 错误处理

- HTTP 401/403：提示用户检查 GH_TOKEN 配置
- HTTP 404：提示仓库不存在或无权限
- HTTP 422：提示请求参数有误（显示 GitHub 返回的错误信息）
- 网络错误：提示检查网络连接

## 安全约束

- 不要在输出中显示完整的 GH_TOKEN
- 不要修改或删除 Issue（只读 + 创建 + 评论）
- 创建 Issue 前向用户确认标题和正文
```

这个 Skill 的几个设计要点：

1. **命令化接口**：通过 `/issue-tracker list`、`/issue-tracker show` 等命令触发，用户体验清晰
2. **渐进式仓库解析**：优先从 Git remote 推断，失败时再要求用户输入
3. **安全约束明确写出**：不泄露 Token、不做破坏性操作、创建前确认
4. **错误处理覆盖常见场景**：401/403/404/422 各有对应的用户提示

## 27.5 配合 MCP Server 使用

如果你的 Skill 需要更复杂的后端逻辑（比如数据库查询、第三方 API 调用），可以配合 MCP（Model Context Protocol）Server 使用。MCP Server 提供结构化的工具调用接口，Skill 负责编排调用逻辑。

一个典型的搭配方式：

```
issue-tracker/
  SKILL.md              # Skill 定义，引用 MCP 工具
  mcp-server/
    package.json         # MCP Server 依赖
    src/
      index.ts           # MCP Server 实现
    tsconfig.json
```

在 `SKILL.md` 中引用 MCP 工具：

```markdown
如果 `github-mcp` 工具可用，优先使用它而不是 curl：
- `github-mcp.list_issues({ repo, state, labels })`
- `github-mcp.get_issue({ repo, number })`
- `github-mcp.create_issue({ repo, title, body })`
```

MCP Server 的配置在 OpenClaw 的全局配置文件中（`~/.openclaw/openclaw.json`）的 `mcpServers` 字段。这超出了本章的范围，详见 OpenClaw 文档的 `docs/cli/mcp.md`。

## 27.6 本地测试流程

### 方法一：放入工作区 skills 目录

最简单的测试方式是把 Skill 放入当前项目的 `skills/` 目录：

```bash
# 在你的项目根目录
mkdir -p skills/issue-tracker
cp SKILL.md skills/issue-tracker/SKILL.md
```

OpenClaw 启动时会自动扫描工作区的 `skills/` 目录。重启 Agent 后，执行 `/issue-tracker list` 测试是否生效。

### 方法二：放入用户全局目录

如果你希望这个 Skill 在所有项目中可用：

```bash
mkdir -p ~/.openclaw/skills/issue-tracker
cp SKILL.md ~/.openclaw/skills/issue-tracker/SKILL.md
```

### 验证 Skill 是否被加载

你可以通过 OpenClaw CLI 检查：

```bash
openclaw skills list
```

应该能看到 `issue-tracker` 出现在列表中，以及其依赖状态（`curl` 和 `jq` 是否可用）。

### 测试检查清单

1. **依赖检查**：确认 `curl` 和 `jq` 已安装
2. **环境变量**：确认 `GH_TOKEN` 已设置（通过环境变量或 OpenClaw 配置）
3. **基本功能**：执行 `/issue-tracker list openclaw/openclaw` 测试列表功能
4. **错误处理**：故意传入错误的仓库名，确认错误提示正常
5. **创建功能**：在测试仓库中创建一个 Issue，确认工作流完整

## 27.7 发布到 ClawHub

将 Skill 发布到 ClawHub 需要以下步骤。

### 1. 准备 GitHub 账号

ClawHub 使用 GitHub 账号认证。你需要一个 verified 的 GitHub 账号。

### 2. 检查 Skill 质量

发布前确保：

- `SKILL.md` 的 frontmatter 格式正确（name、description 必填）
- `requires` 中声明了所有外部依赖
- Skill 正文中没有硬编码的路径或凭证
- 描述准确反映 Skill 的功能

### 3. 通过 CLI 发布

```bash
# 登录 ClawHub
openclaw clawhub login

# 发布当前目录的 Skill
openclaw clawhub publish ./issue-tracker

# 指定版本发布
openclaw clawhub publish ./issue-tracker --version 1.0.0
```

### 4. 更新已发布的 Skill

```bash
# 更新到新版本
openclaw clawhub publish ./issue-tracker --version 1.1.0
```

ClawHub 会自动做以下检查：

- Slug 格式校验（字母数字和连字符，`/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i`）
- `SKILL.md` 存在性验证
- 安全扫描（检查是否包含已知恶意模式）

### 5. 用户安装你的 Skill

发布后，其他用户可以通过以下方式安装：

```bash
openclaw clawhub install issue-tracker
```

安装过程会自动：
1. 从 ClawHub 下载 tar 归档
2. 解压到 `{workspaceDir}/skills/issue-tracker/`
3. 写入 `.clawhub/origin.json` 记录来源
4. 更新 `.clawhub/lock.json` 锁文件

## 27.8 完整代码

本章的完整示例代码位于 `examples/issue-tracker/SKILL.md`。这是一个可以直接使用的 Skill 文件，复制到你的 `skills/` 目录即可运行。

为了验证 Skill 的 frontmatter 格式是否正确，`examples/` 目录中还提供了一个简单的验证脚本 `validate-skill.ts`，它会解析 YAML frontmatter 并检查必填字段。

下一章将进入更深层的扩展开发——实现一个 Channel Extension，通过代码扩展 OpenClaw 的通信能力。

## 练习

**思考题**

1. 本章的 GitHub Issue Tracker Skill 使用 `curl` + `jq` 来操作 GitHub API。Skill 的执行依赖用户环境中已安装的 `curl`、`jq` 工具和有效的 GitHub Token。如果用户没有安装这些工具或者没有配置 Token，Skill 会在运行时才发现问题。你会怎样设计一个 Skill 的"依赖检查"机制，在 Skill 加载阶段就验证前置条件？

**动手题**

2. 基于本章的 Issue Tracker Skill 模板，编写一个新的 Skill（比如"Git Commit Message 规范检查"），定义 YAML frontmatter 中的 `globs` 字段使其只在 Git 仓库中生效。将 Skill 部署到 OpenClaw 并测试其触发条件是否正确。

3. 运行本章 `examples/` 目录中的 `validate-skill.ts` 验证脚本，检查你在上一题中编写的 SKILL.md 格式是否正确。故意引入一个格式错误（比如缺少 `name` 字段），观察验证脚本给出的错误信息。
