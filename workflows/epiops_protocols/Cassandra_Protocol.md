# Cassandra Protocol

## Overview

The Cassandra Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for handling seductive uncertainty before a decision or action. It is designed for moments when a story feels plausible, useful, prestigious, urgent, or emotionally satisfying, but the evidence is not yet strong enough to justify acting as if the story is true.

The protocol forces the agent to price ambiguity. It separates assumptions from evidence, identifies what would falsify the favored story, runs bounded disconfirmation attempts, and converts vague confidence into a decision with explicit risk, confidence, and review conditions.

## Requirements

- There must be a decision, proposed action, thesis, plan, interpretation, or belief under consideration.
- The agent must be able to state what would change if the claim were true or false.
- The agent must be able to identify at least one falsification attempt, disconfirming source, adversarial question, or pre-mortem scenario.
- The agent must be willing to record uncertainty explicitly rather than hiding it behind persuasive language.
- If external facts are decision-critical, the agent must inspect sources rather than relying on memory.
- If the decision is high-stakes, irreversible, legal, medical, financial, security-critical, or reputation-critical, the evidentiary threshold must be raised before action is authorized.

## Protocol

### Step 0: Game Board Setup

We start off by modeling the decision environment as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the agent's belief state at a given point in the investigation
- a counter that tracks the "state step" of the gamespace, which tracks the number of uncertainty-reduction moves that have been made since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- "favored claims," or the interpretation, plan, belief, or story currently exerting pull on the agent
- "assumptions," or premises that would need to be true for the favored claim to justify action
- "failure modes," or ways the favored claim could produce a bad outcome despite sounding plausible
- "disconfirmers," or evidence that would weaken, falsify, or materially reframe the favored claim
- "behaviors," or commitments to uncertainty-reduction actions that the agent will execute at state steps 1 and 2

Defaults at the beginning:

stateStep: [0, 1, 2, -1] = 0  
behaviors: Behavior[] = []  
checkpoints: BeliefSnapshot[] = [initial belief state]  
favoredClaims: Claim[] = []  
assumptions: Assumption[] = []  
failureModes: FailureMode[] = []  
disconfirmers: DisconfirmationTarget[] = []  
forbiddenBehaviors: Behavior[] = []

Each behavior is defined in two parts:

1. an action or small bundle of actions that the agent will execute to reduce uncertainty, preferably by trying to falsify the favored claim
2. an evaluation function that determines whether the evidence changes the decision, confidence level, or risk classification

### Step 1: Name the Seduction

The agent begins by stating the favored claim in plain language.

The agent must write down:

- the claim, plan, thesis, or interpretation under consideration
- why it is attractive
- what action it seems to authorize
- what would be costly if it were wrong
- what assumptions must hold for it to be right
- what evidence currently supports it
- what evidence is missing
- what observation would cause the agent to abandon, delay, or materially revise it

The agent then writes a pre-mortem.

The pre-mortem must answer: "Suppose this action failed badly even though it looked reasonable at the time. What were the most likely causes?"

Each pre-mortem cause becomes either an assumption, a failure mode, or a disconfirmation target.

### Step 2: Plot Disconfirmation Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2.

The planned behavior for state step 1 corresponds to the agent's hypothesis about the most efficient disconfirmation attempt: "What action or small bundle of actions should I execute to attack the most load-bearing assumption? What evidence would cause me to lower confidence, change the plan, or stop?"

The planned behavior for state step 2 corresponds to the agent's backup disconfirmation attempt: "assuming that the behavior for state step 1 does not produce decisive evidence, what alternate action or small bundle of actions should I execute to attack the next most load-bearing assumption or failure mode? What evidence would cause me to lower confidence, change the plan, or stop?"

A valid disconfirmation behavior must specify:

- the assumption or failure mode it targets
- the source, test, interview, calculation, search, simulation, or adversarial review it will use
- the expected evidence artifact
- the threshold for changing confidence
- the threshold for changing action

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 3: Run the Protocol

The protocol runs as follows:

a. The agent establishes a checkpoint at the current belief state.  
b. The state step counter is incremented from 0 to 1.  
c. The agent executes the behavior associated with state step 1.  
d. The agent executes the pre-determined evaluation function that determines whether the evidence changes the claim, confidence level, risk classification, or proposed action.  
e. If the evidence decisively confirms a required premise, falsifies a required premise, or materially changes the decision, the agent logs a checkpoint, updates the belief state, and resets the state step counter to 0.  
f. If the evidence is inconclusive, unavailable, or weaker than expected, the state step counter is incremented from 1 to 2 and the agent executes the behavior associated with state step 2.  
g. The agent executes the pre-determined evaluation function for state step 2.  
h1. If the evidence decisively confirms a required premise, falsifies a required premise, or materially changes the decision, the agent logs a checkpoint, updates the belief state, and resets the state step counter to 0.  
h2. If the evidence remains inconclusive, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.  
i. During CONSIDERATION, the agent hypothesizes about why both uncertainty-reduction behaviors failed. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.  
j. The agent must then narrow the claim, raise the uncertainty label, change the decision threshold, seek a different evidence class, or recommend a reversible probe instead of full commitment.  
k. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 2 while the decision remains unresolved and additional uncertainty reduction is worth the cost.

### Step 4: Emit the Cassandra Decision Record

When the uncertainty-reduction process reaches a stop condition, the agent exits and emits a decision record.

The decision record must contain:

- the favored claim or plan
- the original seduction
- the assumptions that survived inspection
- the assumptions that failed inspection
- the remaining unknowns
- the major failure modes
- the evidence gathered
- the decision: proceed, proceed with constraints, run a reversible probe, delay, reject, or escalate
- the confidence level
- the tripwires that should trigger revision
- the date, event, or observation that should trigger post-decision review

The Cassandra Protocol does not aim to eliminate uncertainty. It aims to prevent unpriced uncertainty from masquerading as justified confidence.
