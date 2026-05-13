## ADDED Requirements

### Requirement: IdeaRecord Carries AI-Source Provenance
Kevin Autopilot SHALL extend `IdeaRecord` with an optional `aiSource` field, an optional `aiReflection` provenance block, and SHALL filter dismissed AI-generated ideas out of the visible idea list.

#### Scenario: User-submitted idea persists with user source
- **WHEN** Kevin submits a new idea through the dashboard or `/api/ideas` POST
- **THEN** the saved `IdeaRecord` SHALL omit `aiSource` or set it to `'user'`, and the cockpit SHALL render the idea card without the "AI 生" pill.

#### Scenario: AI-generated idea persists with provenance
- **WHEN** the AI reflection mints an idea seed
- **THEN** the saved `IdeaRecord` SHALL set `aiSource = 'ai-reflection'`, populate `aiReflection.evidence` from the AI output, and `aiReflection.generatedAt` and `aiReflection.model` from the reflection record.

#### Scenario: Dismissed AI idea drops out of the visible list
- **WHEN** an idea has been moved to `data/ideas-dismissed/` via the dismiss API
- **THEN** `listIdeas` SHALL NOT return the dismissed idea, `getIdea` SHALL respond as if the idea does not exist, and the graph projection SHALL NOT include the dismissed idea as an IDEA node.

#### Scenario: User idea cannot be dismissed by the AI dismiss path
- **WHEN** any caller invokes `POST /api/ideas/:id/dismiss` for an idea without `aiSource = 'ai-reflection'`
- **THEN** Kevin Autopilot SHALL respond 400 and SHALL NOT move the idea file.
