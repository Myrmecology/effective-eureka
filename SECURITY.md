# Security Policy

## Supported Versions

Only the latest version on the `main` branch receives security fixes.

## Reporting a Vulnerability

Please do not report security issues in public issues, discussions, or pull requests.

Report privately through GitHub:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Include:
   - A description of the issue and its impact
   - Steps to reproduce it
   - The browser and operating system used
   - A suggested fix, if you have one

You can expect an acknowledgment within 7 days. Confirmed issues will be fixed as soon as possible, and you will be credited in the fix unless you prefer to stay anonymous.

## Scope

In scope:

- Code in this repository
- Cross-site scripting (XSS) or code injection
- Unsafe handling of user input or browser storage
- Vulnerable dependencies

Out of scope:

- Issues in third-party services or browsers themselves
- Attacks that require physical access to a user's device
- Social engineering

## Security Practices

- A Content Security Policy blocks scripts and resources from other origins.
- All user input is sanitized, length-limited, and displayed as plain text only.
- Profile data is kept in memory for the current visit and is never sent anywhere.
- Stored values (best score, settings) are validated every time they are read.
- The development server only listens on `localhost`.
- Production builds do not include source maps.
- Secrets, keys, and credentials are excluded by `.gitignore`.

## Dependency Checks

Check dependencies for known vulnerabilities with:

```bash
npm audit
```