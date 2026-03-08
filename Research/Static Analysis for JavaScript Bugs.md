# **Advanced Static Analysis Methodologies for Logical Flaw Detection in JavaScript and TypeScript Ecosystems**

The modern JavaScript and TypeScript ecosystems represent a paradigm shift in software architecture, characterized by ubiquitous asynchronous operations, functional programming patterns, and event-driven control flows. Unlike traditional synchronous, multi-threaded languages where control flow is largely sequential and memory management is explicit, modern JavaScript execution relies on a single-threaded event loop, implicit closure formations, and highly dynamic object mutations.1 These language characteristics act as a breeding ground for complex logical bugs that compile successfully but trigger catastrophic failures at runtime. Bugs such as asynchronous race conditions, stale closures, event lifecycle memory leaks, and fragmented variable mutation chains easily evade conventional syntactic linters.1

To systematically detect these logical flaws before deployment, the software engineering industry and academic research communities have developed a spectrum of static analysis engines. These tools range from localized syntactic rule validators to whole-program mathematical verifiers, each making distinct trade-offs between computational scalability, analytical soundness, and precision. This report exhaustively evaluates the algorithmic mechanics, Abstract Syntax Tree (AST) dependencies, and inherent limitations of ESLint, CodeQL, Semgrep, Facebook Infer, and academic program analysis frameworks. Furthermore, it proposes a theoretical framework for extracting novel, deterministic signals from these engines to strictly bound and enhance the efficacy of Large Language Model (LLM)-assisted debugging systems.

## **Taxonomy of Logical Bugs in the JavaScript/TypeScript Runtime**

Before dissecting the static analysis tools, it is imperative to establish the structural anatomy of the logical bugs they are designed to detect. The asynchronous and dynamically typed nature of the JS/TS runtime necessitates specialized algorithms to identify these issues.4

### **Asynchronous Race Conditions**

In a single-threaded language, true hardware data races (simultaneous memory access by multiple CPU threads) are impossible.6 However, logical race conditions frequently occur due to the cooperative multitasking of the event loop.1 When an async function reads a mutable state, yields execution to the event loop via an await or yield expression, and subsequently writes back to that state upon resumption, the operation ceases to be atomic.1 During the suspension period, other asynchronous callbacks or event handlers may have mutated the shared state, rendering the initial read outdated and corrupting the final write.1

### **Stale Closures**

Stale closures are a prevalent logical flaw, particularly prominent in functional UI frameworks like React.9 A closure in JavaScript captures a snapshot of its lexical environment at the exact moment of its creation.9 In modern frameworks, component functions are repeatedly re-executed, generating new local variables and new closures on every render.12 If an asynchronous callback (e.g., inside setTimeout or useEffect) retains a reference to an older closure, it will read "stale" values that no longer reflect the current application state, leading to visually apparent glitches and logic failures.11

### **Async Ordering Problems**

Async ordering bugs arise when developers incorrectly assume a deterministic sequence of execution for non-deterministic asynchronous operations.13 This includes initiating parallel network requests without proper concurrency controls, failing to await a Promise before evaluating its result (resulting in an object-reference comparison rather than a value comparison), or missing unhandled promise rejections.14 Because the event loop processes message queues based on network or I/O completion times, sequentially written code does not guarantee sequential execution.3

### **Variable Mutation Chains**

JavaScript's reliance on pass-by-reference semantics for objects and arrays makes tracking variable state highly complex. Variable mutation chains occur when an object is passed through multiple layers of higher-order functions or dependency injection systems, undergoing partial mutations (side effects) at various stages.16 If a static analyzer cannot track the taint or state of the object through these interprocedural hops, it will fail to detect injection vulnerabilities, prototype pollution, or invalid state transformations.17

### **Memory Leaks**

While JavaScript utilizes a mark-and-sweep garbage collector, memory leaks remain a critical issue, typically manifesting as "retained memory".19 Leaks occur when objects that are no longer needed by the application logic remain reachable from the root execution context.19 Common causes include uncleared interval timers, circular references in complex data structures, and detached DOM elements that are still referenced by JavaScript variables.21 These leaks accumulate over long-running Single Page Application (SPA) sessions, severely degrading performance.20

### **Event Lifecycle Bugs**

Event lifecycle bugs are prevalent in server-side Node.js applications and complex frontend architectures that rely heavily on the EventEmitter pattern.24 These logic flaws include "dead listeners" (listeners registered for events that are never emitted), "dead emits" (events triggered with no registered listeners to handle them), and memory leaks caused by registering listeners inside repetitive loops without corresponding removal logic.13

## ---

**Architectural Evaluation of Static Analysis Engines**

To detect the aforementioned bug paradigms, modern static analysis tools deploy widely divergent mathematical models and graph theories. The following sections dissect the algorithms, control-flow requirements, and operational limitations of the industry's premier analyzers.

### **1\. ESLint: Structural Traversal and Code Path Analysis**

Originally conceived as a purely stylistic and syntactic linter, ESLint has evolved into a sophisticated engine capable of detecting localized logical bugs.27 It enforces rules through an extensible plugin architecture, acting as the primary guardrail for JavaScript and TypeScript codebases.29

#### **Algorithm and Analysis Method**

ESLint operates primarily via an Abstract Syntax Tree (AST) visitor pattern, traversing the tree generated by parsers like Espree or @typescript-eslint/parser.31 However, to detect complex logical flows—such as race conditions and unreachable code—ESLint relies on its CodePath analyzer.32

The Code Path Analysis algorithm translates the AST into a localized Control Flow Graph (CFG). The execution routes of a program are mapped as a series of CodePathSegment objects.33 Whenever the parser encounters branching statements (e.g., if, switch, try-catch), the code path forks into multiple segments (nextSegments); these segments subsequently join when the logical branches converge (prevSegments).33

To detect **stale closures**, ESLint utilizes its Scope Manager in conjunction with specific rules like react-hooks/exhaustive-deps.9 The algorithm analyzes a function's lexical scope, mapping all variable bindings captured within an inner function (the closure). It then cross-references these bindings against explicitly declared dependency arrays.9 If a captured variable is mutated outside the closure but omitted from the dependency array, the engine flags a stale closure risk.9

To detect **race conditions**, ESLint employs the require-atomic-updates rule. The algorithm tracks the state of a variable across an asynchronous boundary within a generator or async function. The engine monitors the flow: it records when a mutable variable or object property is read, detects a yield or await expression that pauses the function, and verifies if the previously read variable is subjected to an assignment operation immediately upon resumption.7

#### **Required AST and Control-Flow Information**

ESLint requires a fully resolved, ESTree-compliant AST.31 For logical bug detection, the CFG implementation necessitates that CodePathSegment nodes be decorated with specific operational flags, primarily the reachable: boolean property.32 This flag is dynamically calculated during traversal; it becomes false when preceded by return, throw, break, or continue statements, allowing the engine to ignore dead code paths.33

#### **Limitations and False Positives**

The fundamental limitation of ESLint is its strict intraprocedural (single-function or single-file) boundary. It cannot track variable states, object shapes, or mutation chains across different files or deeply nested, imported function calls.37

Consequently, its logical bug detection is highly susceptible to false positives. The require-atomic-updates rule is a prime example. Because ESLint lacks cross-file state tracking and runtime context, it assumes *any* assignment following an await is a potential race condition.8 In reality, if the underlying mutable state is strictly isolated to a specific asynchronous context (e.g., a local object instantiated within an HTTP request context unique to a single network call), concurrent modification by other event loop ticks is impossible.36 ESLint cannot mathematically prove this memory isolation, leading to false positives where the execution is completely atomic relative to its context.36

| Feature | ESLint Capabilities |
| :---- | :---- |
| **Core Algorithm** | AST Traversal, CodePath CFG Analysis, Lexical Scope Mapping |
| **Primary Bug Focus** | Stale closures, syntax errors, localized await race conditions |
| **Interprocedural Flow** | None (Strictly intra-file/intraprocedural) |
| **Primary Limitations** | High false positive rate on complex async flows; context blind |

### **2\. CodeQL: Relational Data Flow and Static Single Assignment (SSA)**

