# Contributing to Baton

Thanks for wanting to help. Baton is small, and it is kept calm and plain on purpose. Please keep changes in that spirit.

## Running the tests

```bash
npm install
npm test
```

The tests use a fake `claude` (`test/fake-claude.js`), so they never use your quota and never touch your real Claude Code settings. Please add or update a test for any behaviour you change. `npm test` must pass before you open a pull request.

To see the panel with throwaway demo accounts, run `node src/dev.js --demo`.

## Code style

- Match the code around your change: CommonJS modules, `'use strict'`, single quotes, two-space indentation, and short comments that say *why*, not what.
- There is no linter. Run `node --check` on the JavaScript files you touched.
- Keep dependencies out unless they are really needed.

## Pull requests

- **One change per pull request.** A bug fix, a refactor and a new feature should be three pull requests.
- Describe what changed and why, and how you checked it. The pull request template asks for this.
- Keep the wording in the UI and the READMEs calm, plain and honest. Do not claim that Baton removes usage limits, and do not imply that Baton is made by or endorsed by Anthropic.

## What is welcome

- Bug fixes, especially with a test that reproduces them.
- Clearer error messages and documentation.
- Support for macOS or Linux, with notes on what you tested.
- Small, focused features that fit how Baton already works. For anything larger, please open an issue first to talk about it.

## Security

Please do not report security problems in a public issue or pull request. See [SECURITY.md](SECURITY.md).
