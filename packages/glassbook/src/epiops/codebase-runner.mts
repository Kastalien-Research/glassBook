import fs from 'node:fs';
import Path from 'node:path';
import { runGates as runGatesPure, type GateOutcome, type ShRunner } from '../gates.mjs';
import { sh, makeReadOnlyTools } from '../tools.mjs';
import { runToolSubagent, MAX_STEPS } from '../subagent.mjs';
import { consumeBudget, type SectionContext } from '../context.mjs';
import { makeGlassbookCell } from '../cell.mjs';
import { ok, type Result } from '../types.mjs';
import { commitAll, isClean } from '../git.mjs';
import type { Plan, WorkPlan, ExecutionResult, EpiOpsProcessId } from '../schemas.mjs';
import type {
  AriadnePacket,
  CodebaseProtocolPacket,
  HephaestusPacket,
  TheseusPacket,
  UlyssesPacket,
} from './protocols/types.mjs';
import { runUlysses } from './ulysses.mjs';

export interface CodebaseProtocolAdapter {
  readonly id: EpiOpsProcessId;
  readonly title: string;
  readonly mutatesRepo: boolean;
  readonly readOnlyTools?: boolean;
  readonly baselineGateLabel: string;
  readonly finalGateLabel: string;
  readonly system: (args: { plan: Plan; workPlan: WorkPlan }) => string;
  readonly prompt: (args: { ctx: SectionContext; plan: Plan; workPlan: WorkPlan }) => string;
  readonly packet: (args: PacketArgs) => CodebaseProtocolPacket;
  readonly desiredStateAchieved: (args: {
    readonly evidence: string;
    readonly baseline: GateOutcome | undefined;
    readonly final: GateOutcome | undefined;
  }) => boolean;
}

interface PacketArgs {
  readonly ctx: SectionContext;
  readonly plan: Plan;
  readonly workPlan: WorkPlan;
  readonly evidence: string;
  readonly baseline: GateOutcome | undefined;
  readonly final: GateOutcome | undefined;
}

interface RunProtocolArgs {
  readonly ctx: SectionContext;
  readonly plan: Plan;
  readonly workPlan: WorkPlan;
}

export async function runCodebaseProtocol({
  ctx,
  plan,
  workPlan,
}: RunProtocolArgs): Promise<Result<ExecutionResult>> {
  if (workPlan.process === 'ulysses') {
    const result = await runUlysses(ctx, plan, workPlan);
    if (!result.ok) return result;
    const enriched = enrichUlysses(ctx, plan, result.value);
    ctx.state.execution = enriched;
    return ok(enriched);
  }

  const adapter = adapterFor(workPlan.process);
  const consumed = consumeBudget(ctx.state, 'workExecution', 1);
  if (!consumed.ok) return consumed;

  await ctx.emitter.section(
    `Work execution — ${adapter.title}`,
    [
      `**Process:** ${adapter.id}`,
      `**Rationale:** ${workPlan.rationale}`,
      `**Primary behavior:** ${workPlan.primaryHypothesis}`,
      `**Backup behavior:** ${workPlan.backupHypothesis}`,
    ].join('\n'),
  );

  const baseline = adapter.mutatesRepo ? await runGates(ctx, plan.finalGates) : undefined;
  if (baseline) {
    await ctx.emitter.evidence(adapter.baselineGateLabel, 'text', baseline.output);
  }

  const tools =
    adapter.readOnlyTools || !adapter.mutatesRepo ? makeReadOnlyTools(ctx.repoDir) : ctx.tools;
  const agent = await runToolSubagent({
    system: adapter.system({ plan, workPlan }),
    prompt: adapter.prompt({ ctx, plan, workPlan }),
    tools,
    maxSteps: adapter.mutatesRepo ? MAX_STEPS.worker : MAX_STEPS.hypothesis,
    role: adapter.mutatesRepo ? 'worker' : 'hypothesis',
    meter: ctx.meter,
  });
  if (!agent.ok) return agent;

  const final = adapter.mutatesRepo ? await runGates(ctx, plan.finalGates) : undefined;
  if (final) {
    await ctx.emitter.evidence(adapter.finalGateLabel, 'text', final.output);
  }
  if (adapter.mutatesRepo && final?.passed) {
    const clean = await isClean(ctx.repoDir);
    if (!clean.ok) return clean;
    if (!clean.value) {
      const commit = await commitAll(
        ctx.repoDir,
        `glassbook(${adapter.id}): commit verified protocol artifacts`,
      );
      if (!commit.ok) return commit;
      ctx.state.checkpoints.push(commit.value);
    }
  }

  const packet = adapter.packet({
    ctx,
    plan,
    workPlan,
    evidence: agent.value.text,
    baseline,
    final,
  });
  const achieved = adapter.desiredStateAchieved({
    evidence: agent.value.text,
    baseline,
    final,
  });
  const output = final?.output ?? agent.value.text;
  const execution: ExecutionResult = {
    desiredStateAchieved: achieved,
    evidence: formatExecutionEvidence(adapter, packet, agent.value.text),
    testOutput: output,
    protocol: adapter.id,
    packet,
    verification: {
      baselinePassed: baseline?.passed,
      finalPassed: final?.passed ?? achieved,
      commands: plan.finalGates.map((gate) => gate.command),
    },
  };

  ctx.state.glassbookCells.push(
    makeGlassbookCell({
      section: 'workExecution',
      input: {
        prompt: ctx.state.prompt,
        goal: plan.goal,
        protocol: adapter.id,
        primaryBehavior: workPlan.primaryHypothesis,
        backupBehavior: workPlan.backupHypothesis,
      },
      processing: {
        rationale: workPlan.rationale,
        baselinePassed: baseline?.passed ?? null,
        finalPassed: final?.passed ?? null,
      },
      output: {
        desiredStateAchieved: achieved,
        packet,
      },
      gates: plan.finalGates,
    }),
  );

  await ctx.emitter.evidence(`${adapter.title} packet`, 'json', JSON.stringify(packet, null, 2));
  ctx.state.execution = execution;
  return ok(execution);
}

