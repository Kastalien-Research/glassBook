import fs from 'node:fs';
import Path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CodebaseProtocolId } from './types.mjs';

export interface ProtocolTransitionSpec {
  readonly from?: string;
  readonly to: string;
  readonly condition: string;
}

export interface ProtocolBehaviorSchema {
  readonly action: string;
  readonly evaluator: string;
}

export interface ProtocolSourceDefinition {
  readonly id: CodebaseProtocolId;
  readonly title: string;
  readonly path: string;
  readonly overview: string;
  readonly requirements: readonly string[];
  readonly entities: readonly string[];
  readonly behaviorSchema: ProtocolBehaviorSchema;
  readonly transitions: readonly ProtocolTransitionSpec[];
  readonly packetSchema: readonly string[];
}

const SOURCE_FILES: Record<CodebaseProtocolId, string> = {
  ulysses: 'workflows/ulysses.md',
  theseus: 'workflows/epiops_protocols/Theseus_Protocol.md',
  hephaestus: 'workflows/epiops_protocols/Hephaestus_Protocol.md',
  ariadne: 'workflows/epiops_protocols/Ariadne_Protocol.md',
};

export function loadCodebaseProtocolSources(repoRoot: string = findRepoRoot()) {
  return (Object.keys(SOURCE_FILES) as CodebaseProtocolId[]).map((id) => {
    const relativePath = SOURCE_FILES[id];
    const markdown = fs.readFileSync(Path.join(repoRoot, relativePath), 'utf8');
    return parseProtocolSource(id, relativePath, markdown);
  });
}

export function parseProtocolSource(
  id: CodebaseProtocolId,
  path: string,
  markdown: string,
): ProtocolSourceDefinition {
  return {
    id,
    path,
    title: parseTitle(markdown),
    overview: firstParagraph(section(markdown, 'Overview')),
    requirements: bullets(section(markdown, 'Requirements')),
    entities: parseEntities(markdown),
    behaviorSchema: parseBehaviorSchema(markdown),
    transitions: parseTransitions(markdown),
    packetSchema: parsePacketSchema(markdown),
  };
}

function findRepoRoot(): string {
  const starts = [process.cwd(), Path.dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let current = start;
    for (let depth = 0; depth < 10; depth += 1) {
      if (fs.existsSync(Path.join(current, 'workflows', 'ulysses.md'))) {
        return current;
      }
      const parent = Path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('Unable to locate workflows/ulysses.md from the current workspace.');
}

function parseTitle(markdown: string): string {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) throw new Error('Protocol markdown is missing a top-level title.');
  return title;
}

function section(markdown: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) return '';
  const bodyStart = start + marker.length;
  const next = markdown.indexOf('\n## ', bodyStart);
  return markdown.slice(bodyStart, next === -1 ? undefined : next).trim();
}

function firstParagraph(text: string): string {
  return (
    text
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? ''
  );
}

function bullets(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
}

function parseEntities(markdown: string): string[] {
  const defaults = markdown.match(/Defaults at the beginning:\n\n(?<body>[\s\S]*?)(?:\n\n|$)/)
    ?.groups?.body;
  if (!defaults) return [];
  return defaults
    .split('\n')
    .map((line) => line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/)?.[1])
    .filter((entity): entity is string => Boolean(entity));
}

function parseBehaviorSchema(markdown: string): ProtocolBehaviorSchema {
  const match = markdown.match(
    /Each behavior is defined in two parts:\n\n(?<body>[\s\S]*?)(?:\n\n|$)/,
  );
  const lines =
    match?.groups?.body
      ?.split('\n')
      .map((line) => line.match(/^\s*\d+\.\s+(.+)$/)?.[1]?.trim())
      .filter((line): line is string => Boolean(line)) ?? [];
  return {
    action: lines[0] ?? '',
    evaluator: lines[1] ?? '',
  };
}

function parseTransitions(markdown: string): ProtocolTransitionSpec[] {
  return markdown
    .split('\n')
    .map((line) => transitionFromLine(line))
    .filter((transition): transition is ProtocolTransitionSpec => Boolean(transition));
}

function transitionFromLine(line: string): ProtocolTransitionSpec | undefined {
  const condition = line.replace(/^\s*[a-z]\d?\.?\s*/i, '').trim();
  const fromTo = condition.match(/from\s+(-?\d)\s+to\s+(-?\d)/);
  if (fromTo?.[1] && fromTo[2]) {
    return { from: fromTo[1], to: fromTo[2], condition };
  }

  const to = condition.match(/(?:to|resets?[^.]*to)\s+(-?\d)/);
  if (!to?.[1] || !condition.includes('state step')) return undefined;
  return { to: to[1], condition };
}

function parsePacketSchema(markdown: string): string[] {
  const match = markdown.match(/packet must contain:\n\n(?<body>[\s\S]*?)(?:\n\n|$)/i);
  return bullets(match?.groups?.body ?? '');
}
