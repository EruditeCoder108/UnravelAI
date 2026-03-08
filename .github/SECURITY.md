# Security Policy

## Supported Versions

Unravel AI is currently in early development (version 0.x.x). We only provide security updates for the `main` branch and the latest available release. 

| Version | Supported          |
| ------- | ------------------ |
| v0.3.x  | :white_check_mark: |
| < 0.3.x | :x:                |

## Scope

This policy covers:
- The AST Engine
- The Web Application
- The VS Code Extension
- API key handling

This policy does NOT cover vulnerabilities in third-party AI providers.

## Reporting a Vulnerability

We take the security of Unravel AI seriously. The application runs API keys locally within the VS Code Extension and Web App; however, vulnerabilities within our AST Engine or Web App architecture could potentially expose local environments.

If you discover a security vulnerability in Unravel, please do NOT file a public issue. Instead, please email **Eruditespartan@gmail.com** directly. 

### What to include:
- A description of the vulnerability and its impact
- Steps to reproduce the issue
- Any relevant logs or code snippets

We will acknowledge your email within 48 hours and provide an estimated timeline for the fix. Once the vulnerability has been patched in the main branch, we will credit you in the release notes.

Thank you for helping us keep Unravel AI secure!
