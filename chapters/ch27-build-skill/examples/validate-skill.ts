#!/usr/bin/env npx tsx

/**
 * validate-skill.ts — OpenClaw Skill YAML Frontmatter 校验工具
 *
 * 用法：
 *   npx tsx validate-skill.ts ./issue-tracker/SKILL.md
 *
 * 检查项：
 *   1. YAML frontmatter 是否存在且格式正确
 *   2. name 和 description 是否已填写
 *   3. metadata.openclaw.requires 中声明的二进制文件是否存在
 *   4. install 规格的 kind 是否合法
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

// 支持的安装类型
const VALID_INSTALL_KINDS = new Set(['brew', 'node', 'go', 'uv', 'download']);

// 安全校验正则（与 OpenClaw 源码一致）
const SAFE_BREW_FORMULA = /^[a-z0-9][a-z0-9+._@-]*(\/[a-z0-9][a-z0-9+._@-]*){0,2}$/;
const SAFE_NODE_PACKAGE = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+(@[a-z0-9^~>=<.*|-]+)?$/;
const SAFE_GO_MODULE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*@[a-z0-9v._-]+$/;

interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// 解析 YAML frontmatter（简易解析，生产环境请用 yaml 库）
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const yamlText = match[1];
  const result: Record<string, unknown> = {};

  // 简易的顶层 key: value 解析
  const lines = yamlText.split('\n');
  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: string | boolean = kvMatch[2].trim();

      // 去除引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // 布尔值转换
      if (value === 'true') value = true as unknown as string;
      if (value === 'false') value = false as unknown as string;

      result[key] = value;
    }
  }

  // 解析 metadata JSON 块
  const metadataMatch = yamlText.match(/metadata:\s*\n\s*(\{[\s\S]*\})/);
  if (metadataMatch) {
    try {
      result.metadata = JSON.parse(metadataMatch[1]);
    } catch {
      // JSON 解析失败时保持原始文本
      result.metadata = metadataMatch[1];
    }
  }

  return result;
}

// 检查二进制文件是否存在
function hasBinary(bin: string): boolean {
  try {
    execSync(`which ${bin}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// 校验安装规格
function validateInstallSpec(
  spec: Record<string, unknown>,
  index: number,
): string[] {
  const errors: string[] = [];
  const kind = spec.kind as string;

  if (!kind || !VALID_INSTALL_KINDS.has(kind)) {
    errors.push(`install[${index}]: kind "${kind}" 不合法，支持的值: ${[...VALID_INSTALL_KINDS].join(', ')}`);
    return errors;
  }

  switch (kind) {
    case 'brew': {
      const formula = spec.formula as string;
      if (!formula) {
        errors.push(`install[${index}]: brew 类型必须指定 formula`);
      } else if (!SAFE_BREW_FORMULA.test(formula)) {
        errors.push(`install[${index}]: formula "${formula}" 格式不合法`);
      }
      break;
    }
    case 'node': {
      const pkg = spec.package as string;
      if (!pkg) {
        errors.push(`install[${index}]: node 类型必须指定 package`);
      } else if (!SAFE_NODE_PACKAGE.test(pkg)) {
        errors.push(`install[${index}]: package "${pkg}" 格式不合法`);
      }
      break;
    }
    case 'go': {
      const mod = spec.module as string;
      if (!mod) {
        errors.push(`install[${index}]: go 类型必须指定 module`);
      } else if (!SAFE_GO_MODULE.test(mod)) {
        errors.push(`install[${index}]: module "${mod}" 格式不合法`);
      }
      break;
    }
  }

  return errors;
}

// 主校验函数
function validateSkill(filePath: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 文件存在性检查
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    return { ok: false, errors: [`文件不存在: ${resolvedPath}`], warnings: [] };
  }

  const content = readFileSync(resolvedPath, 'utf-8');

  // 2. Frontmatter 存在性检查
  if (!content.startsWith('---')) {
    errors.push('SKILL.md 必须以 YAML frontmatter 开头 (---)');
    return { ok: false, errors, warnings };
  }

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    errors.push('无法解析 YAML frontmatter');
    return { ok: false, errors, warnings };
  }

  // 3. 必填字段检查
  if (!frontmatter.name) {
    errors.push('缺少必填字段: name');
  } else if (typeof frontmatter.name !== 'string') {
    errors.push('name 必须是字符串');
  }

  if (!frontmatter.description) {
    errors.push('缺少必填字段: description');
  } else if (typeof frontmatter.description !== 'string') {
    errors.push('description 必须是字符串');
  }

  // 4. Metadata 检查
  const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
  const openclaw = metadata?.openclaw as Record<string, unknown> | undefined;

  if (!openclaw) {
    warnings.push('未设置 metadata.openclaw，Skill 将没有依赖管理和自动安装功能');
  } else {
    // 检查 requires
    const requires = openclaw.requires as Record<string, unknown> | undefined;
    if (requires?.bins && Array.isArray(requires.bins)) {
      for (const bin of requires.bins as string[]) {
        if (!hasBinary(bin)) {
          warnings.push(`requires.bins 中的 "${bin}" 在当前系统未安装`);
        }
      }
    }

    // 检查 install
    const install = openclaw.install as Record<string, unknown>[] | undefined;
    if (install && Array.isArray(install)) {
      for (let i = 0; i < install.length; i++) {
        errors.push(...validateInstallSpec(install[i], i));
      }
    }
  }

  // 5. Skill 正文检查
  const bodyStart = content.indexOf('---', 4);
  const body = bodyStart > 0 ? content.slice(bodyStart + 3).trim() : '';

  if (body.length < 50) {
    warnings.push('Skill 正文过短（少于 50 字符），建议补充更详细的指令');
  }

  if (!body.includes('#')) {
    warnings.push('Skill 正文没有使用 Markdown 标题，建议用 ## 组织结构');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

// 入口
function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法: npx tsx validate-skill.ts <path-to-SKILL.md>');
    console.log('示例: npx tsx validate-skill.ts ./issue-tracker/SKILL.md');
    process.exit(1);
  }

  const filePath = args[0];
  console.log(`\n校验 Skill: ${filePath}\n`);

  const result = validateSkill(filePath);

  if (result.errors.length > 0) {
    console.log('错误:');
    for (const error of result.errors) {
      console.log(`  [x] ${error}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('警告:');
    for (const warning of result.warnings) {
      console.log(`  [!] ${warning}`);
    }
  }

  if (result.ok) {
    console.log('\n校验通过。Skill 格式正确。\n');
  } else {
    console.log('\n校验失败。请修复上述错误后重试。\n');
    process.exit(1);
  }
}

main();
