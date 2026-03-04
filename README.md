# UNRAVEL v3 — Deterministic Debug Engine

> AI Code Generation = solved. AI Code Understanding = unsolved. **Unravel solves understanding.**

Unravel is not another AI wrapper. It's a **structured debugging pipeline** that systematically analyzes buggy code through 8 deterministic phases — from ingestion to root cause to concept extraction — and teaches you **why** the bug exists, not just how to fix it.

## What Makes It Different

| Feature | ChatGPT / Copilot | **Unravel** |
|---------|-------------------|-------------|
| Bug analysis | Pattern match → guess | 8-phase deterministic pipeline |
| Context Window | Full files (hallucination risk) | **Function-level slices** via AST parsing |
| "Sycophancy" | Often invents bugs to please user | **Anti-Sycophancy guards** (evidence or reject) |
| Confidence | "I think..." | Evidence-backed with verified/uncertain split |
| Teaching | Fix the code | Teach the **concept** behind the bug |
| AI Loop Analysis | N/A | Explains **why AI tools keep failing** on this bug |
| Bug Classification | Free text | Formal 12-category taxonomy |

## Core Architecture

```
User Code + Symptom
       ↓
[AST Analyzer] → extracts mutations, timing nodes, closures
       ↓
[Router Agent] → selects only relevant function slices
       ↓
[Deep Engine] → 8-phase analysis with strict Anti-Sycophancy rules
       ↓
[Structured Report]
  ├── Root Cause + Evidence
  ├── State Mutation Tracker
  ├── Execution Timeline
  ├── Invariant Violations
  ├── Concept Extraction (what to learn)
  ├── Why AI Loops (why Cursor/Copilot fails)
  └── Deterministic Fix Prompt
```

## Supported Models

- **Claude Opus 4.6 / Sonnet 4.6** (recommended — extended thinking)
- **Gemini 3.1 Pro Preview / 3 Pro / 3 Flash / 2.5 Flash**
- **GPT 5.3**

BYOK (Bring Your Own Key) — keys stored locally, never sent to any server except the API provider.

## Quick Start

```bash
cd unravel-v3
npm install
npm run dev
```

Open `http://localhost:3000`, enter your API key, paste buggy code, and run the engine.

## Project Structure

```
unravel-v3/          ← The current production version
├── src/
│   ├── App.jsx      ← Main app (all UI steps + engine)
│   ├── config.js    ← Providers, taxonomy, prompts, schema
│   ├── index.css    ← Neo-brutalist design system
│   └── main.jsx     ← Entry point
├── index.html
├── vite.config.js
└── package.json
```

## North Star Metrics

| Metric | Target |
|--------|--------|
| **RCA** (Root Cause Accuracy) | 85%+ |
| **TTI** (Time To Insight) | < 2 min |
| **HR** (Hallucination Rate) | < 5% |

## Roadmap

- **Phase 1** ✅ Deep Thinking (BYOK, SOTA models, 8-phase prompt, Anti-Sycophancy rules)
- **Phase 2** 🔜 Intelligence Layer (AST mutation mapping, dynamic function slicing, multi-agent router)
- **Phase 3** 🔜 Measurement (benchmark suite, RCA scoring, hallucination detection)
- **Phase 4** 🔜 Breakthrough (WebContainers, live bug replay, learning paths)

## License

MIT