function adapterFor(process: Exclude<EpiOpsProcessId, 'ulysses'>): CodebaseProtocolAdapter {
  switch (process) {
    case 'theseus':
      return theseusAdapter;
    case 'hephaestus':
      return hephaestusAdapter;
    case 'ariadne':
      return ariadneAdapter;
  }
}

async function runGates(ctx: SectionContext, gates: Plan['finalGates']): Promise<GateOutcome> {
  const run: ShRunner = (command) =>
    sh(command, { cwd: ctx.repoDir, timeoutMs: 300_000 }).then((r) => ({
      code: r.code,
      combined: r.combined,
    }));
  return runGatesPure(gates, run);
}

function enrichUlysses(ctx: SectionContext, plan: Plan, result: ExecutionResult): ExecutionResult {
  const packet: UlyssesPacket = {
    protocol: 'ulysses',
    packet: 'fix',
    objective: plan.goal,
    resolved: result.desiredStateAchieved,
    checkpoints: ctx.state.checkpoints,
    gates: plan.finalGates.map((gate) => gate.command),
    evidence: result.evidence,
  };
  return {
    ...result,
    protocol: 'ulysses',
    packet,
    verification: {
      finalPassed: result.desiredStateAchieved,
      commands: plan.finalGates.map((gate) => gate.command),
    },
  };
}

function formatExecutionEvidence(
  adapter: CodebaseProtocolAdapter,
  packet: CodebaseProtocolPacket,
  evidence: string,
): string {
  return [`${adapter.title} completed with packet \`${packet.packet}\`.`, '', evidence].join('\n');
}

function gateCommands(plan: Plan): string[] {
  return plan.finalGates.map((gate) => gate.command);
}

function remainingRisks(plan: Plan): string[] {
  return plan.risks.length > 0 ? plan.risks : ['No additional risks were recorded by planning.'];
}

