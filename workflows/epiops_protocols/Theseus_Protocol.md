# Theseus Protocol

## Overview

The Theseus Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for transforming a system while preserving its identity. It is designed for refactors, migrations, rewrites, schema changes, dependency upgrades, API transitions, infrastructure moves, or process redesigns where the internal structure may change but the important external commitments must remain intact.

The protocol treats the system as a ship whose parts can be replaced only if its invariants survive each replacement. The goal is not to make a large change and hope the system still works. The goal is to define identity-preserving invariants, transform the system in small steps, and use evaluators to prove after each step that the system is still the same system in the ways that matter.

## Requirements

- The target system must have a stable baseline before transformation begins.
- If the target system is a codebase, it must be a Git repository and should have a linked remote repository on GitHub.
- The agent must be able to define the invariants that constitute the system's preserved identity.
- The agent must be able to run or construct evaluators for those invariants. These may be tests, type checks, integration checks, golden output comparisons, schema checks, API contract checks, performance checks, or manual acceptance criteria.
- The transformation must be decomposable into small state-changing moves.
- The agent must be able to roll back to the most recent checkpoint if an invariant fails.

## Protocol

### Step 0: Game Board Setup

We start off by modeling the target system as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the system before and after successful identity-preserving transformations
- a counter that tracks the "state step" of the gamespace, which tracks the number of transformation moves that have been made since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- "invariants," or commitments that define what must remain true for the transformed system to count as the same system in the relevant way
- "evaluators," or executable checks that determine whether invariants still hold
- "transformation slices," or the smallest safe units of change
- "behaviors," or commitments to transformation actions that the agent will execute at state steps 1 and 2

Defaults at the beginning:

stateStep: [0, 1, 2, -1] = 0  
behaviors: Behavior[] = []  
checkpoints: Hash[] = [HEAD commit hash, or current system snapshot]  
invariants: Invariant[] = []  
evaluators: Evaluator[] = []  
transformationSlices: TransformationSlice[] = []  
forbiddenBehaviors: Behavior[] = []

Each behavior is defined in two parts:

1. an action or small bundle of actions that changes the system while intending to preserve the invariants
2. some code, command, query, or deterministic evaluation criterion that will be executed to evaluate whether the invariants still hold

### Step 1: Establish Preserved Identity

The agent begins by defining what must remain true across the transformation.

The agent must write down:

- the transformation objective
- the external behaviors that must remain unchanged
- the API contracts, schemas, outputs, permissions, workflows, or business rules that must remain unchanged
- the acceptable dimensions of change
- the unacceptable dimensions of change
- the baseline evaluator suite
- the stop condition for the transformation

The agent then runs the baseline evaluators before making any change. If the baseline is already failing, the agent must record the failure explicitly. The protocol cannot treat a failing baseline as a successful invariant check unless the failure is marked as known and outside the transformation's preservation boundary.

### Step 2: Plot Transformation Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2.

The planned behavior for state step 1 corresponds to the agent's hypothesis about the next best identity-preserving transformation: "What small change should I make to move toward the transformation objective while preserving the invariants? What evaluator will prove that the system's preserved identity survived?"

The planned behavior for state step 2 corresponds to the agent's backup transformation: "assuming that the behavior for state step 1 fails an invariant or produces an unexpected result, what smaller, safer, or differently ordered change should I make to move toward the same objective? What evaluator will prove that the system's preserved identity survived?"

A valid transformation behavior must specify:

- the target transformation slice
- the files, services, records, schemas, workflows, or contracts it will affect
- the invariants that could be threatened
- the evaluator suite that will be run after the change
- the rollback condition

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 3: Run the Protocol

The protocol runs as follows:

a. The agent opens a new working branch or establishes an equivalent reversible workspace.  
b. The agent establishes a checkpoint at the current state step. On the first loop, this checkpoint will be the current commit hash or baseline snapshot at the start of work.  
c. The state step counter is incremented from 0 to 1.  
d. The agent executes the behavior associated with state step 1.  
e. The agent executes the pre-determined evaluator suite that will determine whether the preserved invariants still hold.  
f. If the invariants hold, the agent logs a checkpoint, resets the state step counter to 0, and promotes the transformation slice as complete.  
g. If any invariant fails or an unexpected behavior appears, the agent rolls back to the previous checkpoint unless the failure is explicitly part of a safe exploratory branch. The state step counter is incremented from 1 to 2, and the agent executes the behavior associated with state step 2.  
h. The agent executes the pre-determined evaluator suite for state step 2.  
i1. If the invariants hold, the agent logs a checkpoint, resets the state step counter to 0, and promotes the alternate transformation slice as complete.  
i2. If the invariants do not hold, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.  
j. During CONSIDERATION, the agent hypothesizes about why both transformation behaviors failed. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.  
k. The agent must then decompose the transformation slice, introduce an adapter or compatibility shim, improve the evaluator suite, revise the invariant definition, or reject the transformation path.  
l. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 2 while the transformation objective remains unresolved.

### Step 4: Run the Equivalence Gate

When the transformation appears complete, the agent runs the full equivalence gate.

The equivalence gate must include:

- all baseline evaluators
- all new evaluators introduced during the protocol
- any relevant backward-compatibility checks
- any migration or rollback checks
- any observable output comparisons required by the preserved identity definition

If the equivalence gate passes, the agent exits and emits a transformation packet.

The transformation packet must contain:

- the transformation objective
- the preserved invariants
- the accepted dimensions of change
- the final diff or change summary
- the evaluator suite and results
- the rollback plan
- the remaining risks
- the recommended PR, deployment, or release sequence

If the equivalence gate fails, the agent must return to Step 2 or abort the transformation with an explicit explanation.
