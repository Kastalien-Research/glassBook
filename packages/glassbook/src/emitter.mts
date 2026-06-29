import fs from 'node:fs/promises';
import Path from 'node:path';
import { randomid } from '@srcbook/shared';
import type { MarkdownCellType, CodeCellType } from '@srcbook/shared';
import {
  createSrcbook,
  createSession,
  addCell,
  exportSrcmdText,
  type SessionType,
} from '@srcbook/api/headless';
import type { GlassbookState, GlassbookError } from './types.mjs';

/**
 * The emitter IS the notebook. Every step the orchestrator takes is appended as
 * a srcmd cell and flushed to disk immediately, so a crashed or rejected run
 * still leaves a fully auditable notebook behind. Auditing == opening this
 * notebook in the Srcbook UI and clicking back through the cells.
 */
export class NotebookEmitter {
  private constructor(private readonly session: SessionType) {}

  static async create(title: string): Promise<NotebookEmitter> {
    const dir = await createSrcbook(title, 'typescript');
    const session = await createSession(dir);
    return new NotebookEmitter(session);
  }

  get dir(): string {
    return this.session.dir;
  }

  async markdown(text: string): Promise<void> {
    const cell: MarkdownCellType = { id: randomid(), type: 'markdown', text };
    await addCell(this.session, cell, this.session.cells.length);
  }

  async code(filename: string, source: string): Promise<void> {
    const cell: CodeCellType = {
      id: randomid(),
      type: 'code',
      source,
      language: 'typescript',
      filename,
      status: 'idle',
    };
    await addCell(this.session, cell, this.session.cells.length);
  }

  /** A section header followed by a body paragraph. */
  async section(title: string, body: string): Promise<void> {
    await this.markdown(`## ${title}\n\n${body}`);
  }

  /** Evidence rendered as a fenced block inside a markdown cell. */
  async evidence(title: string, lang: string, content: string): Promise<void> {
    await this.markdown(`### ${title}\n\n\`\`\`${lang}\n${content}\n\`\`\``);
  }

  exportSrcMd(): string {
    return exportSrcmdText(this.session);
  }

  async writeSrcMd(path: string): Promise<void> {
    await fs.writeFile(path, this.exportSrcMd(), 'utf8');
  }

  /** Persist the machine-readable state for deterministic replay/re-evaluation. */
  async persistState(state: GlassbookState): Promise<void> {
    const sidecar = Path.join(this.session.dir, 'glassbook.json');
    await fs.writeFile(sidecar, JSON.stringify(serializeState(state), null, 2), 'utf8');
  }
}

function serializeError(e: GlassbookError) {
  return { _tag: e._tag, message: e.message };
}

function serializeState(state: GlassbookState) {
  return {
    prompt: state.prompt,
    repoDir: state.repoDir,
    template: state.template,
    notebookDir: state.notebookDir,
    plan: state.plan,
    research: state.research,
    workPlan: state.workPlan,
    execution: state.execution,
    evaluation: state.evaluation,
    budgets: state.budgets,
    checkpoints: state.checkpoints,
    workingBranch: state.workingBranch,
    pullRequestUrl: state.pullRequestUrl,
    usage: state.usage,
    failures: state.failures.map(serializeError),
  };
}
