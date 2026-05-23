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

```bash
if [ -z "$GH_TOKEN" ]; then
  CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/openclaw.json}"
  GH_TOKEN=$(cat "$CONFIG_PATH" 2>/dev/null | jq -r '.skills.entries["issue-tracker"].apiKey // empty')
fi

if [ -z "$GH_TOKEN" ]; then
  echo "错误：GH_TOKEN 未设置。请在 OpenClaw 配置中设置 skills.entries.issue-tracker.apiKey"
  exit 1
fi
export GH_TOKEN
```

所有 GitHub API 调用使用此 Header：
```
-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json"
```

## 仓库解析

如果用户没有指定 owner/repo，从当前 Git 仓库的 remote 推断：

```bash
REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#.*github.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')
```

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
```bash
curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues?per_page={limit}&state={state}&labels={label}&assignee={assignee}" \
  | jq '[.[] | select(.pull_request == null) | {number, title, state, labels: [.labels[].name], assignees: [.assignees[].login], created_at, updated_at}]'
```

注意：GitHub Issues API 会返回 Pull Request，必须过滤掉 `pull_request` 字段不为 null 的条目。

以 Markdown 表格展示结果：

| # | Title | Labels | Assignee | Updated |
|---|-------|--------|----------|---------|
| 42 | Fix parser bug | bug | alice | 2h ago |

### /issue-tracker show <number> [owner/repo]

查看单个 Issue 详情，包括正文和评论。

```bash
# 获取 Issue 详情
curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues/{number}"

# 获取评论
curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues/{number}/comments"
```

展示 Issue 的标题、正文、标签、负责人，以及所有评论（按时间排序）。

### /issue-tracker create [owner/repo] --title "标题" --body "正文" [--label bug] [--assignee alice]

创建新 Issue。

```bash
curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues" \
  -d '{
    "title": "{title}",
    "body": "{body}",
    "labels": ["{label}"],
    "assignees": ["{assignee}"]
  }'
```

创建成功后显示 Issue URL。

### /issue-tracker comment <number> [owner/repo] --body "评论内容"

给 Issue 添加评论。

```bash
curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/{REPO}/issues/{number}/comments" \
  -d '{"body": "{body}"}'
```

## 错误处理

- HTTP 401/403：提示用户检查 GH_TOKEN 配置
- HTTP 404：提示仓库不存在或无权限
- HTTP 422：提示请求参数有误（显示 GitHub 返回的错误信息）
- 网络错误：提示检查网络连接

## 安全约束

- 不要在输出中显示完整的 GH_TOKEN
- 不要修改或删除 Issue（只读 + 创建 + 评论）
- 创建 Issue 前向用户确认标题和正文
