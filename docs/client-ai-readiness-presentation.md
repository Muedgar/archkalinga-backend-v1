# ArchKalinga AI Readiness Presentation

## Slide 1. Title
**ArchKalinga Roadmap: Build the Foundation, Then Add AI That Matters**

- Goal: deliver a usable, reliable construction/project management platform first
- Outcome: add AI in a second phase where it improves planning, delivery, and documents
- Message: AI is part of the roadmap, but not the first milestone

---

## Slide 2. Executive Message
**We agree with the client on the destination, but timing matters**

- AI is a strong fit for this product
- The current codebase already contains valuable planning and workflow structures
- However, the platform still needs core backend and product hardening before AI can deliver dependable business value
- Recommendation: Phase 1 build a production-ready core, Phase 2 add AI on top of trustworthy data and workflows

**Talk track**
If we add AI too early, we risk demo value without operational value. If we stabilize the product first, AI becomes useful, measurable, and easier to trust.

---

## Slide 3. What We Found In The Project
**This is already more than a simple UI mockup**

- Projects, templates, invites, memberships, and contribution history exist
- Task management is modeled across kanban, gantt, and mind map views
- Document workflows already include versions, approvals, change requests, and distribution logs
- Permissions and tenant-aware state are already part of the design

**Evidence in code**
- Project view and project workflow surfaces: [modules/project-management/components/view/view.tsx](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/project-management/components/view/view.tsx)
- Task detail workflow: [modules/kanban/components/task-details-sheet.component.tsx](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/kanban/components/task-details-sheet.component.tsx)
- Mind map planning surface: [modules/mindmap/components/mindmap.component.tsx](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/mindmap/components/mindmap.component.tsx)
- Gantt scheduling surface: [modules/gantt/components/gantt-board.tsx](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/gantt/components/gantt-board.tsx)
- Document lifecycle model: [modules/documents/store/interfaces/documents.types.ts](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/documents/store/interfaces/documents.types.ts)

---

## Slide 4. Why AI Is A Good Fit For This Product
**The domain naturally supports high-value AI**

- Project kickoff and planning
- Task decomposition and next-step guidance
- Progress summaries for stakeholders
- Document summaries, revision comparison, and review assistance
- Natural-language search across projects, tasks, and documents

**Key point**
The product already has the right objects for AI: project briefs, templates, tasks, subtasks, comments, schedules, documents, approvals, and audit trails.

---

## Slide 5. Why AI Should Not Be Phase 1
**The app is still using prototype persistence patterns**

- State is heavily persisted in the browser with Redux persistence
- Multiple modules still read and write through local storage and mock data layers
- This is excellent for frontend iteration, but not enough for production-grade AI workflows

**Evidence in code**
- App-wide persisted frontend state: [store/store.ts](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/store/store.ts)
- Tenant state in local storage: [lib/tenant.ts](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/lib/tenant.ts)
- Project mock persistence: [modules/project-management/store/mock/mock-projects-db.ts](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/project-management/store/mock/mock-projects-db.ts)
- Template mock persistence: [modules/templates/store/mock/mock-data.ts](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/templates/store/mock/mock-data.ts)
- Document mock persistence: [modules/documents/store/mock/documents-db.ts](/Users/mutanganaedgar/Documents/serve_Rwandans/archkalinga-frontend-v1/modules/documents/store/mock/documents-db.ts)

**Talk track**
AI depends on stable, secure, role-aware, auditable data. Right now the platform is close in concept, but not yet ready in architecture.

---

## Slide 6. Risks Of Adding AI Too Early
**Early AI would create visible excitement, but hidden delivery risk**

- AI suggestions would rely on incomplete or browser-local data
- Permissions and data governance would be harder to enforce consistently
- Document intelligence would be limited without real file storage and backend processing
- AI actions would be difficult to audit, explain, or support in production
- The team could spend budget on AI features before finishing the workflows users need every day

**Client-facing message**
We do not want to sell “AI theater.” We want to deliver AI that saves time, reduces risk, and works in real operations.

---

## Slide 7. What Phase 1 Should Deliver
**Build the product so it becomes genuinely usable**

- Clean up frontend workflows and remove prototype friction
- Add a production backend with database, auth, tenant isolation, and permissions
- Persist projects, templates, tasks, gantt, mind map, documents, invites, and users centrally
- Add file storage and document processing foundations
- Add activity logging and audit trails for important user actions

**Definition of success**
Users can manage real projects end to end without depending on local browser state.

---

## Slide 8. Frontend Cleanup Priorities
**Make the existing experience coherent and trustworthy**

- Standardize loading, empty, and error states
- Simplify navigation between dashboard, project, task, document, and planning views
- Reduce repeated drawer/table/form patterns
- Tighten permission-based UI states
- Make the main workflows feel complete rather than exploratory

**Good news**
The project already has many strong UI foundations and reusable components. This is a cleanup and consolidation effort, not a restart.

---

## Slide 9. Backend Priorities
**Create the architecture AI will eventually depend on**

- Authentication and role-based access control
- Tenant-aware data model
- Project and template services
- Task, subtask, checklist, and comment services
- Scheduling layer for gantt and planning
- Document service with file storage, versions, approvals, and audit logs
- Notification and invite flows
- API contracts for frontend consumption

**Why this matters**
Once these services exist, AI can plug into a reliable system instead of a prototype state layer.

---

## Slide 10. AI Roadmap After The Foundation
**AI becomes Phase 2, not “never”**

### Wave 1: Fast, visible wins
- Generate project plans from a brief and selected template
- Break a task into subtasks and checklists
- Summarize project progress for PMs and clients
- Summarize documents and extract action items

### Wave 2: Operational intelligence
- Schedule risk detection
- Revision comparison for document changes
- Natural-language search and command bar
- Role-aware Q&A over project records and documents

### Wave 3: Advanced automation
- Recommended assignees and due dates
- Proactive risk alerts
- Auto-drafted reports and meeting summaries
- Workflow copilot for project managers

---

## Slide 11. Why This Order Saves Money
**Foundation first is actually the faster and cheaper path**

- Reusable backend services reduce rework
- Stable data improves AI output quality
- Auditability reduces deployment risk
- Product adoption improves before AI spend increases
- AI features can be prioritized based on real user behavior, not assumptions

**Simple framing**
First make the platform usable. Then make it intelligent.

---

## Slide 12. Suggested Delivery Plan
**Three practical phases**

### Phase 1. Product readiness
- Frontend cleanup
- Backend architecture
- Core feature completion

### Phase 2. AI enablement
- AI service layer
- Permission-aware context assembly
- Human-in-the-loop AI actions

### Phase 3. AI expansion
- More advanced forecasting, document review, and automation

**Milestone promise**
The client still gets AI, but at the moment when it can produce measurable business value.

---

## Slide 13. Close
**Recommended client message**

“AI is absolutely part of the ArchKalinga vision. The smartest way to deliver it is to first complete the platform foundations: reliable backend services, production persistence, secure document workflows, and polished user journeys. That gives us the data quality and operational trust needed to add AI features that truly help teams plan better, move faster, and reduce risk.”

---

## Appendix. Codebase Findings Summary
**Strengths**

- Rich domain model already exists for projects, tasks, planning, and documents
- Good modular frontend structure
- Useful permission and tenant concepts already present
- Strong future AI insertion points in tasks, planning, and document workflows

**Gaps before AI**

- Heavy browser-side persistence
- Mock/local-storage-backed data access in core modules
- No production backend service layer yet
- No true file-processing pipeline for documents
- No server-side audit and governance model for AI actions yet