Developed by Semmle and maintained by GitHub, CodeQL abandons traditional AST visiting in favor of treating code as queryable data. It compiles source code into a highly structured relational database, identifying logical and security bugs by executing declarative Datalog queries.39

#### **Algorithm and Analysis Method**

CodeQL constructs an exhaustive Data Flow Graph (DFG) that operates parallel to, but distinctly from, the AST.39 The cornerstone of its logical analysis is the transformation of variables into Static Single Assignment (SSA) form.

In SSA representation, every specific assignment to a variable creates a mathematically distinct node (a DataFlow::SsaDefinitionNode).39 This allows the engine to track the exact lifecycle and **variable mutation chain** independent of the variable's syntactic identifier. CodeQL evaluates data flow by defining a configuration module (DataFlow::ConfigSig), wherein the analyst specifies source nodes (isSource) and sink nodes (isSink).39 A global data flow solver then computes the transitive closure to determine if a path exists between the source and sink across the entire codebase.39

To detect **async ordering problems**, such as missing await statements, CodeQL queries examine the type properties of the DFG. The js/missing-await algorithm traces the return types of functions; if a node returning a Promise object flows directly into a strict comparison sink (e.g., data \== null) without intersecting an await node, the logic mathematically fails, and the bug is reported.14

To detect **race conditions**, particularly Time-of-Check to Time-of-Use (TOCTOU) file system races, CodeQL utilizes global taint tracking. The algorithm identifies an existence check (e.g., fs.existsSync) as a source and a subsequent file manipulation (e.g., fs.writeFileSync) as a sink. The data flow solver computes whether the file path state can be influenced or altered by external operations between the check and the use.39 Taint tracking differs from standard data flow by including non-value-preserving steps, tracing logic through string concatenations, array transformations, and JSON parsing.39

#### **Required AST and Control-Flow Information**

CodeQL requires a complete compilation or build trace of the application to generate its database.40 The database must contain AST nodes, lexical tokens, name bindings, and exhaustively mapped call graphs.43 The critical requirement for logical bug detection is the DataFlow::Node class hierarchy, specifically nodes that possess no direct syntactic equivalent in the AST. These include the SsaDefinitionNode, PropRef (for reasoning about object property reads/writes), and InvokeNode (for modeling reflective calls like Function.prototype.apply).39

#### **Limitations and False Positives**

CodeQL is computationally expensive and slow compared to linters.44 Furthermore, because JavaScript is a highly dynamic language, implicit control flows—such as dependency injection frameworks, higher-order functions, and dynamic module imports—can sever the data flow graph.16 If CodeQL's type inference fails to accurately resolve the target of a dynamic dispatch, the transitive closure breaks, leading to false negatives (missed bugs).45 Conversely, to prevent missed bugs, CodeQL may over-approximate the call graph in context-insensitive queries, leading to path explosion and false positives.46

| Feature | CodeQL Capabilities |
| :---- | :---- |
| **Core Algorithm** | Datalog queries, Transitive Closure, SSA formulation |
| **Primary Bug Focus** | Mutation chains, TOCTOU race conditions, async ordering |
| **Interprocedural Flow** | Advanced (Global Data Flow and Taint Tracking) |
| **Primary Limitations** | Computationally heavy; dynamic dispatch breaks flow graphs |

### **3\. Semgrep: Semantic Pattern Matching and Interprocedural Taint**

Semgrep bridges the gap between the speed of lexical regular expressions (grep) and the semantic awareness of heavy static analysis engines.47 Built on an OCaml engine, it is designed for rapid integration into CI/CD pipelines.47

#### **Algorithm and Analysis Method**

Semgrep operates via an AST pattern-matching algorithm augmented with constant propagation, symbolic propagation, and taint analysis.17 Rather than requiring developers to learn complex query languages like Datalog, Semgrep rules are written in the target language's syntax decorated with metavariables (e.g., $X) and ellipsis operators (...) to define logical flow violations.48

To detect **variable mutation chains** and logical injection flaws, Semgrep utilizes a "taint by side effect" algorithm.18 When a variable is passed into a mutating function (e.g., make\_tainted(my\_set)), Semgrep's engine can be configured via the by-side-effect: true parameter.18 This instructs the algorithm to recognize that the l-value of the variable has been permanently altered in the memory space.18 The engine then tracks this tainted state forward into subsequent sinks, effectively mapping the mutation chain.

With the introduction of the Semgrep Pro engine, the tool performs interprocedural (cross-function) and interfile (cross-file) analysis.49 This allows the engine to trace tainted data flows and logical parameters across Node.js module boundaries, supporting complex dependency injections and server-side framework routing (e.g., Express, NestJS).16

#### **Required AST and Control-Flow Information**

Semgrep builds a lightweight, intraprocedural CFG to facilitate its data flow capabilities.17 It requires an AST parsed from the target language (often utilizing tree-sitter), augmented with basic variable tracking and constant folding capabilities.17 For its interprocedural analysis, it requires sophisticated module resolution capabilities (supporting both CommonJS and ECMAScript modules in Node.js) to stitch together export/import signatures across the file system.16

#### **Limitations and False Positives**

Semgrep makes explicit architectural trade-offs to prioritize raw scanning speed over mathematical soundness.17 The engine explicitly lacks path sensitivity; it considers all potential execution paths equally valid during CFG traversal, even if runtime conditional logic makes a specific path mathematically impossible.17

Furthermore, it lacks rigorous pointer or shape analysis.17 This means that aliasing in complex arrays or objects is often missed, breaking the mutation chain.17 This heuristic-driven, "soundy" approach guarantees a degree of both false positives (flagging dead or impossible paths) and false negatives (missing complex data mutations occurring via object aliasing).17

| Feature | Semgrep Capabilities |
| :---- | :---- |
| **Core Algorithm** | AST Semantic Matching, Taint by side effect, Constant Propagation |
| **Primary Bug Focus** | Insecure logical flows, untrusted data sinks, mutation chains |
| **Interprocedural Flow** | Yes (via Pro Engine), cross-file module resolution |
| **Primary Limitations** | Lack of path and shape sensitivity; heuristic approximations |

### **4\. Facebook Infer: Incorrectness Logic and Separation Logic**

Facebook Infer represents a fundamental shift in static program analysis, utilizing advanced mathematical logic to perform deep, interprocedural verification of source code to detect crashes and memory leaks.51

#### **Algorithm and Analysis Method**

Unlike linters that search for syntactic anti-patterns, Infer's Pulse engine utilizes an under-approximating mathematical paradigm known as Incorrectness Separation Logic (ISL).52 While traditional Hoare Logic attempts to conservatively prove the absolute *absence* of bugs (correctness), ISL attempts to mathematically prove the definitive *presence* of bugs (incorrectness).52 It does this by verifying that a path to a memory or logical error is strictly reachable.52

Pulse performs interprocedural memory safety analysis. To handle the computational state explosion inherent in whole-program analysis, Infer utilizes bi-abduction—a technique that logically infers the pre-conditions and post-conditions of individual functions independently.53 These logical summaries are stored and reused during the analysis of the broader application, dramatically scaling the analysis.53

For **memory leaks** and logical lifecycle bugs, Pulse tracks object lifetimes and resource allocations.54 It manages state noise by classifying issues into two distinct logical states:

1. **Latent Issues:** A memory leak or null dereference that is theoretically possible but conditional upon specific parameter inputs.54 Pulse does not report these immediately.54  
2. **Manifest Issues:** When the engine's interprocedural trace encounters a call-site where the parameters strictly satisfy the mathematical conditions of the latent issue, the bug is elevated to manifest and reported.54

For **race conditions**, Infer utilizes its RacerD engine, which tracks lock acquisitions and method access modifiers. It detects concurrency bugs by identifying lock consistency violations—instances where a class writes to a variable under a lock but reads from it without mutual exclusion.55

#### **Required AST and Control-Flow Information**

Infer does not operate directly on the target language's AST. It requires the source code to be trans-compiled into a Small Intermediate Language (SIL)—a low-level functional representation written in OCaml that models types, expressions, and raw control flow.54

#### **Limitations and False Positives**

