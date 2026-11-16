# Changelog

Notable changes to this project are documented here. The format follows
[Keep a Changelog 2.0.0](https://keepachangelog.com/en/2.0.0/), and releases
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-11-16

### Added

- Optional minimum-confidence, assigned-issue, and existing-label checks before applying labels.
- Search open pull requests for potentially related context and expose a JSON triage report output.

### Changed

- Skip issue mutations when the selected LLM provider has no credentials instead of posting mock results.
- Use bounded conversation history for follow-up replies and skip responses that are not needed.
- Consider closed issues and bounded candidate descriptions during duplicate detection, including when classification fails or is disabled.

## [0.4.0] - 2026-11-16

### Added

- Analyze supported GitHub-hosted issue and comment images with vision-capable models.
- Allow issue and follow-up replies to inspect repository files using bounded, read-only GitHub API tools, with a configuration option to disable access.

### Fixed

- Ignore unsupported issue and comment event actions and honor issue exclusions for follow-up comments.
- Reject incomplete provider responses and invalid classifications instead of applying fallback labels.
- Avoid duplicate replies on ordinary reruns using event markers and the posting account's login.
- Bound Action runtime, token settings, and image-fallback retries; allow bounded subtree traversal for truncated Git trees.
- Prioritize follow-up comment images, respect text limits during attachment discovery, and isolate provider-rejected images even when image probes reach the output limit.
- Preserve indexed search results when repository trees are truncated, with file reads verified against the selected commit.
- Fall back to replies without repository tools when a provider explicitly rejects tool calling.

## [0.3.0] - 2026-11-16

### Added

- Set the LLM model with the `llm-model` Action input, including from a GitHub Actions variable.

### Fixed

- Fail the Action visibly when repository configuration cannot be loaded or is invalid.
- Accept issues with a deleted user and strip additional invisible Unicode characters from issue content.

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

[Unreleased]: https://github.com/zeldrisho/issue-triage-agent/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/zeldrisho/issue-triage-agent/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/zeldrisho/issue-triage-agent/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/zeldrisho/issue-triage-agent/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zeldrisho/issue-triage-agent/releases/tag/v0.2.0
