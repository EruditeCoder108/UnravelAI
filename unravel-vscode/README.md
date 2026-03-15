# Unravel — Deterministic AI Debugging

![Unravel Banner](./banner.png)

## Stop letting your AI guess.

**Unravel** is the first VS Code extension that runs a deterministic **AST Analysis Pass** before any AI sees your code. It doesn't just ask an LLM what's wrong; it extracts ground truth—mutation chains, async boundaries, and scope captures—and forces the AI to reason over them.

### Key Features

*   **Inline Bug Overlays**: See root causes right on your code lines. No more context switching.
*   **AST-Enhanced Reasoning**: Injects verified facts (variable states, Import chains) directly into the AI context to prevent hallucinations.
*   **Three Modes of Truth**:
    *   **Debug**: Find logical gaps, race conditions, and edge cases.
    *   **Explain**: Understand complex code through causal chain analysis.
    *   **Security**: Scan for vulnerabilities using project-wide static analysis.
*   **Smart Routing**: Automatically detects the most relevant files to analyze, saving tokens and time.
*   **Multilingual Support**: Reports in English, Hindi, and Hinglish.

---

### How to Use

1.  **Right-Click** anywhere in your editor.
2.  Select **Unravel: Debug This File** (or Explain/Security).
3.  Watch as the sidebar populates with a premium, glassmorphic report containing technical timelines and real-world analogies.

### Configuration

Set up your provider in VS Code Settings (`Ctrl+,`):
- `unravel.apiKey`: Your Gemini, Claude, or OpenAI key.
- `unravel.provider`: Select your preferred AI brain.
- `unravel.outputPreset`: Choose between 'Quick', 'Developer', or 'Full' reports.

---

### Architecture
Unravel uses **Tree-Sitter** for high-speed local AST parsing and a custom **Causal Chain Engine** to map how data flows through your application.

[Learn more on GitHub](https://github.com/EruditeCoder108/UnravelAI)

---
*Deterministic Analysis. Causal Reasoning. Exact Fixes.*
