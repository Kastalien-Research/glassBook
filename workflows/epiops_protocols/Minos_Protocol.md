# Minos Protocol

## Overview

The Minos Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for adjudicating conflicting claims and selecting a source of truth. It is designed for situations where multiple documents, systems, people, logs, metrics, specifications, memories, dashboards, or model outputs disagree and action requires knowing which claim should govern.

The protocol treats evidence as testimony before a tribunal. The goal is not to average the claims. The goal is to define the disputed question, rank admissible sources by authority and directness, reconcile contradictions where possible, and emit a verdict that downstream agents can safely use.

## Requirements

- There must be at least one disputed question or conflicting claim.
- The agent must be able to identify the candidate claims that are in conflict.
- The agent must be able to inspect or request the relevant source material.
- The agent must define criteria for source authority before choosing a winner.
- The agent must distinguish between authoritative evidence, indirect evidence, stale evidence, hearsay, inference, and speculation.
- If the dispute concerns live or time-sensitive facts, the agent must verify recency before issuing a verdict.

## Protocol

### Step 0: Game Board Setup

We start off by modeling the dispute as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the current adjudication state
- a counter that tracks the "state step" of the gamespace, which tracks the number of adjudication moves that have been made since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- "claims," or candidate answers to the disputed question
- "sources," or documents, systems, people, records, logs, metrics, APIs, specifications, or observations that support or contradict claims
- "authority rules," or criteria that determine which source should govern when sources conflict
- "verdicts," or accepted, rejected, unresolved, or conditional judgments about claims
- "behaviors," or commitments to adjudication actions that the agent will execute at state steps 1 and 2

Defaults at the beginning:

stateStep: [0, 1, 2, -1] = 0  
behaviors: Behavior[] = []  
checkpoints: AdjudicationSnapshot[] = [initial dispute statement]  
claims: Claim[] = []  
sources: Source[] = []  
authorityRules: AuthorityRule[] = []  
verdicts: Verdict[] = []  
forbiddenBehaviors: Behavior[] = []

Each behavior is defined in two parts:

1. an action or small bundle of actions that the agent will execute to inspect, retrieve, compare, or validate evidence
2. an evaluation function that determines whether the evidence is admissible and whether it changes the verdict

### Step 1: Frame the Dispute

The agent begins by stating the disputed question in a form that can receive a verdict.

The agent must write down:

- the exact question being adjudicated
- the candidate claims
- who or what asserts each claim
- why the dispute matters
- what action will depend on the verdict
- what would happen if the wrong claim were accepted
- the time horizon of the verdict

The agent must then separate claims from evidence. A claim is what is being asserted. Evidence is what makes the claim more or less likely to be true or authoritative.

### Step 2: Establish Authority Rules

Before inspecting additional evidence, the agent defines the source hierarchy.

Authority rules should consider:

- directness: whether the source directly records the fact or only comments on it
- authority: whether the source is the canonical owner of the fact
- recency: whether the source is current for the relevant time horizon
- specificity: whether the source addresses the exact dispute or a nearby issue
- auditability: whether the source has a trace, timestamp, owner, or reproducible path
- conflict incentives: whether the source has reason to distort, omit, or simplify
- operational relevance: whether downstream systems or people actually use the source as governing authority

The agent must record the authority rules before rendering a verdict. If the authority rules are changed later, the change must be logged as a checkpointed revision.

### Step 3: Plot Adjudication Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2.

The planned behavior for state step 1 corresponds to the agent's hypothesis about the strongest evidence-retrieval move: "What action or small bundle of actions should I execute to inspect the most authoritative source for the disputed question? What evaluator will determine whether the evidence is admissible and verdict-changing?"

The planned behavior for state step 2 corresponds to the agent's backup adjudication move: "assuming that the behavior for state step 1 does not produce decisive evidence, what alternate action or small bundle of actions should I execute to inspect an independent, more recent, more direct, or more operationally authoritative source? What evaluator will determine whether the evidence is admissible and verdict-changing?"

A valid adjudication behavior must specify:

- the claim or conflict it targets
- the source or source class it will inspect
- the authority rule that makes the source relevant
- the admissibility test
- the verdict update that will occur if the evidence is decisive

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 4: Run the Protocol

The protocol runs as follows:

a. The agent establishes a checkpoint at the current adjudication state.  
b. The state step counter is incremented from 0 to 1.  
c. The agent executes the behavior associated with state step 1.  
d. The agent executes the pre-determined evaluation function that determines whether the evidence is admissible and verdict-changing.  
e. If the evidence is admissible and verdict-changing, the agent updates the verdict, logs the source, records a checkpoint, and resets the state step counter to 0.  
f. If the evidence is unavailable, inadmissible, stale, indirect, or not verdict-changing, the state step counter is incremented from 1 to 2 and the agent executes the behavior associated with state step 2.  
g. The agent executes the pre-determined evaluation function for state step 2.  
h1. If the evidence is admissible and verdict-changing, the agent updates the verdict, logs the source, records a checkpoint, and resets the state step counter to 0.  
h2. If the evidence is unavailable, inadmissible, stale, indirect, or not verdict-changing, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.  
i. During CONSIDERATION, the agent hypothesizes about why both adjudication behaviors failed. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.  
j. The agent must then revise the disputed question, change the source class, escalate to a human or canonical owner, issue a conditional verdict, or mark the dispute as unresolved.  
k. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 3 while a verdict remains necessary and available evidence has not been exhausted.

### Step 5: Emit the Tribunal Record

When the dispute is resolved or declared unresolved, the agent exits and emits a tribunal record.

The tribunal record must contain:

- the disputed question
- the candidate claims
- the authority rules
- the evidence inspected
- the evidence rejected as inadmissible or insufficient
- the final verdict: accepted, rejected, unresolved, or conditional
- the confidence level
- the time horizon for which the verdict is valid
- the source of truth that downstream agents should use
- the conditions that would reopen the dispute

The Minos Protocol is complete only when downstream action can cite a specific verdict rather than inheriting an unresolved contradiction.
