# 🔮 Unravel Code Oracle Guide

Welcome to **Terminal Oracle State**. You are no longer just debugging; you are consulting the structural "source of truth" for your entire project.

The `consult` tool transforms the Unravel MCP server into a **Project Oracle**. While `analyze` is for deep-diving into a specific bug, `consult` is for **codebase understanding, feasibility analysis, and architectural mapping.**

---

## 🚀 Quickstart: The First Query

To activate the Oracle for the first time in any project:

```bash
unravel.consult({
  "directory": "./my-project",
  "query": "How does data flow from the UI to the database?"
})
```

**What happens next?**
1. **Cold Build (15-30s):** The Oracle scans every JS/TS file, builds a Knowledge Graph, and embeds the "hubs" (central files) into a semantic vector space.
2. **Intelligence Report:** You receive a structured **§0–§5 Evidence Packet** (not just a summary, but a verified breakdown).

---

## 🛠️ Tool Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | string | **YES** | Your question. E.g., *"Is it safe to refactor the Auth provider?"* |
| `directory`| string | No* | The root folder. *Required only on the very first call.* |
| `include` | string[] | No | **The Scalpel.** Explicitly force the Oracle to look at specific folders/files. |
| `exclude` | string[] | No | Skip folders like `legacy/` or `generated/`. |
| `maxFiles` | number | No | Max files to "route" via the KG (default: 12). |
| `detail` | enum | No | `standard` (high-signal) or `full` (complete AST). |

---

## 🧠 The 5 Zero-Cost Intelligence Layers (§0)

Every `consult` report begins with the **§0 Project Overview**, which merges five "zero-cost" layers to give you a senior engineer's mental model without any LLM latency or API cost.

1.  **Readiness Score:** A `3/3 Core` score proves that the KG, Embeddings, and AST analysis are all active.
2.  **Dependency Manifest:** Automatically scans `package.json`, `requirements.txt`, or `go.mod` to know your runtime constraints.
3.  **Git Awareness:** Real-time extraction of uncommitted changes, hotspots (30-day churn), and recent commits to see what is "hot" right now.
4.  **Context Injection:** Human-authored documents (READMEs, ADRs, Guides) are injected with specified **Trust Levels**.
5.  **JSDoc/TSDoc Summaries:** The first line of every JSDoc comment is scraped and attached to its file in the Knowledge Graph.

---

## 📂 Context Customization: `.unravel/context.json`

You can tell the Oracle which of your manual documents are the most important. Create this file in your project root:

```json
{
  "include": ["ARCHITECTURE.md", "how_unravel_works.md"],
  "trust": { 
    "ARCHITECTURE.md": "high"
  },
  "maxCharsPerFile": 25000
}
```
*Tip: Set `maxCharsPerFile` high to ensure large architectural documents aren't skipped!*

---

## 🏗️ The Evidence Packet Structure

The Oracle returns a report divided into six sections. **NEVER assume the AI knows more than what is in these sections.**

### **§0 Project Overview**
The "Intent" layer. Goals, activity, and human documentation.

### **§1 Structural Scope**
The "Routing" layer. Lists exactly which files the KG picked for this query and which ones were left out. If the answer is missing, check this list!

### **§2 AST Facts**
The "Ground Truth" layer. Deterministic mutation chains, async boundaries, and closure captures. **If AST contradicts a Context File, AST wins.**

### **§3 Cross-File Graph**
The "Link" layer. Shows how files talk to each other: `FileA → FileB:function()`.

### **§4 Memory**
The "Institutional Knowledge" layer. Surfaces past **Codex Discoveries** and **Verified Fixes** from your previous debugging sessions.

### **§5 Reasoning Mandate**
The "Instruction" layer. The Oracle classifies your query (Factual, Analytical, or Feasibility) and gives the AI specific rules on how to synthesize the answer without hallucinating.

---

## 🎓 Pro Tips for Beginners

### **1. Use "include:" for precision**
If you know the bug is in the database layer, don't let the Oracle guess. Pass `"include": ["src/db"]`. This bypasses semantic routing and puts 100% of the analysis power on those files.

### **2. Check the Readiness Tip**
If you see `2/3 core`, it almost always means you forgot to set your `GEMINI_API_KEY`. Without it, "Semantic Routing" is disabled, and the Oracle loses its "intuition" for finding files.

### **3. The "Unstaged" Secret**
The Oracle reads your unstaged git changes. If you are halfway through a refactor and get stuck, run `consult`. It will see your current edits in the §0 Git layer and can help you finish them based on the AST facts!

### **4. "Feasibility" Queries**
The most powerful use case. Ask: *"What would break if I changed the return type of useUser()?"* The Oracle will trace every caller in §3 and every state mutation in §2 to give you a risk assessment.

---

*“Accelerator, not substitute. Unravel provides the structural facts; you provides the architectural wisdom.”*