Infer's primary limitation in the web ecosystem is its lack of native language support. It was built predominantly for strongly typed, compiled languages like Java, C, C++, and Objective-C.54 While pathways exist to analyze JavaScript/TypeScript by translating the AST into SIL 57, the dynamic, prototype-based nature of JavaScript does not map cleanly to Infer's rigid memory models.59

To suppress false positives when evaluating "opaque functions" (third-party libraries where source code is unavailable to the analyzer), Pulse employs a heuristic called "state scrambling".54 It assumes the unknown function safely modifies or frees the variables passed to it, aggressively destroying the tracked state.54 While this drastically reduces false positive noise, it is a massive source of false negatives, allowing genuine memory leaks to slip through if the leaked object passes through an unmodeled library.54

| Feature | Facebook Infer Capabilities |
| :---- | :---- |
| **Core Algorithm** | Incorrectness Separation Logic, Bi-abduction, State Scrambling |
| **Primary Bug Focus** | Memory leaks, data races, null pointer dereferences |
| **Interprocedural Flow** | Deeply interprocedural via pre/post condition summaries |
| **Primary Limitations** | Poor dynamic language mapping; false negatives on opaque code |

### **5\. Academic Program Analysis: Event-Driven Calculus and Callback Graphs**

The academic community has recognized that commercial static analysis tools often fail to comprehend the non-deterministic scheduling of the Node.js event loop and browser APIs. Consequently, researchers have built custom static analysis models specifically tailored to asynchronous JavaScript.60

#### **Algorithm and Analysis Method**

Two prominent algorithmic frameworks dominate this space: RADAR (Static Analysis of Event-Driven Node.js) and Callback Graph models (e.g., Async-TAJS).

