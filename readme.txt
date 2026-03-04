# Unravel v2.Engine — AI Debugging Mentor

## Overview

**Unravel** is an experimental AI-powered debugging system designed to help people understand and fix bugs in AI-generated code. As tools like Cursor, Bolt, Lovable, and other AI coding assistants become widely used, a new type of developer is emerging: the **AI-assisted builder**, often called a **“vibe coder.”** These users can generate working applications quickly using AI but frequently struggle when something breaks because they do not fully understand the underlying code.

Unravel aims to solve this problem.

Instead of simply suggesting code fixes like most AI coding tools, Unravel focuses on **explaining what broke, why it broke, and what concept the user should learn**. The system behaves like a **debugging mentor**, reconstructing the story of the bug and guiding the user through the reasoning process.

The long-term goal is to build an AI system that behaves like a **software detective**: analyzing a codebase, tracing state changes, detecting logical inconsistencies, and presenting the root cause in a way that both developers and non-technical builders can understand.

---

# Project Motivation

AI coding tools are extremely good at **generating code**, but they are far less reliable at **debugging existing code**.

Most AI assistants today follow a simple workflow:

1. Read code
2. Guess what the bug might be
3. Suggest a fix

This approach often works for small syntax errors but fails when bugs involve:

* hidden state mutations
* timing and asynchronous behavior
* interactions between multiple functions
* environment-specific behavior
* long-running logic errors

For users who rely heavily on AI to build applications, these failures create a major bottleneck. They can generate complex systems but cannot easily diagnose why they fail.

Unravel addresses this gap by introducing **structured debugging reasoning** rather than simple code suggestions.

---

# Experimental Debugging Scenario

To test and develop the system, a deliberately flawed **Pomodoro timer application** was created. The timer was implemented using HTML, CSS, and JavaScript and included several realistic logic bugs related to time calculation and state management.

The key problems in the timer included:

* incorrect mutation of state variables
* inconsistent timer restart logic
* timing drift when switching browser tabs
* conflicting intervals when changing modes
* incorrect calculation of elapsed time

These bugs were intentionally designed to simulate the kinds of issues that frequently appear in AI-generated code.

Multiple AI agents were then asked to analyze the code and explain the issue. Their outputs were evaluated and improved iteratively.

---

# Evolution of the Debugging System

## Version 1 — Basic AI Explanation

The earliest version of the debugging output behaved like a typical AI coding assistant.

It could:

* explain the overall purpose of the code
* describe visible symptoms
* suggest a general fix

However, it often missed deeper issues such as **state mutation** or incorrect variable relationships. The system relied mostly on pattern recognition rather than structured reasoning.

This version was evaluated at roughly **6/10** for debugging quality.

---

## Version 2 — Structured Bug Reasoning

After refining prompts and system instructions, the debugging output improved significantly. The system began identifying specific logic errors such as:

```
duration = remaining
```

which caused the timer's original duration value to be overwritten during pause operations.

The AI also began analyzing relationships between key variables:

* `duration` — total session time
* `remaining` — time left
* `startTimestamp` — time reference for elapsed calculations
* `interval` — active timer process

This version introduced clearer reasoning and more targeted fixes, raising the debugging quality to approximately **8/10**.

---

# Unravel v2.Engine

The latest iteration introduces a much more structured debugging framework.

Instead of providing only explanations, the system now performs a multi-step analysis of the program.

The output includes several key components.

---

## Observed Symptom

The system begins by describing what the user experiences. For example:

* the timer skips seconds
* the countdown ends early
* behavior becomes inconsistent after pausing or switching tabs

This step ensures the debugging process begins from the **user’s perspective**.

---

## Reproduction Path

Next, the system identifies how the bug can be triggered.

Example reproduction steps include:

1. Start the timer
2. Pause and resume
3. Switch browser tabs
4. Change timer modes

This step is crucial because debugging requires **reliable reproduction of the problem**.

---

## State Mutation Tracker

One of the most important additions in Unravel v2 is the **state mutation tracker**.

The system identifies the core variables in the program and tracks where they are modified.

Example table:

| Variable            | Role                               | Mutation Location |
| ------------------- | ---------------------------------- | ----------------- |
| duration            | total mode duration                | setMode           |
| remaining           | time left                          | tick              |
| interval            | active timer ID                    | start / pause     |
| startTimestamp      | time reference                     | start             |
| lastActiveRemaining | base value for elapsed calculation | start / resume    |

Tracking variable lifetimes helps detect bugs caused by **unexpected state changes**.

---

## Execution Timeline

The system reconstructs the order of events in the program.

Example timeline:

```
t0 — timer starts
t1 — countdown updates
tX — user pauses timer
tY — timer resumes
tA — browser tab hidden
tB — tab becomes visible again
```

Timeline reconstruction helps explain **temporal bugs**, which are common in timer systems and asynchronous code.

---

## Invariant Detection

Unravel also identifies **program invariants** — conditions that must always remain true.

Examples:

* the configured session duration must remain constant
* the start timestamp must reflect the beginning of the active countdown

When these invariants are violated, bugs occur.

---

## Root Cause Identification

After analyzing state, timeline, and invariants, the system identifies the core problem.

In this case:

* `duration` was incorrectly mutated during pause
* `startTimestamp` was not always updated correctly when resuming

This led to incorrect elapsed time calculations.

---

## Minimal Fix Strategy

Rather than rewriting the entire program, Unravel proposes **minimal targeted fixes**.

Key improvements included:

* removing the mutation of `duration`
* introducing a new variable `lastActiveRemaining`
* recalculating elapsed time relative to the correct reference point

This ensures timer accuracy across pause, resume, and tab switching events.

---

# Design Philosophy

Unravel follows a simple principle:

**The AI should not guess the bug.
The system should analyze the program first.**

The debugging pipeline therefore follows this structure:

1. Code ingestion
2. Static analysis
3. State mutation tracking
4. Execution flow reconstruction
5. Bug hypothesis generation
6. AI reasoning and explanation
7. Human-readable explanation

This layered approach improves reliability and reduces hallucinated bug explanations.

---

# Future Direction

While the current system performs well on logic and state bugs, several challenges remain.

Future versions of Unravel aim to handle:

* asynchronous race conditions
* cross-file dependency bugs
* memory leaks
* framework lifecycle issues
* large multi-module projects

The ultimate goal is to build a debugging engine that can analyze complex systems and explain failures clearly to both experienced developers and AI-assisted builders.

---

# Conclusion

Unravel represents an attempt to rethink how AI assists with debugging.

Instead of acting as a code generator, it acts as a **debugging mentor** — helping users understand the internal behavior of their programs and learn from their mistakes.

As AI-generated software becomes more common, tools like Unravel could play an essential role in helping builders move from **code generation to true software understanding**.
