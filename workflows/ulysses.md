# Ulysses Protocol 

## Overview

The Ulysses Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for finding the root cause of a problem in a static codebase (that is, a codebase that is not subject to changes during the process from any agents other than the one executing the Ulysses Protocol) and then fixing the problem. It is designed as a loop that, if executed over and over again, will eventually lead to the identity of the root cause of the problem and its fix.

## Requirements

- The codebase must be a Git repository and have a linked remote repository on GitHub. This can be a private repository or a public repository.
- The codebase must be a static codebase, that is, a codebase that is not subject to changes during the process from any agents other than the one executing the Ulysses Protocol.

## Protocol 

### Step 0: Game Board Setup 

We start off by modeling the codebase as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the game state (i.e. Git commits)
- counter that tracks the "state step" of the gamespace, which tracks the number of changes that have been made to the codebase since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- "behaviors," or commitments to actions (that is, changes to the game state) that the agent will execute at state steps 1 and 2.

Defaults at the beginning: 

stateStep: [0, 1, 2, -1] = 0
behaviors: Behavior[] = []
checkpoints: Hash[] = [HEAD commit hash]

Each behavior is defined in two parts:

1. an action or small bundle of actions that the agent will execute to achieve the desired outcome
2. some code that will be executed to evaluate whether the desired outcome has been achieved or not.

### Step 1: Plot Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2. 

The planned behavior for state step 1 corresponds to the agent's hypothesis about the next best action to take to arrive at the information it needs to resolve the problem (that is, a root cause). "What action or small bundle of actions should I execute to arrive at I wanted/expected from this turn? What code can I execute to evaluate whether I have arrived at the desired outcome?"

The planned behavior for state step 2 corresponds to the agent's backup plan: "assuming that the behavior for state step 1 produces an outcome that I do not expect, what action or small bundle of actions should I execute to arrive at or near the outcome I wanted/expected from this turn? What code can I execute to evaluate whether I have arrived at or near the desired outcome?"

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 2: Run the Protocol

The protocol runs as follows:

a. Open a new git branch.
b. The agent establishes a checkpoint at the current state step a. On the first loop, this checkpoint will be the current commit hash at the start of work.
c. A new git branch is created from the checkpoint (that is, from the working branch created in step 0) and the state step counter is incremented from 0 to 1.
d. The agent executes the behavior associated with state step 1.
e. The agent executes the pre-determined code that will be used to evaluate whether the expected outcome has been achieved or not.
f. If the expected outcome has been achieved, the agent logs a checkpoint and the state step counter resets to 0, thus marking a single successful turn. The git branch is merged into the main branch.
g. If the expected outcome has not been achieved, the state step counter is incremented from 1 to 2 and the agent executes the behavior associated with state step 2.
h. The agent executes the pre-determined code that will be used to evaluate whether the desired outcome has been achieved or not.
i1. If the desired outcome has been achieved, the agent logs a checkpoint and the state step counter resets to 0, thus marking a single successful turn.
i2. If the desired outcome has not been achieved, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.
j. During CONSIDERATION, the agent hypothesizes about why the two previous behaviors did not achieve the expected result. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.
k. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 1, but the working branch created in Step 2a will be used instead of a new git branch while the instructions in the initial prompt remain unresolved. Pre-determined code is executed to evaluate whether the desired outcome has been achieved or not.

When the instruction in the initial prompt is resolved, the agent will stop running the protocol and exit. The agent will then open a PR on GitHub to merge the working branch into the main branch.