**RADAR (OOPSLA '15):** RADAR is specifically designed to detect **event lifecycle bugs** (e.g., dead listeners, mismatched sync/async calls) by constructing an Event-Based Call Graph (EBCG).13 The algorithm utilizes a flow-sensitive dataflow analysis coupled with a subset-based points-to analysis.13 It models the asynchronous heap using "allocation site abstraction," tracing exactly where in the source code an event emitter is instantiated.13 The engine executes a "listener-sensitive" analysis, which mathematically separates data flow facts based strictly on the current permutation of registered event listeners.13

**Callback Graphs (ECOOP '19):** To detect **async ordering bugs** and **race conditions**, researchers developed the Callback Graph model.60 Traditional CFGs treat the JavaScript event loop as a single opaque node, failing to map the relationships between disjointed callbacks triggered by the event loop.60 The Callback Graph algorithm explicitly models the temporal "happens-before" (![][image1]) and transitive "may-happen-before" (![][image2]) relationships between Promises, asynchronous I/O, and timers.60 By tracing these relationships, the analysis can mathematically prove if a specific variable read operation can interleave maliciously with a variable write operation across different ticks of the event loop.62

#### **Required AST and Control-Flow Information**

These academic tools require highly specialized Intermediate Representations. RADAR relies on an extended ![][image3] calculus that introduces native operational semantics for emit and listen constructs, replacing standard JS ASTs.13 Callback Graph models require the AST to be heavily instrumented with timing nodes, extracting the operational lifecycle of setTimeout, setImmediate, and Promise.resolve to build the required temporal execution edges.60

#### **Limitations and False Positives**

The primary limitation of academic tools is computational scalability. Because they compute highly precise flow-sensitive, context-sensitive, and listener-sensitive points-to analyses, they suffer from severe state explosion when analyzing large, modern codebases bundled with massive libraries (like React or Express).64 Furthermore, highly dynamic JavaScript features like eval, with, or polymorphic object prototypes often force these engines to conservatively over-approximate possible states, resulting in either analysis timeouts or a flood of false positive execution interleavings.13

## ---

**Strategic Proposals for AI-Assisted Debugging Signals**

Modern AI-assisted debugging systems rely heavily on Large Language Models (LLMs).66 However, LLMs struggle with deep contextual reasoning, often hallucinating structural fixes or losing context over long logical chains (context rot).66 To force the AI to reason deterministically, we must constrain its prompt context with hard mathematical signals extracted from the codebase.66

Assuming the debugging system already extracts standard context—such as *mutation chains, timing nodes, closure captures, cross-file symbol resolution,* and *call graphs*—the system requires specialized augmentations derived from the advanced static analysis techniques discussed above. The following five deterministic signals are proposed to be extracted from the AST/CFG pipeline to drastically improve AI reasoning.

### **1\. The Temporal "Happens-Before" Reachability Matrix (HBM)**

**Derivation:** Academic Callback Graphs and RADAR's Event-Based Call Graph.

**The Concept:** While the system currently extracts "timing nodes" and basic "call graphs," these do not explicitly prove execution order in an asynchronous event loop.60 An LLM cannot inherently deduce if Callback A *always* executes before Callback B, leading it to hallucinate race conditions or propose unnecessary mutexes.66

**Extraction Algorithm:** Using a flow-sensitive analysis over the CFG, the system must generate a Boolean reachability matrix mapping all asynchronous boundaries (e.g., .then(), setTimeout, EventEmitter.on). For any two operational nodes ![][image4] and ![][image5], the system computes the exact temporal relations based on the Callback Graph model 60:

* ![][image6] (Path of length one exists; strict happens-before)  
* ![][image7] (Transitive happens-before path exists)  
* ![][image8] (No deterministic path; unordered interleaving is mathematically possible).

**AI Application:**

This matrix is injected directly into the AI prompt as a hard constraint. If the AI suggests an asynchronous race condition is responsible for a bug, the orchestrator cross-references the HBM. If the HBM dictates ![][image7], the AI is deterministically informed: *"Hypothesis invalid: Node X strictly happens-before Node Y via event loop scheduling. Re-evaluate causality."* This acts as an inescapable guardrail against concurrency hallucinations.

### **2\. SSA-Versioned Lexical Environment Vectors (SLEV)**

**Derivation:** CodeQL's Static Single Assignment (SsaDefinitionNode) combined with ESLint's Scope Manager.

**The Concept:** The system currently extracts basic "closure captures." However, knowing that a closure captures a variable count is insufficient for deep logic debugging of stale closures.11 The AI needs to know *which specific version* of count is trapped in the closure's memory snapshot.

**Extraction Algorithm:** During the conversion of the AST into a Data Flow Graph, the analyzer assigns an SSA subscript to every variable assignment (e.g., count\_0, count\_1, count\_2).39 When the Scope Manager detects a closure formation (e.g., an inline arrow function in a React useEffect), the system records the precise SSA index of the variables at the time of closure declaration.9

**AI Application:**

The LLM is provided with an explicit state vector: Closure\_A captures \[count\_1\]. If the enclosing block subsequently modifies the variable (creating count\_2), the AI receives a deterministic flag: Warning: Active execution scope holds \[count\_2\], but Closure\_A is strictly bound to \[count\_1\]. This translates the AI's task from "guessing if React state is stale" to "fixing the deterministically proven stale memory state," drastically improving the accuracy of generated fixes.

### **3\. Bipartite Event-Listener Dependency Subgraphs (ELDS)**

**Derivation:** RADAR's Extended ![][image3] calculus and Listener-Sensitive Analysis.

**The Concept:** Traditional call graphs map direct function invocations. In JavaScript, logic is frequently decoupled via event emitters (.emit('data', payload) and .on('data', callback)). Call graphs show these as independent, disconnected calls to the runtime Event API, blinding the AI to the actual logical flow and making event-based memory leaks impossible to trace.13

**Extraction Algorithm:** The static analyzer scans the AST for reflective event invocation signatures. It builds a specialized bipartite graph where Set ![][image9] contains all emit occurrences (with their statically resolved string literal or constant variable identifiers) and Set ![][image10] contains all listener registrations.13 The analyzer draws direct semantic edges from ![][image11] where the string identifiers mathematically match.

**AI Application:** This subgraph is fed to the LLM to stitch together logically connected but syntactically disconnected files. If the AI is diagnosing a Node.js memory leak, the orchestrator queries the ELDS to find all active listener registrations without corresponding removeListener cleanup nodes in the component destruction phase.13 The AI is handed the deterministic signal: *"Listener for event 'update' registered at File A, Line 20 has no teardown edge. Generate cleanup logic to prevent retained memory."*

### **4\. Latent-to-Manifest Path Constraints (LMPC)**

**Derivation:** Facebook Infer's Pulse Engine and Incorrectness Separation Logic.

**The Concept:** AI models struggle with complex conditional branching, often failing to understand *when* a specific edge-case bug occurs.66 Infer's concept of classifying bugs as "Latent" (conditional) versus "Manifest" (guaranteed) can be repurposed as a high-fidelity signal.54

**Extraction Algorithm:** Using symbolic execution over the CFG, the analyzer extracts the exact algebraic path constraints required to reach a specific erroneous node (e.g., a null dereference or an unhandled Promise rejection). Instead of just passing the raw source code to the AI, the system resolves the boolean satisfiability (SAT) formula for that specific execution path.54

**AI Application:**

The LLM is provided with the deterministic logical formula required to trigger the bug (e.g., Path active IF: (user.role \== 'admin') AND (payload.token IS NULL) AND (timeout \> 500)). By feeding the AI the explicit environmental constraints under which the bug transitions from "Latent" to "Manifest", the LLM can perfectly formulate unit tests, mock data, and precise conditional fixes without guessing the required runtime state.

### **5\. Cross-Boundary Taint Provenance Graphs (CBTPG)**

**Derivation:** Semgrep Pro's Interfile Analysis and CodeQL's Global Taint Tracking.

**The Concept:** While the system currently extracts localized "mutation chains," these chains often break when data passes through dependency injection containers or imported modules.16 The AI loses the provenance of the variable.

**Extraction Algorithm:** The analyzer implements "taint by side effect" combined with inter-file module resolution.18 When an object is passed as an argument into an imported function, the analyzer traces the parameter into the target file, maps any mutations to the object's properties (PropRef writes), and explicitly returns the updated shape back to the calling context.18

**AI Application:**

When the LLM analyzes a function, it is provided a Provenance Graph showing exactly where a variable's properties were altered outside the current file. For example: variable 'config' mutated by side-effect at utils/parser.js:45. This prevents the AI from falsely assuming that a variable maintains its original state throughout the local function's execution, closing the loop on complex, cross-file logical bugs.

## ---

**Conclusion**

The evolution of static analysis in the JavaScript and TypeScript ecosystems reflects a continuous algorithmic battle against the languages' inherent dynamic flexibility, asynchronous paradigms, and event-driven architectures. Traditional AST traversal, as seen in ESLint, provides vital guardrails for stylistic and localized logical errors like stale closures, but falls short due to its intraprocedural limitations. CodeQL's relational Datalog engine and SSA formulations offer unparalleled precision in tracking mutation chains and TOCTOU race conditions, albeit at the cost of high computational overhead and vulnerability to dynamic dispatch breakage. Semgrep offers a pragmatic middle ground, utilizing semantic pattern matching and taint-by-side-effect to track interprocedural logic bugs swiftly, though it trades mathematical soundness for speed. Meanwhile, Facebook Infer's Incorrectness Separation Logic and academic Callback Graphs provide theoretically rigorous approaches to identifying memory leaks and proving async ordering, yet face steep challenges regarding language compatibility and state explosion.

By synthesizing the structural precision of ESLint, the relational data flow of CodeQL, the interprocedural heuristics of Semgrep, the mathematical rigor of Facebook Infer, and the temporal graphing of academic models, we can extract mathematically rigorous proofs of program behavior. Exposing these proofs as deterministic constraint signals—such as the Happens-Before Reachability Matrix and SSA-Versioned Lexical Vectors—to an AI-assisted debugger neutralizes the inherent unreliability and hallucinatory tendencies of LLMs. This synthesis transforms the AI from a heuristic guesser into a precise, mathematically bounded remediation engine, paving the future for automated, high-fidelity software debugging.

#### **Works cited**

1. Does this JavaScript example create “race conditions”? (To the extent that they can exist in JavaScript) \- Stack Overflow, accessed on March 8, 2026, [https://stackoverflow.com/questions/73202786/does-this-javascript-example-create-race-conditions-to-the-extent-that-they](https://stackoverflow.com/questions/73202786/does-this-javascript-example-create-race-conditions-to-the-extent-that-they)  
2. Practical Static Analysis of JavaScript Applications in the Presence of Frameworks and Libraries \- Microsoft, accessed on March 8, 2026, [https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-7.pdf](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-7.pdf)  
3. How to avoid async race conditions in JavaScript | by Slava Shpitalny \- Medium, accessed on March 8, 2026, [https://medium.com/@slavik57/async-race-conditions-in-javascript-526f6ed80665](https://medium.com/@slavik57/async-race-conditions-in-javascript-526f6ed80665)  
4. From Logic to Toolchains: An Empirical Study of Bugs in the TypeScript Ecosystem \- arXiv, accessed on March 8, 2026, [https://arxiv.org/html/2601.21186v1](https://arxiv.org/html/2601.21186v1)  
5. To Type or Not to Type: Quantifying Detectable Bugs in JavaScript \- Microsoft, accessed on March 8, 2026, [https://www.microsoft.com/en-us/research/wp-content/uploads/2017/09/gao2017javascript.pdf](https://www.microsoft.com/en-us/research/wp-content/uploads/2017/09/gao2017javascript.pdf)  
6. \*Data races\* are impossible in JavaScript because it's single-threaded. \*Race co... | Hacker News, accessed on March 8, 2026, [https://news.ycombinator.com/item?id=21065728](https://news.ycombinator.com/item?id=21065728)  
7. require-atomic-updates \- ESLint \- Pluggable JavaScript Linter, accessed on March 8, 2026, [https://eslint.org/docs/latest/rules/require-atomic-updates](https://eslint.org/docs/latest/rules/require-atomic-updates)  
8. How do I resolve the eslint rule "require-atomic-updates"? \- Stack Overflow, accessed on March 8, 2026, [https://stackoverflow.com/questions/58768671/how-do-i-resolve-the-eslint-rule-require-atomic-updates](https://stackoverflow.com/questions/58768671/how-do-i-resolve-the-eslint-rule-require-atomic-updates)  
9. Hooks, Dependencies and Stale Closures \- TkDodo's blog, accessed on March 8, 2026, [https://tkdodo.eu/blog/hooks-dependencies-and-stale-closures](https://tkdodo.eu/blog/hooks-dependencies-and-stale-closures)  
10. Solid.js feels like what I always wanted React to be \- Hacker News, accessed on March 8, 2026, [https://news.ycombinator.com/item?id=30508524](https://news.ycombinator.com/item?id=30508524)  
11. Stale Closures — I underestimated closures | by Frontend Master \- Medium, accessed on March 8, 2026, [https://rahuulmiishra.medium.com/stale-closures-i-underestimated-closures-53ed55e8764a](https://rahuulmiishra.medium.com/stale-closures-i-underestimated-closures-53ed55e8764a)  
12. Why does useRef solve the problem of stale state? \- Stack Overflow, accessed on March 8, 2026, [https://stackoverflow.com/questions/66622967/why-does-useref-solve-the-problem-of-stale-state](https://stackoverflow.com/questions/66622967/why-does-useref-solve-the-problem-of-stale-state)  
13. Static Analysis of Event-Driven Node.js JavaScript Applications \- PLG, accessed on March 8, 2026, [https://plg.uwaterloo.ca/\~olhotak/pubs/oopsla15.pdf](https://plg.uwaterloo.ca/~olhotak/pubs/oopsla15.pdf)  
14. Missing await — CodeQL query help documentation \- GitHub, accessed on March 8, 2026, [https://codeql.github.com/codeql-query-help/javascript/js-missing-await/](https://codeql.github.com/codeql-query-help/javascript/js-missing-await/)  
15. \[AskJS\] Struggling with async concurrency and race conditions in real projects—What patterns or tips do you recommend for managing this cleanly? : r/javascript \- Reddit, accessed on March 8, 2026, [https://www.reddit.com/r/javascript/comments/1nhhdml/askjs\_struggling\_with\_async\_concurrency\_and\_race/](https://www.reddit.com/r/javascript/comments/1nhhdml/askjs_struggling_with_async_concurrency_and_race/)  
16. A Technical Deep Dive into Semgrep's JavaScript Vulnerability Detection, accessed on March 8, 2026, [https://semgrep.dev/blog/2025/a-technical-deep-dive-into-semgreps-javascript-vulnerability-detection/](https://semgrep.dev/blog/2025/a-technical-deep-dive-into-semgreps-javascript-vulnerability-detection/)  
17. Dataflow analysis engine overview \- Semgrep.dev, accessed on March 8, 2026, [https://semgrep.dev/docs/writing-rules/data-flow/data-flow-overview](https://semgrep.dev/docs/writing-rules/data-flow/data-flow-overview)  
18. Advanced techniques for taint analysis \- Semgrep, accessed on March 8, 2026, [https://semgrep.dev/docs/writing-rules/data-flow/taint-mode/advanced](https://semgrep.dev/docs/writing-rules/data-flow/taint-mode/advanced)  
19. Debugging and Fixing Memory Leaks in JavaScript: A Definitive Guide | by Saurabh Mhatre, accessed on March 8, 2026, [https://saurabhnativeblog.medium.com/debugging-and-fixing-memory-leaks-in-javascript-a-definitive-guide-9126e43295a6](https://saurabhnativeblog.medium.com/debugging-and-fixing-memory-leaks-in-javascript-a-definitive-guide-9126e43295a6)  
20. MemLab: An open source framework for finding JavaScript memory leaks, accessed on March 8, 2026, [https://engineering.fb.com/2022/09/12/open-source/memlab/](https://engineering.fb.com/2022/09/12/open-source/memlab/)  
21. Understanding and Preventing Memory Leaks in JavaScript | by Krishna Kanth \- Medium, accessed on March 8, 2026, [https://medium.com/@simplycodesmart/understanding-and-preventing-memory-leaks-in-javascript-1a6fc5d9f4f5](https://medium.com/@simplycodesmart/understanding-and-preventing-memory-leaks-in-javascript-1a6fc5d9f4f5)  
22. How to Avoid Memory Leaks in JavaScript Event Listeners \- DEV Community, accessed on March 8, 2026, [https://dev.to/alex\_aslam/how-to-avoid-memory-leaks-in-javascript-event-listeners-4hna](https://dev.to/alex_aslam/how-to-avoid-memory-leaks-in-javascript-event-listeners-4hna)  
23. facebook/memlab: A framework for finding JavaScript memory leaks and analyzing heap snapshots \- GitHub, accessed on March 8, 2026, [https://github.com/facebook/memlab](https://github.com/facebook/memlab)  
24. Software Vulnerability Analysis Across Programming Language and Program Representation Landscapes: A Survey \- arXiv, accessed on March 8, 2026, [https://arxiv.org/html/2503.20244v1](https://arxiv.org/html/2503.20244v1)  
25. Static Analysis of Dynamic Languages PhD Dissertation \- Pure, accessed on March 8, 2026, [https://pure.au.dk/ws/files/85299449/Thesis.pdf](https://pure.au.dk/ws/files/85299449/Thesis.pdf)  
26. Node.js Memory Leaks: Production Debug Guide 2026 \- AgileSoftLabs Blog, accessed on March 8, 2026, [https://www.agilesoftlabs.com/blog/2026/03/nodejs-memory-leaks-production-debug](https://www.agilesoftlabs.com/blog/2026/03/nodejs-memory-leaks-production-debug)  
27. A guide to static analysis in JavaScript and TypeScript \- Mattermost, accessed on March 8, 2026, [https://mattermost.com/blog/a-guide-to-static-analysis-in-javascript-and-typescript/](https://mattermost.com/blog/a-guide-to-static-analysis-in-javascript-and-typescript/)  
28. Static Code Analysis Approaches for Handling Code Quality \- CloudBees, accessed on March 8, 2026, [https://www.cloudbees.com/blog/static-code-analysis](https://www.cloudbees.com/blog/static-code-analysis)  
29. JavaScript Static Analysis Tools in 2025 from SMART TS XL to ESLint, accessed on March 8, 2026, [https://www.in-com.com/blog/javascript-static-analysis-in-2025-from-smart-ts-xl-to-eslint/](https://www.in-com.com/blog/javascript-static-analysis-in-2025-from-smart-ts-xl-to-eslint/)  
30. How Safe Is Your Code? Static Analysis Tools for Node.js in 2025 | by Ahmedrao | Medium, accessed on March 8, 2026, [https://medium.com/@ahmedrao609/how-safe-is-your-code-static-analysis-tools-for-node-js-in-2025-e12395cc35f1](https://medium.com/@ahmedrao609/how-safe-is-your-code-static-analysis-tools-for-node-js-in-2025-e12395cc35f1)  
31. How to Implement Static Analysis \- OneUptime, accessed on March 8, 2026, [https://oneuptime.com/blog/post/2026-01-30-static-analysis/view](https://oneuptime.com/blog/post/2026-01-30-static-analysis/view)  
32. Code Path Analysis Details \- ESLint \- Pluggable JavaScript linter, accessed on March 8, 2026, [https://archive.eslint.org/docs/developer-guide/code-path-analysis](https://archive.eslint.org/docs/developer-guide/code-path-analysis)  
33. Code Path Analysis Details \- ESLint \- Pluggable JavaScript Linter, accessed on March 8, 2026, [https://eslint.org/docs/latest/extend/code-path-analysis](https://eslint.org/docs/latest/extend/code-path-analysis)  
34. \[ESLint\] Feedback for 'exhaustive-deps' lint rule · Issue \#14920 · facebook/react \- GitHub, accessed on March 8, 2026, [https://github.com/facebook/react/issues/14920](https://github.com/facebook/react/issues/14920)  
35. How to Fix 'Stale Closure' Issues in React Hooks \- OneUptime, accessed on March 8, 2026, [https://oneuptime.com/blog/post/2026-01-24-fix-stale-closure-issues-react-hooks/view](https://oneuptime.com/blog/post/2026-01-24-fix-stale-closure-issues-react-hooks/view)  
36. Race condition error from ESLint require-atomic-updates when using object properties, accessed on March 8, 2026, [https://stackoverflow.com/questions/56892964/race-condition-error-from-eslint-require-atomic-updates-when-using-object-proper](https://stackoverflow.com/questions/56892964/race-condition-error-from-eslint-require-atomic-updates-when-using-object-proper)  
37. Semgrep Code overview, accessed on March 8, 2026, [https://semgrep.dev/docs/semgrep-code/overview](https://semgrep.dev/docs/semgrep-code/overview)  
38. require-atomic-updates false positive · Issue \#11899 · eslint/eslint \- GitHub, accessed on March 8, 2026, [https://github.com/eslint/eslint/issues/11899](https://github.com/eslint/eslint/issues/11899)  
39. Analyzing data flow in JavaScript and TypeScript \- CodeQL \- GitHub, accessed on March 8, 2026, [https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/](https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/)  
40. Hunting Vulnerabilities with CodeQL: A Hands-On Introduction | by Waeel Kheshfeh, accessed on March 8, 2026, [https://medium.com/@waeel.nono3719876/hunting-vulnerabilities-with-codeql-a-hands-on-introduction-17fd686dfb72](https://medium.com/@waeel.nono3719876/hunting-vulnerabilities-with-codeql-a-hands-on-introduction-17fd686dfb72)  
41. About data flow analysis \- CodeQL \- GitHub, accessed on March 8, 2026, [https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/)  
42. Potential file system race condition — CodeQL query help documentation \- GitHub, accessed on March 8, 2026, [https://codeql.github.com/codeql-query-help/javascript/js-file-system-race/](https://codeql.github.com/codeql-query-help/javascript/js-file-system-race/)  
43. CodeQL library for JavaScript \- GitHub, accessed on March 8, 2026, [https://codeql.github.com/docs/codeql-language-guides/codeql-library-for-javascript/](https://codeql.github.com/docs/codeql-language-guides/codeql-library-for-javascript/)  
44. Modern Static Analysis: how the best tools empower creativity \- Devdatta Akhawe, accessed on March 8, 2026, [https://devd.me/log/posts/static-analysis/](https://devd.me/log/posts/static-analysis/)  
45. An Insight into Security Code Review with LLMs: Capabilities, Obstacles, and Influential Factors \- arXiv, accessed on March 8, 2026, [https://arxiv.org/html/2401.16310v4](https://arxiv.org/html/2401.16310v4)  
46. Learning How to Listen: Automatically Finding Bug Patterns in Event-Driven JavaScript APIs, accessed on March 8, 2026, [https://par.nsf.gov/servlets/purl/10340159](https://par.nsf.gov/servlets/purl/10340159)  
47. Semgrep: a static analysis journey, accessed on March 8, 2026, [https://semgrep.dev/blog/2021/semgrep-a-static-analysis-journey/](https://semgrep.dev/blog/2021/semgrep-a-static-analysis-journey/)  
48. Static analysis and rule-writing glossary \- Semgrep, accessed on March 8, 2026, [https://semgrep.dev/docs/writing-rules/glossary](https://semgrep.dev/docs/writing-rules/glossary)  
49. Perform cross-file analysis \- Semgrep, accessed on March 8, 2026, [https://semgrep.dev/docs/semgrep-code/semgrep-pro-engine-intro](https://semgrep.dev/docs/semgrep-code/semgrep-pro-engine-intro)  
50. Pro Engine | SAST Support for 30+ Enterprise Languages \- Semgrep, accessed on March 8, 2026, [https://semgrep.dev/products/pro-engine/](https://semgrep.dev/products/pro-engine/)  
51. Finding inter-procedural bugs at scale with Infer static analyzer \- Engineering at Meta, accessed on March 8, 2026, [https://engineering.fb.com/2017/09/06/android/finding-inter-procedural-bugs-at-scale-with-infer-static-analyzer/](https://engineering.fb.com/2017/09/06/android/finding-inter-procedural-bugs-at-scale-with-infer-static-analyzer/)  
52. \[OOPSLA\] Finding real bugs in big programs with incorrectness logic \- YouTube, accessed on March 8, 2026, [https://www.youtube.com/watch?v=HwIzhtfs6Oo](https://www.youtube.com/watch?v=HwIzhtfs6Oo)  
53. Open-sourcing Facebook Infer: Identify bugs before you ship \- Engineering at Meta, accessed on March 8, 2026, [https://engineering.fb.com/2015/06/11/developer-tools/open-sourcing-facebook-infer-identify-bugs-before-you-ship/](https://engineering.fb.com/2015/06/11/developer-tools/open-sourcing-facebook-infer-identify-bugs-before-you-ship/)  
54. Pulse | Infer, accessed on March 8, 2026, [https://fbinfer.com/docs/next/checker-pulse/](https://fbinfer.com/docs/next/checker-pulse/)  
55. List of all issue types \- Infer Static Analyzer, accessed on March 8, 2026, [https://fbinfer.com/docs/all-issue-types/](https://fbinfer.com/docs/all-issue-types/)  
56. RacerD \- Infer Static Analyzer, accessed on March 8, 2026, [https://fbinfer.com/docs/checker-racerd/](https://fbinfer.com/docs/checker-racerd/)  
57. How to extend it to Javascript · Issue \#372 · facebook/infer \- GitHub, accessed on March 8, 2026, [https://github.com/facebook/infer/issues/372](https://github.com/facebook/infer/issues/372)  
58. Infer Static Analyzer | Infer | Infer, accessed on March 8, 2026, [https://fbinfer.com/](https://fbinfer.com/)  
59. Static Type and Value Analysis by Abstract Interpretation of Python Programs with Native C Libraries \- Jan Vitek, accessed on March 8, 2026, [https://janvitek.org/events/NEU/7575/pubs/monat.pdf](https://janvitek.org/events/NEU/7575/pubs/monat.pdf)  
60. Static Analysis for Asynchronous JavaScript Programs \- DROPS, accessed on March 8, 2026, [https://drops.dagstuhl.de/storage/00lipics/lipics-vol134-ecoop2019/LIPIcs.ECOOP.2019.8/LIPIcs.ECOOP.2019.8.pdf](https://drops.dagstuhl.de/storage/00lipics/lipics-vol134-ecoop2019/LIPIcs.ECOOP.2019.8/LIPIcs.ECOOP.2019.8.pdf)  
61. Don't Call Us, We'll Call You: Characterizing Callbacks in Javascript \- ResearchGate, accessed on March 8, 2026, [https://www.researchgate.net/publication/308732416\_Don't\_Call\_Us\_We'll\_Call\_You\_Characterizing\_Callbacks\_in\_Javascript](https://www.researchgate.net/publication/308732416_Don't_Call_Us_We'll_Call_You_Characterizing_Callbacks_in_Javascript)  
62. Practical Detection of JavaScript Concurrency Bugs using Callback Graphs \- Universidade de Lisboa, accessed on March 8, 2026, [https://fenix.tecnico.ulisboa.pt/downloadFile/1126295043837522/80844-Bernardo-Furet\_\_resumo.pdf](https://fenix.tecnico.ulisboa.pt/downloadFile/1126295043837522/80844-Bernardo-Furet__resumo.pdf)  
63. A Trusted Infrastructure for Symbolic Analysis of Event-based Web APIs \- Department of Computing \- Imperial College London, accessed on March 8, 2026, [https://www.doc.ic.ac.uk/\~pg/publications/Sampaio2022Trusted.pdf](https://www.doc.ic.ac.uk/~pg/publications/Sampaio2022Trusted.pdf)  
64. Practical Dynamic Program Analysis for Node.js \- sonar, accessed on March 8, 2026, [https://sonar.ch/documents/332398/files/2025INF008.pdf](https://sonar.ch/documents/332398/files/2025INF008.pdf)  
65. Reasoning about the Node.js Event Loop using Async Graphs \- Massivizing Computer Systems, accessed on March 8, 2026, [https://atlarge-research.com/pdfs/2019-nodejs-async-graphs-hsun.pdf](https://atlarge-research.com/pdfs/2019-nodejs-async-graphs-hsun.pdf)  
66. ESLint as AI Guardrails: The Rules That Make AI Code Readable \- Medium, accessed on March 8, 2026, [https://medium.com/@albro/eslint-as-ai-guardrails-the-rules-that-make-ai-code-readable-8899c71d3446](https://medium.com/@albro/eslint-as-ai-guardrails-the-rules-that-make-ai-code-readable-8899c71d3446)  
67. SSA \- CodeQL \- GitHub, accessed on March 8, 2026, [https://codeql.github.com/codeql-standard-libraries/javascript/semmle/javascript/SSA.qll/module.SSA.html](https://codeql.github.com/codeql-standard-libraries/javascript/semmle/javascript/SSA.qll/module.SSA.html)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACEAAAAXCAYAAACFxybfAAABHElEQVR4XmNgGAWjYBQMMyAGxAuh9IABTiDeDMQe6BL0BhlAvAxdcCCAGRQPOLgPxFFAzIwuQQ54RCb+AsT/gfgOwwABbiCewQBJqAMCGIG4GYhZ0SWgQBiIQ4HYmAE1qkDiMUAsAMS8DBBzyAYgw4+jC0IByNLTQOwAxAeBOBkqngUVNwfiG0D8Gog1oXIkAxEg3s+A3QAdIH6PxAf5FgRABdtWIOaA8kGOmQRlkwVAPgUFK7YcUQTE/9AFgcAGiMuR+J+AOAiJT1UAsugJuiAQ+AKxCxL/LQP2kKQKACXUTiCOBuJWIHZiQCS+EwyQUnYRVI7mQBKIedAFocCSATVU6AJADgIlShCAZW2618Agi/WBOASI7RiwlC0AbPEuhOdL1QYAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAaCAYAAADBuc72AAABRElEQVR4Xu2WwStEURSHjyRklKRsKFmMLKxEimwnKRusbJX8A8qeBWWjbEgWUvZWlmZmxU74FyxkJxuK73Sv3uvIQmbenKf56qs7vzNT955577wn8s8p4JYNPdLcaC04THmCtyabTb7qB9cdTdPcaK3JzUZbcMiGeWYV223okRFctKFXrnHQhh6ZxCvcxFZT+xXLGbiHHzgvf+AiA2/wHQ/EMetYlRyMszucsqGEWVzENfl+s+nnJezCblOrCx24a0PoxXM8xRI+SBhlbbiDl7iAj3gff1NXNmwQecOZuNbDqMoT7sf1sISNascbgv6d2qU+W5AwGbSTyhy+4ERSzhZ9oTmTcI1annE0rrfl5wNlRhmPcAWPcSDmOiEqEg7yGusNpwf7bZhCr9ev7rpiDKfjWu9+fVB0JmU/6HuAzk513NTkE937SRBcN/hZAAAAAElFTkSuQmCC>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAZCAYAAAAmNZ4aAAABnUlEQVR4Xu2UTytFQRjGH6EQSZSUYiGlLJCNEikLEgvs+AgWPoAFextSioWVfAJlIW7ZiJUia7JSsrKg/Hke773nzsw9nKJzF9xf/erOvHPOO+eddy5Q4j/yTN/oWBhIm336TnfCQNrMwRLfhYG0qaB7sOT6XVSmYIm7wkDaNNNruhAGisE0rMMHwoCDNtjiWOWH0UFX6BYs3kOHvBUBWnALK/eyH/JYo7uwDW7DP5oyegp7lzZ0Rm/ooLPGo5/e001Y4nPa4K3wUbKHcBLWJ23OWLflijY5cxGj9JDWZ8cHsOQb0YpC1lGYWGXV11U6cyN03hlHTNAn+LtUcymxGi2OOnoCq4qLNq4yH8OSqRdieYElVXKXpDutBlRMZYxDSVU1vV+V8aihr3QmDGTRWSneHQaQL3PSfW+nGVrrT1tAXRiH5huRf0jlzaESq9Tu3DhddMZCz6r7v8qRiM7qgrbCXvJIe70V1pxug5bTJVodrfgBOudV2gf7Uxj2w58cwdZcws5eZ6w++TWddBZ23+PI3VN98SS+6egSf5sPeNRHSV9My/8AAAAASUVORK5CYII=>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAZCAYAAAArK+5dAAABXklEQVR4Xu2UsSuFURjGHzFQ6hqURcmudFNKMVlIGSSpu9iUTBZ/gV0Wi5JBFpvFhFFIKUX5I5QyWPA833uOe86R6BzDHe6vft1zv/e757znPe89QJtWo4cu0kP6QS9pLXoDWKP3sPgWnY7Dv9NFj+kdfaczcbhikj6lD//KAL2hS7Asj+JwxSosiSw26D7toG+wRTT29NMr2C6yUGYNN1b2WmC4GcYYbIfaaRbKbtSNVX+dw3oz/FUenVUWe8l3TR4edlF5lJUvj0fl8Yet+C0KyqMfqsYhOmAt8ExHUFieTcQd4zmFLfKCwvL81NvLsAWk2jSkE/bPfqTzbqyEBsMXpugZbIIh2u2DATpsxUO02LYbL9BXOkfPYfNUqCV9dl5lkqLDfkgfBuzQ6/Thf9FLL/C9xYuZhe14BXatTNBx2C2b3WkhddiVfkB36Yn7TK/4ItQQvrX7wkCb1uATbn5DIsWwkWgAAAAASUVORK5CYII=>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABaElEQVR4Xu2UvyuHQRzH30IRhYjBoKzIYJBiQhklg/9AiYHFrFiMFotisVllU7ZvBj+KUv4Ao8lgwfvtc9dzd6nvt+eeQfKuV93d557n7t6fzx3wr9+mdrJMTsknqZGuaAawRh5g8T0yG4frq4WckXvyQRbi8LemyXM62Kj08RXphe3yLQ6jCXbC7WS8YW2RY9iP3mGLqO3VR65hGyklfTzu2rJHNq0XYazCLJSVpSR7elxbCVaiw2TrdDplaR0lfe0+THaWPQNkIhmT/8rDKxlFpj3ambcnlE/2DiwHpeTr/yetwBYQqqJQsu6WjLn+PDkhHX6C1yC5Swed+lHc3tCeEbJPHlHcCxXBOWnzk5rJDLmE/WAoDAZSshUPtUmmYJfRF4EW0xNSmZSzg6D/QoaDfrZ0KZdcWxUX2VOFWskN2YU9gHNxOF+dpBv2OG7AiqUyyZ4nWJVdkMM4nC95vghL8qTr/zF9AXncPtzkqDb/AAAAAElFTkSuQmCC>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFwAAAAZCAYAAAC8ekmHAAADj0lEQVR4Xu2YTahNURiGXyHkFkKIiFBCRJEwwYBEkhBzJAyU/AwkMsFAMpLcKBn4mUgRuV0MhESRInUVAwMpRRn4+Z6z9mqvvc457rnnZ9+ce55665y9dnvt9a1vvetbW2rRokWLFs3CENMG02XTH9Nj07DMHdJO0yu59uOm5aaBmTuaC+KxX268P02Lss3aZLoq137JtDnb3D0DTNdML02/TSuzzQWWmN7FF5uYrabvckE9G7XBCNOT+GKljDE9M22U6+BKtrnAdrlJ6Sucl4sD8fgYtcEM04v4YqXsNbWb+sktITrht2eU3GyS5XnSITewvJkjl4BYKxZLPEjKkDNy9loVZC5LCPysTk6bNV/uBeJOGw1JsCu+mAPEwq9m/Jl4hD7dJpcMq4JrPYLsZVYB/8bHw4F6O8Hr82Sp6b5pZNzQYLATVj2QZG9Mt+UKDPB2MiX532PoIIRgh5tnb9iJh2V9x9Q/bmggjDdczbOUbp5YbU12QtZ6O/FgJ37zpP258reTkLGmG6YJcUODiFczv/3mSWw6VYOdEEg8OoRZpIOvcrMbv0C17JZ7brX6pXygBo9hxfMOrP6a7ISHhxWJB8+ig2/qPTuB0aZ7ys9SSL7x8UW5QBMPAl+TnZSrrf3ujCgLQ9g8jpmemhab3pouqPiEWiucZs+ZDsYNCZwbqJ7em+Ym10ieZaZHplOmHaaFSVslYK+lVjNWgqUQjxVRG1b3wbQt+T9O7iQ6299AtvgKgAdMMg32jQF+VkPYoY/IDeyQqUvOKq6r/gFnkypVFtI3Ez41+U+FtS75/UNpCbdeboX6CuxfTDOdlrMt7h+ebS6AvWKzYawWmPbJJV+4qfKf02gBHhj741rfGMCsUhKV45bKr5B60KHSBx+fbbEVkpldSi2haOBlGKrieLRn7nDw/FKncOAzgLde+qTvutOltF5tBNTfpbx7jYpXHmB9JIHPwIcqLnkbxWul1vtFxZVf1RBgBrva9Mk0UW7pYit5MVOubw+TQv9koF/WZG2ldlIrTPDF5Df7TiWrqmKwnrumk3K+zWZ5WPl+riWgfDLeI1cxPFC6ErAhNtKbqvPAu+Gz6ajcu9TdTtrkNhUGnvexO4RqgP5jLwfese4DLwPJRpZzppmn0vth08FgKQ8pWdlUO5XPqsO6OLMMMh1QDZ9s/zfIcupt6vYTKj49N5Lpcv1uUfqBq0WLPsJfvfK9GEnn4goAAAAASUVORK5CYII=>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGUAAAAbCAYAAABlVEF+AAADy0lEQVR4Xu2ZXYhNURTHl29CiPJNePJR8hmiFIrEgzwIb0wkSiRSaoRXRUqJ8CAv5JEHaUTIVxR5kJoHHw9CiQcprN+ss+fus+fMuHOuc+1pzq/+3XPPPnPOuXvt9V977xHpOvRWLUw+SyJhkOpo8lkSCWVQIqQMSiRsVDUluqN6n3y6c6jkP1JmSoR026AMUK1XXVL9Vj1QDUldIbJD9UKs/ZhqmapP6opiiDko9FmDWJ+gDelmWaM6k7RdU21JN/8d1gFXVM9Vv1Qr080tLFa9Dk8WTMxBAfrks1jH3wjagH49ouoRNlQDN7+tGi72gO+qOV47NyWT9nvnYqKXarqqZ9hQIG4gz1B9Eeu3cJE7TzU2OFc1e1TnxTr/h9gDTnntI1QPxYIXI/1VF1QDg/NFMlL1WCwQl8X6jAD5bJO2gaoaIr4pOXYPeFtpbskaXoAXiRF++D2x98zdCZ3EuQuwFcRgbmxttQHOQM8NNx+WHFPkKfYExhV8bk42xcwssYG0VXJ6eCfxBzJQ6P2C7wZybs4G33eKPcAV/Jity4cZzwexwVR0faFPZnrfcRFX8JnRYl0ELhekux9xmCQ26rAy2p9KvNYVQmBOq6ZIsYHx3cVBULAx7IyJUW53IQPCmwM35iGHxaJeK2PqpM2qc6q5qn5SDFkDGfx6fF9sgpQLprlZHkwK8oCv0jWsCxao7qrGS7GLW6a5/pLBgd2zzqPfsK5ckw7+qCPf4+Yod8TryDQxP98txdoWtOcu/iSp0+7CYmuJ6pbYDSaKzfVDXMH3IZBstSwSS+Gfqr1iGZU1euoBQXgitv3TN2ijIB8XK8ofxZyBzrsutg2CIxBMfwnQHvTTAbHF9VKxxXYItfeVpAcyzzihOim2y80OxVqx95nqLuIFXRY4cVEIBZ8H+HCTRjHLO6hqVu1SXZW2e2b1gtqBnw8OzmNhBIXOW616JlZr2PogCPw+t1txM/mbjgj7rCnVWqFR0tY1X7VP9UhsUc4zCRDfszKuJpqlhhlGHSArsuohvu/sha2Qb6pVlebCeCmVDPok2ZOFXIxSHVJNFktjfjTpSFrXc5ujGgjKOO87tk32MG11wSI4rG34PUVC35CRblJFUFqtq1bIDFIXO3inmqBaJ2ZhsbFCKvtR+Dp2yzrmjVQWxhxjXUUPKGr2xeSYgfHPrYvMGCoW9axiFxO86+jwpAdb78vDkwVAIAgME4HZkl3Duy1MRvz60Sw1bK9XCcHgH10MDiYA7DgwWEoSCMh2sfrCMdZbNFgj025midReZoElsfMHjwG0SFAEBXkAAAAASUVORK5CYII=>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAADBElEQVR4Xu2YT6hNURTGP6Eo8jcGr7yQgSLK4A0w4hWJgYRi/koMmChKrzAykZSSkJIJQ1GkTCTkT9ErenUTGUkpAxTWZ53d3ed753r7nHtOT9xffTnr7PvO2ffba629XaBHj7+Z1aalUdxvWh7F/x2HM3WKJ5zpph2mq6afpoemWblPAPtML+HjJ00bTFNzn0hHDdA4hQH4nL/D5/Q1P4y5pl3Z2DfTFdP83CfGYYrpuumF6YdpU374N+tMb/RmBdQAjcvw1vQF/sUnyRh5ZNqrN1NYaHpi2gl/+DW4STFDcNO6RQ3QuAxH4XPlnBfLGHluWqI3UzhkugR3menHF5yNxpludJtZ0i1qgMaprDL1wcubZT4CX9gYlncluPJ7suvg+Lv2MNbAM0hfWAU1QONUON+Qxbvhc+a/gRmmzVFcCq4+HSfsH+wjfEEglIuWURXUAI1TuRBdc6E439vwTYJwK69ULiR+ONkPf0FornWVC1EDNE6Bi8c5xXxCvtTPRGOl4KqHcgmwQbFkQnN9inrKhagBGqfA+WqDj0t9pul+fjgdflH2iBg2VzpN11egvnIhaoDGKTCj9W/iUme5cIepBB9ctIezFvnwz6ivXIgaoHEKz+A7jBJK/T0q7jDhQNYJPpzSUx7NOm56bFprem26iLEn3CLUAI1T6JSxodSZKRtljIdOGrkyiwdNl8PgZNN60z34F+43TQuDEcHxGKbjMDyrjphapgOmG2jWkNmmZabTpgdo74oKS/wm8t/nIDzLeaplaXGBXyHKIj4srH7QtjAYQcdH9GYEX/ynDCtCDdC4E3cxds5Fpc7MGdab8F2HGT0HbXM0i7qmBT/llkEN0LgpaEbYinmu+oAuzikxNICrswXevBaZtsPLJgU1QOOm+Gjaml2PomLTLYKldcd0Ct432EyPIf3nADVA46Y4Bz9PnYD/bFBrufD/CWxyrOF5MjYeaoDGTcEmyzlzvi0Ub9sTgv6EyGveaxJuIgOmBaZbSM/mfxZm8nl4U6UxPXqU4Bc+MqufDAvWjwAAAABJRU5ErkJggg==>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA8AAAAaCAYAAABozQZiAAABAUlEQVR4Xu2SsQqBURTHj0ySRCKZKJsyyKCMFm+gPICSyaK8gMlmspi8g9i8gAWTQTIZhUXhf5x7ud/1hZ1f/eq759xz77n3fkR/4rAL+18YVTUvbOEVtuwECMIpDNgJzQWeYdFOKJrQbwc1vOsaJqy4pmoHNDF6bTkEJ8a4bHw74Fa57ZIae2Adzh8z3lAj2XkHN/CgxkNzkhsRuIBtI8bPt6Tn5XEnrpeVhyd6tsyk4JhkYaZAzvM/0C1zgSZMsijvyPZgw8jf4cSApNi1LZCBM5i0Ezl4JCl2w0tyJG7bEeT/tENSyBP4krRpkqdawRH0SZmQhXuSwk9WVM2fH+IGksE36DRy8kkAAAAASUVORK5CYII=>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAaCAYAAABsONZfAAAAvklEQVR4XmNgGP5ADYjPAfFKIJ4FxHuA+BEQnwFiFSR1WMETIP4PxOXoEvjAPyD+DcQ26BL4AMiWu0Asji6BC4gwkOE0UwaI81zQJfCBdCB+AMTSaOI4AchpV4G4Cl0CHzAG4q8MuJ22C4iV0AWjGSCBgCEBBcuBmAVZgBGI5zNANPEgS0ABKwPEUBQAcxpIEzoAOfc9A5ItzEAsBsTtDBAN34BYEoplgHgdVBzFMH0g/oQkgQs/gKofBUMEAABgiCpu1/DQKQAAAABJRU5ErkJggg==>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADsAAAAZCAYAAACPQVaOAAAB3klEQVR4Xu2WzytEURTHj1CElB8hSsRCKf8AOwsWLGRhSRZKbCyIhWz8A5ayYaMkO6TELC0tbWSUspClDfnx/brvNdfpzfPemzcZdT/1qZlz5k7nvnvufVfE4XD8Z2rhNryDn/DQ+2777uWOvTGlQB9chx/wBi7DSVht/yiIKjET4YTqVI4MwCe4qxN/zLCYyU7oRBjtMCtmskH4D2NFJ/6YJTE1c5Ujw0lw0LMV64R7sEFMq1/CUStfKE0Ss8gAbiX/AuWF+5SDMlZsCh7ACs8Z2GblC6UMLuhgTN4kwWSzYgZtWbFrKX7bXsBGHYyB7sZIcNALXBRzoq2JeQDcy8WkHp7Bcp2IALcB697UiTB4+PgtzL3pw9Zm+5JKWGPl0qQVHsEOnfiFQTF1j+tEGFy9oCc0Z33e8AyDXcH/SSrf5dMSHdbHFg465LhoJzpIuC8fYbdOWOxLbpXTpBmeS/w2bhFzEttnjA/r3JGA88Z/f2bkZwvb9MARHUwJ3s5WdTACbGGexEGXiSF4D/v9AJ8kXyPzYm4gs953X+4fFvIqpsWKQZJXDxeHbXslpq5eydU7Bk+9uL0Fv69/es/k88EbkzZJLhVsT12flvV2+QNKBXZX3L3qcDgcDkep8wWS23SZwYFSPgAAAABJRU5ErkJggg==>