const theseusAdapter: CodebaseProtocolAdapter = {
  id: 'theseus',
  title: 'Theseus transformation',
  mutatesRepo: true,
  baselineGateLabel: 'Theseus baseline invariant gate',
  finalGateLabel: 'Theseus equivalence gate',
  system: ({ plan }) =>
    [
      'You are executing the Theseus Protocol for a codebase transformation.',
      'Make the smallest identity-preserving change that advances the objective while keeping invariants intact.',
      'Do not weaken tests, public contracts, schemas, permissions, or externally observable behavior.',
      'Run the evaluator suite after the change and summarize the exact invariant evidence.',
      `Preserved identity criteria:\n- ${plan.successCriteria.join('\n- ')}`,
    ].join('\n'),
  prompt: ({ ctx, plan, workPlan }) =>
    [
      `Objective: ${ctx.state.prompt}`,
      `Transformation goal: ${plan.goal}`,
      `Primary transformation slice: ${workPlan.primaryHypothesis}`,
      `Backup transformation slice: ${workPlan.backupHypothesis}`,
      `Evaluator commands:\n- ${gateCommands(plan).join('\n- ')}`,
    ].join('\n\n'),
  packet: ({ plan, workPlan, final }): TheseusPacket => ({
    protocol: 'theseus',
    packet: 'transformation',
    objective: plan.goal,
    invariants: plan.successCriteria,
    acceptedChanges: [workPlan.primaryHypothesis, workPlan.backupHypothesis],
    evaluatorSuite: gateCommands(plan),
    equivalent: final?.passed ?? false,
    rollbackPlan:
      'Revert the protocol branch merge commit or restore the latest glassBook checkpoint.',
    remainingRisks: remainingRisks(plan),
  }),
  desiredStateAchieved: ({ final }) => final?.passed ?? false,
};

const hephaestusAdapter: CodebaseProtocolAdapter = {
  id: 'hephaestus',
  title: 'Hephaestus reproduction',
  mutatesRepo: true,
  baselineGateLabel: 'Hephaestus initial failure oracle',
  finalGateLabel: 'Hephaestus minimized failure oracle',
  system: ({ plan }) =>
    [
      'You are executing the Hephaestus Protocol for a minimal reproducible case.',
      'Your job is to reduce complexity while preserving the target failure oracle.',
      'Do not fix the bug. Preserve the failure, make the reproducer smaller or more controlled, and record what remains irreducible.',
      'Do not create reproduction packet files, protocol reports, summaries, indexes, manifests, or notebook documents in the target repository; glassBook emits the reproduction packet in the notebook and sidecar.',
      'If the current repository is already minimal, do not modify it. Inspect it, run the oracle, and report why no further reduction is safe.',
      `Failure oracle / verification commands:\n- ${gateCommands(plan).join('\n- ')}`,
    ].join('\n'),
  prompt: ({ ctx, plan, workPlan }) =>
    [
      `Target failure: ${ctx.state.prompt}`,
      `Reproduction goal: ${plan.goal}`,
      `Primary reduction move: ${workPlan.primaryHypothesis}`,
      `Backup reduction move: ${workPlan.backupHypothesis}`,
      `Success means the failure oracle still reproduces after reduction.`,
    ].join('\n\n'),
  packet: ({ plan, workPlan, evidence, final }): HephaestusPacket => ({
    protocol: 'hephaestus',
    packet: 'reproduction',
    targetFailure: plan.goal,
    reproducer: gateCommands(plan)[0] ?? 'No executable reproducer command was defined.',
    minimalArtifacts: ['target repository after accepted reduction'],
    expectedBehavior: plan.successCriteria[0] ?? 'Expected behavior was not specified.',
    actualBehavior: evidence,
    failureOracle: gateCommands(plan)[0] ?? 'No failure oracle was defined.',
    environmentRequirements: ['repository checkout', 'dependencies required by the oracle command'],
    reducedDimensions: [workPlan.primaryHypothesis],
    irreducibleDimensions: [workPlan.backupHypothesis],
    hypotheses: remainingRisks(plan),
    recommendedNextWorkflow: 'Run Ulysses against this minimized reproducer to fix the root cause.',
    minimized: final?.passed ?? false,
  }),
  desiredStateAchieved: ({ final }) => final?.passed ?? false,
};

