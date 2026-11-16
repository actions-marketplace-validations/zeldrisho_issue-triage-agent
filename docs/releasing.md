# Releasing

A maintainer opens a release pull request and pushes a tag after it merges.
The tag triggers `.github/workflows/release.yml`, which verifies the tagged
commit and creates a GitHub release. The Action executes `dist/` from the
tagged commit; a successful TypeScript build alone is not enough.

## Prerequisites

- Permission to open and merge a release pull request and push release tags.
- Actions enabled and permission for the release workflow to write repository contents.
- Vite+ and the current Node.js LTS. CI also verifies compatibility with the Action's Node 24 runtime.
- For Marketplace publication, permission to publish the Action and a unique
  `name` in `action.yml`. GitHub validates name availability when publishing.

## Prepare a release

1. Choose a version using [Semantic Versioning](https://semver.org/). Confirm
   the version and tag have not already been released; `package.json`'s current
   version alone does not imply a published release.
2. Set the version in `package.json`. Move relevant entries from `Unreleased`
   in `CHANGELOG.md` into a dated `## [x.y.z] - YYYY-MM-DD` section, leaving
   a new `Unreleased` section. Add release and comparison links. For the first
   release, link its version to its tag and `Unreleased` to the tag-to-HEAD
   comparison. The release workflow supports stable `vX.Y.Z` tags and requires
   a matching package version and a dated changelog entry with at least one item.
3. Run `vp install`, `vp check`, `vp run build`, and `vp test --coverage`.
   Run `vp pm audit` and investigate applicable advisories.
4. With Node.js LTS, run `vp run bundle`. Review and commit all generated `dist/`
   changes with the version and changelog changes in a pull request. Run the
   bundle again and confirm `git status --short -- dist/` is empty. Merge the
   pull request after CI passes, and verify CI on the merged commit.
5. Update the README usage examples to pin the release commit's full SHA.
   Avoid a circular dependency between the documentation commit and its own
   hash: update the examples in a follow-up commit after the release, or pin
   the previously released commit and update them in the next change.

## Publish

1. Create and push an immutable `vX.Y.Z` tag pointing to the verified merged
   commit on `main`. Do not move an existing version tag. Push it manually:
   a tag pushed by a workflow using `GITHUB_TOKEN` will not normally trigger
   the release workflow.
2. Watch the release workflow. It checks that the commit is on `main`, validates
   the tag, package version, and changelog, runs the checks, and verifies the
   bundle before creating a GitHub release from the changelog entry. If it fails,
   investigate and rerun it when appropriate; never replace a published tag.
3. Marketplace publication is separate. Edit the release in GitHub, select
   **Publish this Action to the GitHub Marketplace**, and choose a category.
   GitHub validates the display name and may require acceptance of the developer
   agreement. If the name is taken, change it in a new pull request and release.
   Alternatively, skip Marketplace; the Action still works from the repository.
4. Verify the release and run a smoke test in a separate repository using the
   released commit SHA. Review the published Action's metadata and behavior.

Do not create or move floating major tags unless a separate policy for them is
adopted. Consumers can pin the full commit SHA and update deliberately.

## Correct a release

Do not overwrite a published tag. For a faulty release, mark it as a prerelease
or remove it from the latest-release position as appropriate, explain the
problem in the release notes, and publish a corrected version with a new tag.
Notify affected users and follow GitHub's security advisory process if the
problem is a vulnerability.
