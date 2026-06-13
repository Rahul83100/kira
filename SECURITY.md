# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report it privately using GitHub's
[**Report a vulnerability**](https://github.com/Rahul83100/kira/security/advisories/new)
button (Security → Advisories), or email the maintainer directly.

Please include:

- A description of the issue and its impact
- Steps to reproduce (a proof-of-concept if possible)
- The affected version / commit

You can expect an initial response within **72 hours**. We'll keep you updated as we
investigate and will credit you in the release notes once a fix ships (unless you prefer to
remain anonymous).

## Supported versions

Kira is pre-1.0 and moves quickly. Security fixes are applied to the latest `main`. Please
run the most recent version before reporting.

## Hardening notes for self-hosters

- **Never commit your `.env`** — it is gitignored by default. Rotate any key that leaks.
- Always set a strong, unique `GEMINI_API_KEY` and restrict it in Google AI Studio.
- Put Kira behind HTTPS (a reverse proxy such as Caddy/Nginx) in production.
- Set `ALLOWED_ORIGINS` to your real domains — don't leave it wide open.
- Scope each tenant's widget with `allowed_domains` so API tokens can't be reused elsewhere.
