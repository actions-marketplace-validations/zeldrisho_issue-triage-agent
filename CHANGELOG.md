# Changelog

Notable changes to this project are documented here. The format follows
[Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/), and releases
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-16

### Added

- Classify issues, apply labels, detect potential duplicates, and draft replies.
- Respond to follow-up issue comments.
- Configure features, labels, security limits, and LLM settings through `.github/issue-triage-agent.yml` or a custom configuration path.
- Use Anthropic or OpenAI-compatible providers, including custom API endpoints.

### Changed

- Document that Action outputs are available for issue events only.

### Fixed

- Default to an OpenAI model when the OpenAI provider is selected without an explicit model.

### Security

- Register supplied GitHub and LLM credentials for masking in workflow logs.

[Unreleased]: https://github.com/zeldrisho/issue-triage-agent/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/zeldrisho/issue-triage-agent/releases/tag/v0.2.0
