## Description
Please include a summary of the change and which issue is fixed.

Fixes # (issue)

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] AST Engine update (improves static analysis extraction)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## How Has This Been Tested?
Please describe the tests that you ran to verify your changes. If you updated the core engine, did you run the proxy benchmark?

- [ ] Verified locally via `npm run dev`
- [ ] Benchmark Tests `node benchmarks/runner.js`
- [ ] VS Code Extension tested (Extension Development Host)

## Checklist:
- [ ] My code follows the strict architectural guidelines (Layer 0 AST first, no LLM guessing before reasoning).
- [ ] I have synced changes across `unravel-v3/src/core/` and `unravel-vscode/src/core/` (if I modified the engine).
- [ ] My changes do not generate unstructured text fields from the LLM.
- [ ] I ran the benchmark suite and confirmed RCA did not regress.
- [ ] I have updated the documentation accordingly (`README.md`, `unravel_blueprint.md`).
