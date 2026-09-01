# Security Policy

## Supported Versions

The following versions are actively supported with security updates and critical patches:

| Version | Supported |
| ------- | --------- |
| v1.0.x  | 🟢 Yes    |
| < v1.0  | ❌ No     |

---

## Reporting Vulnerabilities

Please report security concerns privately to the project maintainers rather than opening a public issue. 

You can submit security disclosures via:
- **Email**: security@bagbacktech.com
- **Platform**: https://bagbacktech.com

We will review reports within 48 hours and coordinate a patch release.

---

## Security Principles

- **Zero Secret Storage**: API tokens and cloud keys must never be hardcoded. Use environmental configuration patterns.
- **Privacy Enforcement**: Do not introduce third-party trackers, telemetry, or analytics by default.
- **Minimal Footprint**: Keep external dependencies to a minimum. All dependencies must be vetted for supply chain vulnerabilities.
- **Secure Defaults**: Deploy with sanitization scripts that scrub user inputs before feeding them to child processes like `yt-dlp`.