# Security Policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue or pull request.

Use GitHub's private vulnerability reporting: go to the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers can see that report. If you cannot use that page, open a public issue that says only that you have a security report and asks for a private channel, and leave out the details.

Please include:

- what you found and where (file, function or screen),
- the steps to reproduce it, and the Baton version (see `package.json`),
- what an attacker could do with it.

We will read the report, reply as soon as we can, and keep you informed while we work on a fix. Please give us a reasonable time to fix the problem before you share it publicly.

## Scope

Baton handles no credentials, by design. It never reads, copies or sends your Claude sign-in tokens; sign-in goes through Claude Code's own `claude auth login`, and each account's tokens stay in that account's own Claude Code folder. It listens only on `127.0.0.1`. Reports about any of these properties are especially welcome.
