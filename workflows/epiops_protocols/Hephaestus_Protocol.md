# Hephaestus Protocol

## Overview

The Hephaestus Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for forging a minimal reproducible case. It is designed for bugs, failures, anomalies, regressions, integration errors, data issues, or operational incidents where the current problem is too large, noisy, or entangled to reason about directly.

The protocol treats the failure as raw metal that must be heated, hammered, and reduced until only the essential failing shape remains. The goal is to produce the smallest deterministic artifact that still exhibits the target failure and can be used for debugging, handoff, regression testing, or root-cause analysis.

## Requirements

- There must be a target failure, anomaly, regression, or observed behavior to reproduce.
- The agent must be able to define a failure oracle: an executable command, test, query, assertion, script, input-output comparison, log pattern, or manual check that determines whether the failure is present.
- If the target is a codebase, it should be a Git repository and should have a linked remote repository on GitHub.
- The agent must be able to isolate or copy relevant inputs without corrupting the original system.
- The agent must be able to distinguish between "the failure disappeared" and "the evaluator stopped detecting the failure."
- The agent must preserve enough environmental information for another operator or agent to reproduce the failure.

## Protocol

### Step 0: Game Board Setup

We start off by modeling the failure environment as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the current reproducible case
- a counter that tracks the "state step" of the gamespace, which tracks the number of reduction moves that have been made since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- a "failure oracle," or deterministic evaluation that determines whether the target failure is present
- "dimensions," or possible sources of complexity that can be reduced: files, dependencies, inputs, state, timing, network calls, environment variables, database rows, feature flags, concurrency, mocks, fixtures, or configuration
- "artifacts," or files, scripts, commands, fixtures, logs, screenshots, traces, or datasets needed to reproduce the failure
- "behaviors," or commitments to reduction actions that the agent will execute at state steps 1 and 2

Defaults at the beginning:

stateStep: [0, 1, 2, -1] = 0  
behaviors: Behavior[] = []  
checkpoints: ReproSnapshot[] = [initial failing case]  
failureOracle: Evaluator | null = null  
dimensions: Dimension[] = []  
artifacts: Artifact[] = []  
forbiddenBehaviors: Behavior[] = []

Each behavior is defined in two parts:

1. an action or small bundle of actions that removes, substitutes, freezes, mocks, or isolates a source of complexity
2. some code, command, query, or deterministic evaluation criterion that will be executed to evaluate whether the target failure still reproduces

### Step 1: Capture the Failure Oracle

The agent begins by capturing the failure before reducing anything.

The agent must write down:

- the exact command, interaction, query, request, input, or sequence that produces the failure
- the expected behavior
- the actual behavior
- the observed error, output, trace, log, screenshot, or anomaly
- the environment in which the failure occurs
- whether the failure is deterministic, intermittent, timing-sensitive, state-sensitive, or environment-sensitive
- the smallest currently known artifact that reproduces the failure

The agent then executes the failure oracle against the initial case.

If the failure oracle does not detect the target failure at the beginning, the agent must not proceed to reduction. It must first repair the oracle or re-capture the failure.

### Step 2: Plot Reduction Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2.

The planned behavior for state step 1 corresponds to the agent's hypothesis about the next best reduction move: "What action or small bundle of actions should I execute to remove the most complexity while preserving the failure? What evaluator will prove that the failure still reproduces?"

The planned behavior for state step 2 corresponds to the agent's backup reduction move: "assuming that the behavior for state step 1 removes the failure, invalidates the oracle, or produces an unexpected outcome, what alternate smaller or orthogonal reduction should I execute? What evaluator will prove that the failure still reproduces?"

A valid reduction behavior must specify:

- the dimension of complexity being reduced
- the expected size or complexity decrease
- the failure oracle that will be run after the reduction
- the condition under which the reduction is accepted
- the condition under which the reduction is rejected or reverted

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 3: Run the Protocol

The protocol runs as follows:

a. The agent establishes a checkpoint at the current reproducible case. If the target is a codebase, this checkpoint should be a commit hash or a saved patch.  
b. The state step counter is incremented from 0 to 1.  
c. The agent executes the behavior associated with state step 1.  
d. The agent executes the pre-determined failure oracle.  
e. If the failure still reproduces and the case has become smaller or more controlled, the agent logs a checkpoint, promotes the reduced case, and resets the state step counter to 0.  
f. If the failure does not reproduce, the oracle becomes invalid, or the behavior does not reduce complexity, the agent reverts to the previous checkpoint. The state step counter is incremented from 1 to 2, and the agent executes the behavior associated with state step 2.  
g. The agent executes the pre-determined failure oracle for state step 2.  
h1. If the failure still reproduces and the case has become smaller or more controlled, the agent logs a checkpoint, promotes the reduced case, and resets the state step counter to 0.  
h2. If the failure does not reproduce, the oracle becomes invalid, or the behavior does not reduce complexity, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.  
i. During CONSIDERATION, the agent hypothesizes about why both reduction behaviors failed. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.  
j. The agent must then choose one of the following: split the failure into sub-failures, strengthen the oracle, freeze an environmental variable, collect a new trace, introduce a mock, or declare the current case irreducible under the available constraints.  
k. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 2 while the case can still be made smaller without losing the target failure.

### Step 4: Emit the Reproduction Packet

When the case is minimal enough or no further reduction is possible, the agent exits and emits a reproduction packet.

The reproduction packet must contain:

- the target failure
- the exact reproduction command or interaction
- the minimal required artifacts
- the expected behavior
- the actual behavior
- the failure oracle
- the environmental requirements
- the dimensions that were successfully reduced
- the dimensions that could not be reduced
- any hypotheses suggested by the reduction path
- the recommended next debugging workflow

The Hephaestus Protocol is complete only when another operator or agent can reproduce the failure without relying on the original investigator's unstated context.
