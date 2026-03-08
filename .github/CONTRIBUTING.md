# Contributing to Unravel AI

First off, thank you for considering contributing to Unravel! It's people like you that make Unravel such a powerful tool for the community. Here are some guidelines to help you get started.

## What should I contribute?

If you're looking for ways to contribute, please look at our Open Issues, or consider the following areas:

### 1. Extending the Bug Taxonomy
Unravel categorizes bugs using 12 strict tags. We always welcome well-documented additions to the taxonomy. This generally requires adding the classification logic to `config.js` and expanding the test suite.

### 2. Enhancing the AST Engine
The AST engine is the deterministic layer. If you can make `@babel/parser` extract better metrics (like mapping `switch` control flows more accurately), we want your PR. **Rules:**
- Pre-analysis must remain entirely deterministic.
- Do not introduce LLM calls to the AST Engine.
- Keep the engine decoupled from the React/Vite web application.

### 3. Creating New Benchmark Bugs
The UDB-50 (Unravel Debug Benchmark) tests our engine's Root Cause Accuracy (RCA) and Hallucination Rates (HR). If you have complex, multi-file bugs (React hooks, race conditions), please submit them to the `./benchmarks/bugs/` directory with a known `rootCause`.

## Architecture Overview

Unravel works in three layers:

1. Deterministic Analysis (AST Engine)
   - Extracts mutation chains, timing nodes, closures
   - No LLM calls allowed

2. AI Reasoning Engine
   - Uses a structured reasoning pipeline
   - Generates competing hypotheses
   - Eliminates them using AST evidence

3. Verification Layer
   - Claim verifier checks all evidence
   - Fabricated claims reduce confidence or reject the result

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally.
3. Use Node.js version 18+ (we recommend using `nvm` or `n').
4. Install dependencies:
   ```bash
   cd UnravelAI/unravel-v3
   npm install
   ```

## Pull Request Guidelines

1. **Test Your Changes:** We rely heavily on the AST Pre-Analysis Engine. Please ensure your code doesn't break `runFullAnalysis()`. Run any new bugs against the benchmark suite (`node benchmarks/runner.js`).
2. **Keep It Surgical:** Just like Unravel's AI output, PRs should be "Minimal Surgical Fixes." Do not rewrite unrelated functions in your commit.
3. **Follow the Architecture:** Read the `IMPLEMENTATION_PLAN.md` and `unravel_blueprint.md`. Ensure new features align with the phase goals.

## The Sync Rule (Critical for Core Engine)

The core engine files live in `unravel-v3/src/core/`. **An exact copy** lives in `unravel-vscode/src/core/`.
If you update any file in the core engine, you **MUST** synchronize your changes across both directories before committing.

*Thank you for making debugging better!*
— Sambhav Jain
