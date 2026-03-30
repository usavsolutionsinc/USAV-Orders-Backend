/**
 * LLM Agent
 *
 * Takes a discovered task, reads the relevant source files, constructs a
 * prompt, sends it to the local MLX model, parses the structured JSON
 * response, and applies file changes to disk.
 *
 * The agent is deliberately constrained:
 *   - It only edits files listed in the task's filePaths
 *   - It returns full file contents (no partial patches)
 *   - It operates on a dedicated git branch (managed by orchestrator)
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { MLX_BASE_URL, MLX_MODEL, AGENT_MAX_TOKENS, AGENT_TEMPERATURE } from './config';
import type { DiscoveredTask, Implementation, AgentResponse } from './types';

// ─── System Prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior TypeScript/Next.js engineer working on a warehouse operations platform.
Your job is to fix code issues precisely and minimally — change only what is needed.

Rules:
- Preserve existing code style (indentation, naming conventions, import order).
- Do not add comments unless the logic is genuinely non-obvious.
- Do not add features, refactor surrounding code, or "improve" things beyond the fix.
- If you cannot confidently fix the issue, return an empty files array.

Return ONLY a JSON object (no markdown fences, no explanation text):
{
  "files": [
    { "path": "src/relative/path.ts", "content": "full file content after your fix" }
  ],
  "reasoning": "one sentence explaining what you changed and why"
}`;

// ─── Prompt Builder ──────────────────────────────────────────

function buildPrompt(task: DiscoveredTask, fileContents: Record<string, string>): string {
  const parts: string[] = [];

  parts.push(`## Task\n\n**${task.title}**\n\n${task.description}`);

  for (const [path, content] of Object.entries(fileContents)) {
    // Cap individual files at 300 lines to stay within context window
    const lines = content.split('\n');
    const truncated = lines.length > 300
      ? lines.slice(0, 300).join('\n') + `\n\n... (${lines.length - 300} more lines truncated)`
      : content;
    parts.push(`### File: ${path}\n\`\`\`typescript\n${truncated}\n\`\`\``);
  }

  if (task.context) {
    parts.push(`### Error context\n\`\`\`\n${task.context}\n\`\`\``);
  }

  return parts.join('\n\n');
}

// ─── LLM Call ────────────────────────────────────────────────

async function callModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${MLX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MLX_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: AGENT_TEMPERATURE,
        max_tokens: AGENT_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MLX server returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Response Parser ─────────────────────────────────────────

function parseAgentResponse(raw: string): AgentResponse | null {
  // Strip markdown code fences if the model wrapped the output
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned) as AgentResponse;
    if (!Array.isArray(parsed.files)) return null;
    // Validate each file entry has path and content strings
    for (const f of parsed.files) {
      if (typeof f.path !== 'string' || typeof f.content !== 'string') return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ─── Main Entry Point ────────────────────────────────────────

/**
 * Implement a single task:
 *   1. Read the relevant source files
 *   2. Build a prompt with task description + file contents
 *   3. Call the local MLX model
 *   4. Parse the JSON response
 *   5. Write changed files to disk
 *   6. Return the git diff
 */
export async function implementTask(
  task: DiscoveredTask,
  repoPath: string,
): Promise<Implementation> {
  const noChanges: Implementation = {
    filesChanged: [],
    diff: '',
    reasoning: '',
    rawOutput: '',
    parsed: false,
  };

  // 1. Read current file contents
  const fileContents: Record<string, string> = {};
  for (const relPath of task.filePaths) {
    try {
      fileContents[relPath] = readFileSync(join(repoPath, relPath), 'utf-8');
    } catch {
      // File might have been deleted or moved since discovery
    }
  }

  if (Object.keys(fileContents).length === 0) {
    return { ...noChanges, reasoning: 'No readable source files found' };
  }

  // 2. Build prompt and call model
  const prompt = buildPrompt(task, fileContents);
  let rawOutput: string;
  try {
    rawOutput = await callModel(SYSTEM_PROMPT, prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...noChanges, reasoning: `Model call failed: ${message}` };
  }

  // 3. Parse response
  const response = parseAgentResponse(rawOutput);
  if (!response || response.files.length === 0) {
    return {
      ...noChanges,
      rawOutput,
      reasoning: response?.reasoning || 'Model returned no file changes',
    };
  }

  // 4. Apply changes to disk
  const filesChanged: string[] = [];
  for (const file of response.files) {
    // Safety: only allow writing to files within the repo and within src/
    const normalized = file.path.replace(/\\/g, '/');
    if (normalized.includes('..') || !normalized.startsWith('src/')) {
      continue;
    }
    const fullPath = join(repoPath, normalized);
    try {
      writeFileSync(fullPath, file.content, 'utf-8');
      filesChanged.push(normalized);
    } catch {
      // Skip files we can't write (permissions, invalid path, etc.)
    }
  }

  if (filesChanged.length === 0) {
    return {
      ...noChanges,
      rawOutput,
      parsed: true,
      reasoning: response.reasoning || 'All file writes were rejected by safety checks',
    };
  }

  // 5. Capture git diff
  let diff = '';
  try {
    diff = execSync('git diff', {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch {
    diff = '(unable to capture diff)';
  }

  return {
    filesChanged,
    diff,
    reasoning: response.reasoning || '',
    rawOutput,
    parsed: true,
  };
}