const ariadneAdapter: CodebaseProtocolAdapter = {
  id: 'ariadne',
  title: 'Ariadne topology',
  mutatesRepo: false,
  baselineGateLabel: 'Ariadne baseline topology check',
  finalGateLabel: 'Ariadne topology confidence check',
  system: ({ plan }) =>
    [
      'You are executing the Ariadne Protocol for codebase topology discovery.',
      'Use read-only tools only. Do not modify files, create files, delete files, install dependencies, or run mutating commands.',
      'Map evidence-backed nodes, edges, contracts, unknowns, safe surfaces, and risky surfaces for the requested intervention.',
      `Decision criteria:\n- ${plan.successCriteria.join('\n- ')}`,
    ].join('\n'),
  prompt: ({ ctx, plan, workPlan }) =>
    [
      `Target intervention/question: ${ctx.state.prompt}`,
      `Topology goal: ${plan.goal}`,
      `Primary discovery move: ${workPlan.primaryHypothesis}`,
      `Backup discovery move: ${workPlan.backupHypothesis}`,
      ctx.state.research?.summary ? `Prior research: ${ctx.state.research.summary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  packet: ({ ctx, plan }): AriadnePacket => makeAriadnePacket(ctx, plan),
  desiredStateAchieved: ({ evidence }) => evidence.trim().length > 0,
};

function makeAriadnePacket(ctx: SectionContext, plan: Plan): AriadnePacket {
  const topology = scanCodebaseTopology(ctx.repoDir);
  const unknowns =
    (ctx.state.research?.unknowableBeforeWork.length ?? 0) > 0
      ? (ctx.state.research?.unknowableBeforeWork ?? [])
      : ['No unresolved topology unknowns were identified before execution.'];
  return {
    protocol: 'ariadne',
    packet: 'topology',
    targetIntervention: plan.goal,
    nodes: topology.nodes,
    edges: topology.edges,
    contracts: plan.successCriteria,
    unknowns,
    hiddenCouplings: topology.hiddenCouplings,
    safeInterventionSurfaces: topology.safeSurfaces,
    riskyInterventionSurfaces: topology.riskySurfaces,
    recommendedChecks: gateCommands(plan),
  };
}

function scanCodebaseTopology(repoDir: string): {
  readonly nodes: string[];
  readonly edges: Array<readonly [string, string]>;
  readonly hiddenCouplings: string[];
  readonly safeSurfaces: string[];
  readonly riskySurfaces: string[];
} {
  const files = listTopologyFiles(repoDir);
  const nodeSet = new Set(files);
  const edges: Array<readonly [string, string]> = [];

  for (const file of files) {
    const absolute = Path.join(repoDir, file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = safeRead(absolute);
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveImport(file, specifier, files);
      if (resolved) {
        nodeSet.add(resolved);
        edges.push([file, resolved]);
      }
    }
  }

  const nodes = [...nodeSet].sort();
  return {
    nodes,
    edges: dedupeEdges(edges),
    hiddenCouplings:
      edges.length === 0
        ? ['No static import edges were found; dynamic/runtime coupling remains possible.']
        : [],
    safeSurfaces: nodes.filter((node) => node.includes('api') || node === 'package.json'),
    riskySurfaces: nodes.filter((node) => node.includes('test') || node.includes('service')),
  };
}

function listTopologyFiles(repoDir: string): string[] {
  const result: string[] = [];
  const ignored = new Set(['.git', 'node_modules', 'dist']);
  try {
    if (!fs.statSync(repoDir).isDirectory()) return result;
  } catch {
    return result;
  }
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = Path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const relative = Path.relative(repoDir, absolute);
      if (relative === 'package.json' || /\.(?:[cm]?[jt]sx?|json|md)$/.test(relative)) {
        result.push(relative);
      }
    }
  }
  walk(repoDir);
  return result.sort();
}

function safeRead(path: string): string {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specs.push(match[1]);
    }
  }
  return specs;
}

function resolveImport(
  fromFile: string,
  specifier: string,
  files: readonly string[],
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const fromDir = Path.dirname(fromFile);
  const base = Path.normalize(Path.join(fromDir, specifier));
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.cts`,
    Path.join(base, 'index.js'),
    Path.join(base, 'index.ts'),
  ];
  return candidates.find((candidate) => files.includes(candidate));
}

function dedupeEdges(edges: Array<readonly [string, string]>): Array<readonly [string, string]> {
  const seen = new Set<string>();
  return edges.filter(([from, to]) => {
    const key = `${from}\0${to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
