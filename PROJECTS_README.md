# PMO & Agile Project Board Governance

Welcome to the Project Management Office (PMO) guidelines for **Bagback Download**. This document outlines the structural design of our Agile project tracking system and project board setups.

---

## 1. Project Board Layout (8 Core Views)

To streamline development and track feature roadmaps, the repository uses a structured 8-View GitHub Projects board:

1. **🗺️ Roadmap (Timeline)**:
   - Gantt-style timeline mapping high-level epics and core milestones.
   - Used for developer forecasting and founder alignment.
2. **📋 Kanban (Status Board)**:
   - Standard task board with columns: `Backlog` -> `To Do` -> `In Progress` -> `In Review` -> `Done`.
   - The primary screen for daily execution tracking.
3. **🎯 Planning & Backlog**:
   - Backlog priority list where issues are grouped by Priority (`High`, `Medium`, `Low`) and Complexity.
4. **🚀 Feature Releases**:
   - Tracks the progression of release packages (e.g., `v1.0.0`, `v1.1.0`) and features targeting specific user groups.
5. **🪲 Bug Tracker**:
   - A dedicated Kanban view showing reported defects, regression logs, and patches, filtered by label `bug`.
6. **🏃 Sprints (Active Cycles)**:
   - 2-week cycle view mapping sprint goals, active developer allocation, and burn-down indexes.
7. **🏗️ Architecture Breakdown**:
   - Dedicated view for task boards related to platform configuration, refactoring, dependencies, and CI/CD pipelines.
8. **🔄 Retrospective**:
   - A column-based view tracking `What went well`, `What could be improved`, and `Action items` post-sprint.

---

## 2. Issues Workflow Lifecycle

```text
[Issue Created] ➔ [Triage / Sprint Planning] ➔ [In Progress] ➔ [In Review / PR] ➔ [Done]
```

- **Triage**: New issues (Bugs/Features) are created using the official GitHub templates. They are reviewed weekly by the Digital Transformation Architect.
- **Assignment**: Tasks must be linked to a Milestone and assigned to a specific developer.
- **Review Policy**: Merges to `main` require a successful status check from the GitHub Actions CI pipeline.
