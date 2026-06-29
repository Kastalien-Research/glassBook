# Ariadne Protocol

## Overview

The Ariadne Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for discovering the topology of a system before intervening on it. It is designed for situations where the cost of acting too early is high because the relevant dependencies, interfaces, contracts, data flows, or hidden couplings are not yet understood.

The protocol treats the target system as a graph. The goal is to transform vague familiarity into an evidence-backed topology map: what the important components are, how they connect, what contracts they rely on, where the unknowns remain, and which intervention surfaces are safe or unsafe.

## Requirements

- The target system must have a stable inspection surface during the protocol. For a codebase, this means the codebase is static and not subject to changes during the process from agents other than the one executing the Ariadne Protocol.
- If the target system is a codebase, it should be a Git repository. If possible, it should have a linked remote repository on GitHub.
- The agent must be able to inspect the relevant source material: code, documentation, configuration, logs, schemas, API definitions, runbooks, dashboards, transcripts, or other system records.
- The agent must have a target question or intervention class. Ariadne is not for reading everything. It is for mapping the minimum topology required to make a later intervention safe.
- The agent must be able to attach evidence to topology claims. Unsupported guesses must be recorded as unknowns, not promoted into the topology map.

## Protocol

### Step 0: Game Board Setup

We start off by modeling the target system as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the known topology at a given point in the investigation
- a counter that tracks the "state step" of the gamespace, which tracks the number of discovery moves that have been made since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- "nodes," or entities in the system: files, modules, services, tables, queues, jobs, APIs, workflows, people, teams, documents, or decision points
- "edges," or dependency relationships between nodes: calls, imports, data movement, ownership, control flow, deployment coupling, contractual assumptions, or operational handoffs
- "contracts," or expectations that must hold across edges: schemas, API shapes, auth assumptions, invariants, permissions, latency budgets, ordering guarantees, business rules, or social commitments
- "unknowns," or unresolved topology questions that matter for the target intervention
- "behaviors," or commitments to discovery actions that the agent will execute at state steps 1 and 2

Defaults at the beginning:

stateStep: [0, 1, 2, -1] = 0  
behaviors: Behavior[] = []  
checkpoints: TopologySnapshot[] = [initial empty topology map]  
nodes: Node[] = []  
edges: Edge[] = []  
contracts: Contract[] = []  
unknowns: Unknown[] = []  
forbiddenBehaviors: Behavior[] = []

Each behavior is defined in two parts:

1. an action or small bundle of actions that the agent will execute to discover a specific piece of topology
2. an evaluation function that determines whether the action produced evidence strong enough to update the topology map

### Step 1: Define the Mapping Boundary

The agent begins by defining the target intervention or question that makes topology discovery necessary.

The agent must write down:

- the intervention or decision the topology map is meant to support
- the components that are already known to be in scope
- the components that are explicitly out of scope unless evidence pulls them in
- the expected form of the final topology map
- the minimum confidence threshold required before intervention is allowed
- the expected stop condition for topology discovery

The agent then identifies the first frontier of unknowns. A frontier unknown is a question whose answer could change the safe intervention surface.

Examples:

- "Which service owns writes to this table?"
- "Which tests exercise this behavior?"
- "Which API clients depend on this response shape?"
- "Which scheduled jobs mutate this state?"
- "Which team or process consumes this artifact after it is produced?"

### Step 2: Plot Discovery Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2.

The planned behavior for state step 1 corresponds to the agent's hypothesis about the next best discovery move: "What action or small bundle of actions should I execute to discover the most decision-relevant unknown? What evidence would prove that the topology map should be updated?"

The planned behavior for state step 2 corresponds to the agent's backup discovery move: "assuming that the behavior for state step 1 does not produce the expected topology evidence, what alternate action or small bundle of actions should I execute to discover the same fact or a nearby fact? What evidence would prove that the topology map should be updated?"

A valid discovery behavior must specify:

- the unknown it targets
- the files, systems, people, or records it will inspect
- the expected evidence artifact
- the topology update that will be made if the evidence is found
- the evaluation function that determines whether the evidence is strong enough

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 3: Run the Protocol

The protocol runs as follows:

a. The agent establishes a checkpoint at the current topology state. On the first loop, this checkpoint will be the empty or seed topology map created in Step 0.  
b. If the target system is a Git repository and notes will be written into the repository, the agent opens a new working branch for Ariadne artifacts. If no repository write is needed, the agent maintains an external topology log.  
c. The state step counter is incremented from 0 to 1.  
d. The agent executes the behavior associated with state step 1.  
e. The agent executes the pre-determined evaluation function that determines whether the expected topology evidence has been found.  
f. If the expected evidence has been found, the agent updates the topology map, logs the evidence, records a checkpoint, and resets the state step counter to 0.  
g. If the expected evidence has not been found, the state step counter is incremented from 1 to 2 and the agent executes the behavior associated with state step 2.  
h. The agent executes the pre-determined evaluation function that determines whether the alternate discovery move produced usable topology evidence.  
i1. If usable topology evidence has been found, the agent updates the topology map, logs the evidence, records a checkpoint, and resets the state step counter to 0.  
i2. If usable topology evidence has not been found, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.  
j. During CONSIDERATION, the agent hypothesizes about why the two previous discovery behaviors failed. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.  
k. The agent either decomposes the unknown into smaller unknowns, changes the source class being inspected, widens or narrows the boundary, or marks the unknown as unresolved with an explicit consequence.  
l. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 2 while the target intervention remains insufficiently mapped.

### Step 4: Emit the Topology Packet

When the stop condition is met, the agent exits and emits a topology packet.

The topology packet must contain:

- the target intervention or decision
- the final topology map
- the evidence-backed nodes
- the evidence-backed edges
- the known contracts and invariants
- the remaining unknowns
- the suspected hidden couplings
- the safest intervention surfaces
- the riskiest intervention surfaces
- the recommended verification commands, tests, interviews, or source checks for the next workflow

The Ariadne Protocol does not authorize intervention by itself. It authorizes either a later intervention workflow or a decision not to intervene.
