---
"cockpit": patch
---

Enforce `runGit` timeouts directly instead of waiting on `execFile`'s pipe close, so a hung git process or a grandchild holding stdout/stderr open cannot stall status refreshes.
