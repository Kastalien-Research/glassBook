# Hermes Protocol

## Overview

The Hermes Protocol is an operational epistemic workflow (aka an "EpiOps" workflow) for extracting commitment signals from conversations. It is designed for customer discovery, sales, recruiting, fundraising, partnerships, internal alignment, advisory conversations, design-partner development, and any situation where polite language can be mistaken for real pull.

The protocol treats words as cheap until they create costly action. The goal is to distinguish enthusiasm from commitment, classify the strength of the signal, and convert every meaningful conversation into a concrete next action, disqualification, or explicit open question.

## Requirements

- There must be a conversation, transcript, call notes, email thread, meeting, interview, or planned outreach interaction to evaluate.
- The agent must know the objective of the interaction: discovery, sale, hiring, fundraising, partnership, reference, workflow access, technical validation, or another concrete aim.
- The agent must define in advance what counts as a real commitment signal.
- The agent must be able to record the exact ask made and the exact response received.
- The agent must not treat compliments, curiosity, politeness, or vague future interest as strong evidence of commitment.
- If the interaction involves external parties, the agent must respect consent, confidentiality, and appropriate data-handling constraints.

## Protocol

### Step 0: Game Board Setup

We start off by modeling the interaction as a gamespace. This gamespace has:

- "checkpoints" that correspond to snapshots of the current relationship, opportunity, or conversation state
- a counter that tracks the "state step" of the gamespace, which tracks the number of commitment-extraction moves that have been made since the most recent checkpoint. The enum of possible steps is [0, 1, 2, -1]. -1 is reserved for CONSIDERATION if the execution of state steps 1 and 2 both result in unexpected outcomes.
- "actors," or people and organizations involved in the interaction
- "claims," or statements made by the actor about pain, need, priority, authority, budget, timeline, willingness, constraints, or next steps
- "signals," or observed behaviors that indicate commitment or lack of commitment
- "asks," or explicit requests made by the agent to test commitment
- "behaviors," or commitments to conversational actions that the agent will execute at state steps 1 and 2

Defaults at the beginning:

stateStep: [0, 1, 2, -1] = 0  
behaviors: Behavior[] = []  
checkpoints: InteractionSnapshot[] = [initial relationship or conversation state]  
actors: Actor[] = []  
claims: Claim[] = []  
signals: Signal[] = []  
asks: Ask[] = []  
forbiddenBehaviors: Behavior[] = []

Each behavior is defined in two parts:

1. an action or small bundle of actions that the agent will execute to elicit, test, or confirm commitment
2. an evaluation function that determines whether the response is a real commitment signal, a weak signal, a non-signal, or a negative signal

### Step 1: Define the Commitment Ladder

The agent begins by defining what commitment means for this interaction.

The agent must write down:

- the objective of the interaction
- the actor's presumed role and authority
- the strongest realistic commitment that could be requested in this interaction
- the minimum useful commitment that would justify continued effort
- the signs that the actor is not serious, not authorized, not in pain, or not a fit
- the next action that should follow each signal class

Signal classes should be defined as follows:

- Strong signal: the actor accepts a costly next action, such as payment, signed agreement, budget allocation, data access, workflow access, technical integration, stakeholder introduction, scheduled implementation session, or time-bound procurement step.
- Medium signal: the actor accepts a concrete but lower-cost next action, such as a scheduled follow-up with a relevant stakeholder, a specific artifact request, a reference introduction, or a structured pilot discussion.
- Weak signal: the actor expresses interest but avoids cost, specificity, deadline, or ownership.
- Negative signal: the actor declines, defers indefinitely, reveals no real pain, lacks authority, refuses a reasonable next step, or repeatedly substitutes compliments for action.

### Step 2: Plot Commitment Behaviors

The gamespace starts at state step 0. The agent will plot the behaviors that will be executed at state steps 1 and 2.

The planned behavior for state step 1 corresponds to the agent's hypothesis about the best commitment-extraction move: "What direct ask should I make to test whether the actor will take a costly next step? What response will count as a strong, medium, weak, or negative signal?"

The planned behavior for state step 2 corresponds to the agent's backup commitment-extraction move: "assuming that the behavior for state step 1 produces ambiguity, avoidance, politeness, or a surprising response, what alternate ask should I make to clarify whether there is real commitment? What response will count as a strong, medium, weak, or negative signal?"

A valid commitment behavior must specify:

- the exact ask
- the reason the ask tests commitment
- the cost imposed by the ask
- the expected response types
- the signal classification rules
- the next action associated with each response type

Once the two behaviors are plotted, the agent will enter execution mode.

### Step 3: Run the Protocol

The protocol runs as follows:

a. The agent establishes a checkpoint at the current interaction state.  
b. The state step counter is incremented from 0 to 1.  
c. The agent executes the behavior associated with state step 1 by making the planned ask or analyzing whether the ask was made in an existing transcript.  
d. The agent executes the pre-determined evaluation function that classifies the response as a strong signal, medium signal, weak signal, negative signal, or unresolved signal.  
e. If the response produces a strong or medium signal, the agent logs a checkpoint, records the commitment, assigns the next action, and resets the state step counter to 0.  
f. If the response produces a weak, ambiguous, or unresolved signal, the state step counter is incremented from 1 to 2 and the agent executes the behavior associated with state step 2.  
g. The agent executes the pre-determined evaluation function for state step 2.  
h1. If the response produces a strong or medium signal, the agent logs a checkpoint, records the commitment, assigns the next action, and resets the state step counter to 0.  
h2. If the response produces a weak, negative, ambiguous, or unresolved signal, the state step counter is incremented from 2 to -1 and the agent enters CONSIDERATION mode.  
i. During CONSIDERATION, the agent hypothesizes about why both commitment behaviors failed. These behaviors, defined as the immutable set of sequential tasks that comprised the previous two state steps, are then forbidden from being executed in the same position in future turns from this checkpoint.  
j. The agent must then choose one of the following: disqualify the opportunity, reframe the problem, seek a different actor with more authority, ask for a smaller but still costly commitment, or mark the relationship as nurture-only.  
k. The agent resets the state step counter to 0.

Every time the state step counter hits 0, the agent will re-run the protocol from Step 2 while the relationship remains worth advancing and the next commitment has not been secured.

### Step 4: Emit the Commitment Ledger

When the interaction reaches a stopping point, the agent exits and emits a commitment ledger.

The commitment ledger must contain:

- the actor and organization
- the interaction objective
- the strongest claim the actor made
- the exact asks made
- the exact responses received
- the signal classification
- the commitment secured, if any
- the owner of the next action
- the deadline or scheduled time for the next action
- the disqualification reason, if applicable
- the open questions that remain

The Hermes Protocol is complete only when the conversation has been converted into an observable next action, an explicit disqualification, or a clearly labeled nurture state.
