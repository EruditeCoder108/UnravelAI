# Unravel Architecture

## The Core Concept
Unravel reverses the typical "AI debugging loop". Most AI tools guess at fixes based on statistical symptom matching. Unravel extracts deterministic ground truth from the code *first*, then forces the AI to eliminate hypotheses using that evidence.

## Pipeline Overview

```text
Code Input
    ↓
Layer 1: Deterministic Analysis (AST Engine)
    ├─ Variable Mutation Chains
    ├─ Timing Nodes (setTimeout, Promises)
    └─ Closure Captures (Stale State)
    ↓
Layer 2: Context Scaling
    ├─ Cross-File Resolution (Imports/Exports)
    └─ Graph-Frontier Router (BFS over import graph, call graph, and mutation chains)
    ↓
Layer 3: AI Reasoning Engine (9-Phase Pipeline)
    ├─ Ingests AST evidence (Reads, Understands Intent, Understands Reality)
    ├─ Generates competing hypotheses about the root cause
    ├─ Tests them against AST evidence
    └─ Eliminates contradictions until the surviving explanation remains
    ↓
Layer 4: Verification Layer
    ├─ Claim Verifier (Checks if cited lines/files actually exist)
    └─ Anti-Sycophancy (Rejects hallucinated evidence or fabricated code references)
    ↓
Final Dynamic JSON Report
    └─ Streams progressively to Web App / VS Code Extension
```

## The Three Environments

The Unravel system operates across three linked environments sharing a single unified brain:

### 1. The Core Engine (`src/core/`)
The analytical brain. It contains zero React, browser, or VS Code dependencies. It handles the `@babel/parser` extraction, the 9-phase LLM pipeline orchestration, and the rigorous JSON parsing.

### 2. The Web App (`unravel-v3/`)
A React/Vite web application. It handles user inputs (drag-and-drop, GitHub issue fetching, repo cloning), wraps the core engine in a beautiful UI, and provides the Action Center for generating GitHub PRs.

### 3. The VS Code Extension (`unravel-vscode/`)
Brings Unravel into the IDE. Resolves local workspace imports natively, pipes data to the Core Engine, and paints the output directly onto the editor using split-pane diffs, inline overlays, and a Webview sidebar.

> **⚠️ The Sync Rule:** If you modify the Core Engine in `unravel-v3/src/core/`, you must sync the changes to `unravel-vscode/src/core/`. The Core Engine is duplicated across clients to ensure zero cross-environment dependencies.

## Key Design Principles

1. **AST First:** No LLM guessing before the ground truth is extracted.
2. **Evidence Required:** The engine cannot claim a bug without citing the exact line number and variable.
3. **Optimized for Insight:** The output is designed to make the developer instantly understand the failure, rather than just brute-forcing a fix.
