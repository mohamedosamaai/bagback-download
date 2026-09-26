# Security Policy

## Supported Versions

The following versions are actively supported with security updates and critical patches:

| Version | Supported |
| ------- | --------- |
| v1.x    | Yes       |
| < v1.0  | No        |

---

## Reporting Vulnerabilities

Please report security concerns privately to the project maintainers rather than opening a public issue.

You can submit security disclosures via:
- **Email**: security@bagbacktech.com
- **Platform**: https://bagbacktech.com

Reports are reviewed within 48 hours and coordinated for patch releases.

---

## Security Principles

- **Zero Secret Storage**: API tokens and cloud keys are never hardcoded. Environment variables are used exclusively.
- **Privacy Enforcement**: No third-party trackers, telemetry, or commercial analytics.
- **Minimal Footprint**: External dependencies are kept minimal and audited against supply-chain vulnerabilities.
- **Isolated Execution**: Media extraction runs in isolated temporary directories with strict argument validation and automatic file cleanup.