/**
 * Skills 加载器
 *
 * OpenClaw 的 Skills 系统（src/agents/skills/）非常成熟：
 * - 从 ~/.openclaw/skills/ 和项目 .openclaw/skills/ 加载
 * - 支持 frontmatter 元数据解析
 * - 按需加载（模型判断是否需要某个 skill）
 * - 支持 install spec、环境要求检测等
 *
 * 这里保留核心模式：扫描 skills 目录，解析 SKILL.md 的 frontmatter，
 * 生成索引注入 prompt，由模型按需 read 加载。
 */

import fs from 'node:fs';
import path from 'node:path';

/** Skill 元数据 */
export type SkillMeta = {
  name: string;
  description: string;
  filePath: string;
};

export class SkillsLoader {
  private skillsDir: string;
  private skills: SkillMeta[] = [];

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    this.loadSkills();
  }

  /** 获取所有已加载的 Skill 元数据 */
  getSkills(): SkillMeta[] {
    return this.skills;
  }

  /**
   * 生成 Skills 索引文本，注入 System Prompt
   *
   * 格式与 OpenClaw 的 formatSkillsForPrompt()（src/agents/skills/skill-contract.ts）
   * 保持一致，使用 XML 标签让模型容易解析。
   */
  getSkillsIndexForPrompt(): string | null {
    if (this.skills.length === 0) {
      return null;
    }

    const lines = [
      'The following skills provide specialized instructions for specific tasks.',
      'Use the read_file tool to load a skill\'s file when the task matches its description.',
      '',
      '<available_skills>',
    ];

    for (const skill of this.skills) {
      lines.push('  <skill>');
      lines.push(`    <name>${escapeXml(skill.name)}</name>`);
      lines.push(`    <description>${escapeXml(skill.description)}</description>`);
      lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
      lines.push('  </skill>');
    }

    lines.push('</available_skills>');
    return lines.join('\n');
  }

  /** 重新扫描 skills 目录 */
  reload(): void {
    this.skills = [];
    this.loadSkills();
  }

  // ---- 内部方法 ----

  /** 扫描 skills 目录，加载每个子目录的 SKILL.md */
  private loadSkills(): void {
    if (!fs.existsSync(this.skillsDir)) {
      return;
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(this.skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      try {
        const content = fs.readFileSync(skillFile, 'utf-8');
        const frontmatter = parseFrontmatter(content);

        const name = frontmatter.name || entry.name;
        const description = frontmatter.description;

        if (!description) {
          console.warn(
            `[Skills] 跳过 ${entry.name}: SKILL.md 缺少 description`,
          );
          continue;
        }

        this.skills.push({
          name,
          description,
          filePath: skillFile,
        });

        console.log(`[Skills] 已加载: ${name}`);
      } catch (err) {
        console.warn(
          `[Skills] 加载 ${entry.name} 失败:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    console.log(`[Skills] 共加载 ${this.skills.length} 个 skill`);
  }
}

/**
 * 解析简单的 YAML frontmatter
 *
 * OpenClaw 中由 src/agents/skills/frontmatter.ts 实现，
 * 支持更复杂的格式。这里只处理 key: value 对。
 */
function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  // 检查是否以 --- 开头
  if (!content.startsWith('---')) {
    return result;
  }

  // 找到第二个 ---
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return result;
  }

  const frontmatterText = content.slice(3, endIndex).trim();
  for (const line of frontmatterText.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/** XML 转义 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
