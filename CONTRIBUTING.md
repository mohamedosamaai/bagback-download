# Contributing to Bagback Download

Thank you for your interest in contributing to Bagback Download! We welcome bug fixes, documentation improvements, and feature updates. 

---

## 1. Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](file:///d:/%D8%AA%D8%AD%D8%AF%D9%8A%D8%AB%20%D8%AC%D9%8A%D8%AA%20%D9%87%D8%A8/CODE_OF_CONDUCT.md) at all times.

---

## 2. Commit Message Standards (Conventional Commits)

We enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification for all code updates. This enables automated version bumping and clean changelogs:

Format: `<type>(<scope>): <description>`

Types:
- `feat`: A new user-facing feature.
- `fix`: A bug fix or patch.
- `docs`: Documentation updates (README, Wiki, inline comments).
- `style`: Code style modifications (formatting, white-spaces, semi-colons).
- `refactor`: Restructuring code without changing functionality.
- `test`: Adding or correcting tests.
- `chore`: Infrastructure, building dependencies, or package updates.

Examples:
- `feat(web): integrate custom quality settings selector`
- `fix(server): fix download progress SSE update latency`
- `docs(wiki): add component hierarchy specifications`

---

## 3. Git Workflow & Branch Naming

1. **Fork the Repository** and clone it locally.
2. **Create a Topic Branch** targeting your changes:
   - Features: `feature/amazing-new-capability`
   - Patches: `bugfix/connection-timeout-handling`
   - Hotfixes: `hotfix/v1.0.1-patch`
3. **Write and Test Code**: Ensure all workspace tests pass and compilation contains zero type errors (`npx tsc --noEmit` and `npm run build` are clean).
4. **Submit a Pull Request (PR)**: Target your PR to the `main` branch. A project administrator will review the changes and run the CI validation check before merging.
