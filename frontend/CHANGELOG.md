# CHANGELOG.md

## [Unreleased]

## [1.4.14] - 2026-03-21

- fix(auth/i18n): stabilize auth/i18n bootstrap and e2e callback flow by handling 401/403 bootstrap reads, preventing hydration mismatch, and mocking callback test data routes
- feat(translation): True and False in the quiz, in English is shown as "T" and "F" instead of "V" and "F".
- feat(translation): Accessible lables have been added to True and False in the quiz.
- fix (translation): Quiz results in True False are considered correct even if they are not "V" and "F".
- internal: update Actions from Node 20 to Node 24

## [1.4.13] - 2026-03-01

- feat(language-route): add `/studio/{lang}` entrypoint support for `es|en|ca` with 404 for unsupported languages
- feat(language-route): apply one-time `routeLanguageOverride` precedence during bootstrap and persist forced language after auth/bootstrap
- feat(auth): enforce route-language override for unauthenticated access in `AuthGuard` and keep Google/Guest parity
- test(language-route): add unit coverage for route page/redirect + learning-state sync persistence contract
- test(language-route): expand e2e coverage for guest, authenticated resume/fallback, remote `ca` override, unsupported route, and logout/login regression
- test(language-route): stabilize fallback/session-reset assertions to avoid locale- and UI-timing-related flakiness

## [1.4.12] - 2026-02-27

- Multilanguage / Internationalization (i18n) support
- feat(i18n): persist `language` in learning state and restore it with remote-state precedence on login/bootstrap
- feat(i18n): persist area configuration per language using language-scoped user keys in `areaConfigByUser`
- feat(content): add language-aware content normalization and filter areas by active UI language
- feat(content): validate question payload language against active UI language when loading an area
- feat(content): add multilingual mock fixtures (`en`, `ca`) and unit coverage for area/question payload normalization
- chore(data): add `language` metadata to areas/questions JSON fixtures used by frontend
- fix(persistence): resolve local dev learning-state endpoint under `NEXT_PUBLIC_BASE_PATH` (`/studio/api/learning-state`)
- fix(routing): stabilize auth bootstrap sequencing to prevent `/areas -> /areas/configure -> /areas` flicker after login
- feat(logging): add `NEXT_PUBLIC_DYNAMODB_LOG_ENABLED` to gate DynamoDB diagnostic logs by environment

## [1.4.11] - 2026-02-26

- feat: add `Configurar áreas` UI to choose visible areas and order, including move up/down controls, offered only to registered users and persisted in user state
- feat: hide area configuration for guests and support guest area allow-list via `guestAllowedAreaShortNames` in areas payload
- feat: persist user area configuration (`allowedAreaShortNames`) in app state and include it in authenticated learning-state sync
- feat: allow studio infra to accept edge lambdas for CloudFront behaviors
- feat: exchange cognito oauth codes at edge and set auth cookie
- feat: add edge logout redirect and failure handling tests
- feat: support edge auth config via local json file
- feat: add edge /studio/me endpoint for current user info
- feat: add route for failed status question detail (`/quiz/status/question/:number`)
- feat: add local dev `/learning-state` API route backed by DynamoDB
- feat: add scripts to pull/push/diff Cognito app client config snapshots
- feat: add script to decode local JWT and print DynamoDB pk/sk delete command
- feat: add admin identity mapping table (`studio-user-identity-admin`) and best-effort email upsert
- fix: stabilize startup route/state bootstrap to reduce configure/areas flicker
- fix: canonicalize deep quiz routes to `/areas` when no area is selected
- fix: resolve unit test regressions around router/auth and persistence mode env typing

## [1.4.10] - 2026-02-20

- feat: persistence implemented using a dynamoDB table

## [1.4.9] - 2026-02-17

- tech: JSON files retrieved from project learning-studio-data to simplify management
- tech: Data is public for ease of access
- tech: JSON files have new structure to allow versioning

## [1.4.8] - 2026-02-17

- Tests pass
- Cognito SSO with Google works
- test: avoid clearing localStorage on authenticated reloads in e2e helpers
- test: make area persistence reload assertion resilient to resume state
- test: make studio root access e2e use local baseURL
- test: add data-testid hooks for MCQ answer buttons
- test: add data-testid hooks for area selection and quiz start
- test: use testids for quiz ordering and start controls
- test: migrate home and resume e2e specs to testids
- test: migrate remaining e2e specs to testids
- test: add testids for answer order controls
- test: add testid-based quiz start helper
- test: use authenticated setup for e2e
- test: gate env var logging behind DEBUG_E2E
- test: extend startQuizByTestId options and refactor specs
- test: refactor additional specs to startQuizByTestId
- test: add selection menu helper for e2e
- fix: render google login as hosted ui link
- fix: remove index.html route alias to allow export
- fix: deploy studio assets at bucket root for /studio path
- fix: treat auth cookie as authenticated session
- feat: load current user via /studio/me and trigger edge logout
- test: clear cookies in authenticated e2e setup
- feat: add Cognito prompt env toggle for login behavior

## [1.4.7] - 2026-02-03

- tech: move from /uned/studio to /studio path throughout the codebase and infra
- feat: remove references to uned from code and presentation

## [1.4.6] - 2026-01-31

- feat: integrate /uned/studio/login page with Google OAuth (Cognito) and guest login options
- feat: add Cognito User Pool, Google IdP, and SPA client to infra (CDK)
- feat: Lambda@Edge handler validates Cognito JWTs (including Google federated users)

## [1.4.5] - 2026-01-28

- feat: add Google user switching capability after logout
- feat: add support for Google OAuth login/logout functionality
- feat: allows anonymous users to log in
- feat: display user's full name from Google OAuth in logout button
- fix: Implement correct answer display in status grid for MCQs
- fix: Shows error message if area file cannot be loaded
- tech: consolidate keys in local storage to a single object, unedStudio, for better management

## [1.4.4] - 2026-01-22

- ui: move Options button to a cogwheel menu to improve mobile layout (FEAT-007)
- test: improve testing logic using data-testid for result text (FEAT-007)
- ui: status grid overlay now covers the full screen and uses a semi-transparent background (BUG-006)

## [1.4.3] - 2026-01-21

- fix: answer shuffling now works between runs and is stable within a run (BUG-006)
- ui: make question/answer order toggles visually and logically consistent

## [1.4.2] - 2026-01-20

- fix: ensure section order in status grid matches section selection (BUG-004)
- bug: fix answer shuffling logic to ensure proper randomization on each attempt
- feat: add option to shuffle answers in Multiple Choice (toggle per area)
- feat: only show question order toggle for Multiple Choice areas
- feat: show 'Aparece en' always at the end (question and answer)
- ui: reduce visual prominence of 'Aparece en' and its list (smaller, gray text)
- ui: display failed-question explanation overlay above the status grid
- feat: support variable number of MCQ answers (2-5)
- feat: add test data infrastructure for E2E testing

## [1.4.1] - 2026-01-17

- feat: add numeric keyboard shortcuts for MCQ answers (1/2/3…)
- bug: fix sequential order skipping first question in section
- docs: add Conventional Commits and changelog process to AGENT_PLAN.md
- docs: explain release identification and independent data/code evolution

## [1.4.0] - 2026-01-14

- fix: always start at first question when starting sections or question selection
- test: add failing test for sequential order skipping first question in section
