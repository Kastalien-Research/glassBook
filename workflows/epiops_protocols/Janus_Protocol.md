# Janus Protocol

## Overview

The Janus Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for planning actions through the lens of reversibility. It is designed for deployments, migrations, launches, pricing changes, emails, public announcements, data mutations, hiring decisions, vendor commitments, experiments, security changes, and any action where the agent must understand what can and cannot be undone.

The protocol forces the agent to look in both directions before acting: forward to the intended effect and backward to rollback, containment, repair, and residual damage. The goal is to classify reversibility, reduce blast radius, define tripwires, and execute only when the action has an adequate rollback or mitigation plan for its risk class.

## Requirements

- There must be a proposed action or sequence of actions.
- The agent must be able to identify the surfaces affected by the action.
- The agent must be able to classify the action as reversible, costly-but-reversible, partially reversible, or irreversible.
- The agent must be able to define checkpoints before execution.
- The agent must be able to define tripwires that indicate when rollback, containment, or escalation is required.
- If the action is irreversible or high-blast-radius, the agent must either obtain appropriate authorization or decompose the action into smaller reversible probes.

## Protocol

### Step 0: Game Board Setup

We start off by modeling the proposed action as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the system, relationship, data, decision state, or operational context before and after action
- a counter that tracks the "state step" of the gamespace, which tracks the number of execution or rollback-planning moves that have been made since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- "surfaces," or components, users, customers, files, services, databases, contracts, reputational assets, relationships, accounts, or processes that the action could affect
- "reversibility classes," or labels describing how completely the action can be undone
- "tripwires," or observations that trigger rollback, containment, escalation, or pause
- "rollback behaviors," or pre-planned actions that restore, compensate, contain, or mitigate damage
- "behaviors," or commitments to execution actions that the agent will execute at state steps 1 and 2

Defaults at the beginning:

stateStep: [0, 1, 2, -1] = 0  
behaviors: Behavior[] = []  
checkpoints: ActionSnapshot[] = [pre-action state]  
surfaces: Surface[] = []  
reversibilityClasses: ReversibilityClass[] = []  
tripwires: Tripwire[] = []  
rollbackBehaviors: RollbackBehavior[] = []  
forbiddenBehaviors: Behavior[] = []

Each behavior is defined in two parts:

1. an action or small bundle of actions that the agent will execute to move toward the intended outcome while respecting the reversibility plan
2. some code, command, query, observation, or deterministic evaluation criterion that will be executed to determine whether to continue, rollback, contain, or pause

### Step 1: Classify Reversibility

The agent begins by decomposing the proposed action into smaller action slices.

For each action slice, the agent must write down:

- the intended outcome
- the affected surfaces
- the expected blast radius
- the reversibility class
- the rollback method
- the rollback time cost
- the residual damage after rollback
- the owner authorized to proceed
- the owner authorized to rollback

Reversibility classes should be defined as follows:

- Reversible: the previous state can be restored quickly and with negligible residual damage.
- Costly-but-reversible: the previous state can be restored, but rollback consumes meaningful time, money, trust, data repair, or operational effort.
- Partially reversible: some effects can be undone, but some residual damage remains.
- Irreversible: the action cannot be meaningfully undone once taken.

If an action slice is partially reversible or irreversible, the agent must attempt to replace it with a smaller reversible probe unless the irreversible action is explicitly required and authorized.

### Step 2: Define Checkpoints and Tripwires

Before executing any action slice, the agent defines the checkpoint and tripwire structure.

The agent must write down:

- the pre-action checkpoint
- the post-action success condition
- the leading indicators of failure
- the hard rollback triggers
- the containment actions if rollback is incomplete
- the escalation path
- the maximum acceptable blast radius
- the observation window after execution

A valid tripwire must be observable. "Things seem bad" is not a tripwire. A valid tripwire names the metric, event, response, error, deadline, actor behavior, or external signal that causes the protocol to pause or rollback.

### Step 3: Plot Execution Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2.

The planned behavior for state step 1 corresponds to the agent's hypothesis about the safest forward move: "What action or small bundle of actions should I execute to create the intended outcome with the smallest acceptable blast radius? What evaluator will determine whether to continue, rollback, contain, or pause?"

The planned behavior for state step 2 corresponds to the agent's backup move: "assuming that the behavior for state step 1 produces an unexpected result or hits a tripwire, what rollback, containment, smaller probe, or alternate execution path should I execute? What evaluator will determine whether the state has been restored or stabilized?"

A valid execution behavior must specify:

- the action slice
- the reversibility class
- the surfaces affected
- the checkpoint created before execution
- the evaluator to run after execution
- the tripwires that will be monitored
- the rollback or containment behavior that will be used if the evaluator fails

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 4: Run the Protocol

The protocol runs as follows:

a. The agent establishes a checkpoint at the current pre-action state.  
b. The state step counter is incremented from 0 to 1.  
c. The agent executes the behavior associated with state step 1.  
d. The agent executes the pre-determined evaluator and monitors the defined tripwires.  
e. If the evaluator passes and no tripwire is hit, the agent logs a checkpoint, records the observed outcome, and resets the state step counter to 0.  
f. If the evaluator fails or a tripwire is hit, the state step counter is incremented from 1 to 2 and the agent executes the behavior associated with state step 2. This behavior should usually be rollback, containment, or a smaller probe rather than another equally risky forward action.  
g. The agent executes the pre-determined evaluator that determines whether the state has been restored, stabilized, or made safe enough to continue.  
h1. If the state has been restored or stabilized, the agent logs a checkpoint, records the rollback or containment outcome, and resets the state step counter to 0.  
h2. If the state has not been restored or stabilized, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.  
i. During CONSIDERATION, the agent hypothesizes about why the execution and backup behaviors failed. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.  
j. The agent must then escalate, freeze further forward action, widen containment, seek authorization, or abort the original action plan.  
k. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 3 while the original action remains worth pursuing and the next action slice has an adequate reversibility plan.

### Step 5: Emit the Janus Action Record

When the action sequence completes, is aborted, or is escalated, the agent exits and emits an action record.

The action record must contain:

- the proposed action
- the action slices executed
- the reversibility class of each slice
- the affected surfaces
- the checkpoints created
- the evaluators used
- the tripwires monitored
- the rollback or containment actions taken
- the residual risks
- the final state: completed, rolled back, contained, aborted, or escalated
- the post-action review condition

The Janus Protocol is complete only when forward action and backward recovery have both been made explicit.
