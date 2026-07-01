# Recursive Context

**Status:** v1 implementation note for RLM-inspired context handling in glassBook plus MCP
projection.

## Purpose

Recursive context gives glassBook an auditable way to ask bounded child questions over large
notebook/state inputs without stuffing all prior context into a single model prompt. It is inspired
by Recursive Language Models, but implemented as a native TypeScript primitive that preserves
glassBook's existing constraints: typed cells, explicit budgets, citations, and sidecar persistence.

## v1 Shape

- Context is represented by `NotebookContextRef`: a stable handle over a notebook, sidecar, or
  repo-snapshot source path plus a SHA-256 content hash.
- `askContext` accepts read-only context documents and an injected responder. The responder receives
  only a question and selected text spans; it does not receive repo tools, MCP tools, `writeFile`, or
  arbitrary code execution.
- The Research section reserves one research budget unit when available, asks one child question over
  the investigation transcript, and feeds the cited child answer into final research synthesis.
- Recursion depth is capped at `1`.
- Every successful recursive answer must cite selected context spans.
- Calls are reduced into `recursiveContextCalls` in `glassbook.json` and recorded as typed
  `research` glassBook cells by the orchestrator.

## MCP Boundary

Srcbook has a localhost/token-gated MCP HTTP endpoint. Normal `glassbook run` recursive research is
deliberately not implemented on top of the generic MCP client or the server-side `execute-code`
scratchpad. The in-process path remains the auditable runtime path.

MCP projects saved glassBook runs as context resources/tools backed by the shared pure context core:

- `list-glassbook-contexts`
- `read-glassbook-context`
- `ask-glassbook-context`
- `execute-glassbook-context`

`execute-glassbook-context` is context-bound execution: it materializes selected saved context into a
temporary scratchpad, uses a minimal environment, and must not mutate the saved notebook, sidecar, or
target repository. It is separate from the generic `execute-code` tool.

## Verification Expectations

- Unit tests must cover stable hashing, span selection, depth limits, budget exhaustion, citation
  enforcement, and the absence of write/execution/MCP tools from child requests.
- Any section integration should record both the recursive call and the resulting typed cell before
  claiming the child answer influenced a run.
- A live proof should use a throwaway target repo with `--skip-pr`, then inspect the exported
  notebook and sidecar for a `Research — Recursive Context` section plus cited
  `recursiveContextCalls`.
- MCP projection tests must prove saved contexts are path-scoped to `SRCBOOKS_DIR`, cited asks do
  not mutate sidecars, and context execution cleans up scratchpads and fails closed when disabled or
  unsandboxed.
