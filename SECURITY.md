# Security Policy

## Reporting a vulnerability

Please don't report security problems in public issues, pull requests or discussions.

Use GitHub's private vulnerability reporting instead: open the [Security tab](https://github.com/haflidif/copilot-stream-deck/security) and select **Report a vulnerability**, or go straight to the [new advisory form](https://github.com/haflidif/copilot-stream-deck/security/advisories/new).

Include what you can of the following:

- What the problem is and what an attacker could do with it
- Steps to reproduce, or a proof of concept
- The plugin version, operating system, and Stream Deck and Copilot app versions
- Any ideas for a fix

This is a hobby project maintained by one person, so there is no formal response time. I aim to acknowledge reports within a week and to fix confirmed issues as soon as I reasonably can. I'll keep you updated and credit you in the advisory unless you prefer not to be named.

## Supported versions

Only the latest release gets security fixes. Pre-releases are for testing and may be replaced at any time.

## Scope

The plugin and the Copilot extension run locally. Things that are in scope include:

- The bridge's loopback HTTP endpoint, its token handling and the descriptor files in `%LOCALAPPDATA%\CopilotStreamDeck\bridges` (or the macOS equivalent)
- Reading the Copilot app's local run files and session history
- Opening session links, which only accepts `ghapp://sessions/` links for the selected session
- Anything that could leak session content, tokens or other local data off the machine
- Supply chain issues in the build or the packaged plugin

Problems in the GitHub Copilot app, the Stream Deck app or the Elgato SDK themselves should be reported to GitHub or Elgato.
