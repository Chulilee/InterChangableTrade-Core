# Security Policy

## Supported Versions

InterChangableTrade-Core is under active development ahead of its `1.0`
release. Security fixes are applied to the `main` branch. Until a stable
release line exists, we recommend running the latest `main`.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| `< 0.1` | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub
issues, pull requests, or discussions.**

Instead, report them privately using one of the following channels:

- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  ("Report a vulnerability" under the repository's **Security** tab), **or**
- Open a minimal placeholder issue asking a maintainer to contact you
  privately, without including any exploit details.

Please include, as far as you are able:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof-of-concept.
- The affected component (e.g. Soroban invocation path, auth flow, API
  gateway) and, if known, affected commit or configuration.
- Any suggested remediation.

## What to Expect

- **Acknowledgement** within 3 business days.
- An initial **assessment** and severity classification within 10 business
  days.
- Coordinated disclosure: we will work with you on a fix and a disclosure
  timeline, and credit you in the release notes unless you prefer to remain
  anonymous.

## Scope

This policy covers the code in this repository. Because the project
integrates with the Stellar network and Soroban smart contracts, please note:

- **Never include private keys, secrets, or mainnet credentials** in a
  report, issue, or pull request. The `.env.example` defaults target the
  Stellar **testnet** deliberately.
- Vulnerabilities in the Stellar SDK, Horizon, or the Soroban RPC themselves
  should be reported to the [Stellar Development Foundation](https://www.stellar.org/)
  rather than here.

Thank you for helping keep InterChangableTrade-Core and its users safe.
