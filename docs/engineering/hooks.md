# Local Git hooks

Hooks are **unverified until the owner installs the approved packages**. From this repository run:

```sh
npm install --save-dev husky lint-staged @commitlint/cli @commitlint/config-conventional
npm install
```

Then verify the hook directory exists, stage a harmless change, and try `git commit -m "bad message"`; commit-msg must reject it. Remove the test change afterward. Do not use `--no-verify` or `HUSKY=0` except for a documented emergency; CI and branch rules remain authoritative.

On Windows, install Git for Windows and ensure Git Bash is available to Git. If hooks do not fire, verify `.husky/` is present, `core.hooksPath` is configured by Husky, and `npm run prepare` completed. PowerShell and `cmd.exe` are not the shell for hook scripts.

