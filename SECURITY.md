# Security

Cockpit runs shells and agents with your permissions. It also takes Claude
Code hook events over a Unix socket in `~/.cockpit/run/`, keeps widget secrets
encrypted with Electron's `safeStorage`, and runs widgets in sandboxed iframes
that reach the network, secrets, and storage only through a broker that checks
each widget's manifest. A bug in any of those could let a widget or a local
process do more than it should.

If you find one, report it privately: on GitHub, open the repository's
**Security** tab and choose **Report a vulnerability**. Please don't open a
public issue for it. Say what you did, what happened, and which commit you were
on.

Cockpit is a personal project, so there's no promised response time, but
reports are read and fixed first.
