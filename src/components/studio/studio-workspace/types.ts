import type {
  Annotation,
  Diagnostic,
  PeopleNodeCoverage,
  StudioFlowResponse,
  StudioGraphEdge,
  StudioGraphNode,
  StudioGraphResponse,
  StudioLens,
  StudioLiveNode,
  StudioLiveResponse,
  StudioPeopleResponse,
  StudioStationView,
  StudioTemplateSummary,
  StudioZoom,
} from '../studio-types';

export type Busy = null | 'saving' | 'publishing' | 'drafting' | 'discarding';

export interface StudioWorkspaceValue {
  /** Whether the user is currently on the /studio route (provider is active). */
  active: boolean;

  // ─── URL-derived view state ───
  v: string | null;
  focus: string | null;
  z: StudioZoom;
  lens: StudioLens;
  setParams: (patch: Record<string, string | null>) => void;

  // ─── Graph + derived ───
  graph: StudioGraphResponse | null;
  error: string | null;
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
  /** Canvas sticky-notes (Phase E3) — working copy while editing, else the published set. */
  annotations: Annotation[];
  palette: StudioGraphResponse['palette'];
  diagnostics: Diagnostic[];
  focusedNode: StudioGraphNode | null;

  // ─── Live lens ───
  live: StudioLiveResponse | null;
  liveNodes: Record<string, StudioLiveNode> | null;
  flowEdges: ReadonlySet<string>;

  // ─── Flow² lens ───
  flow: StudioFlowResponse | null;
  flowLoading: boolean;

  // ─── People lens ───
  people: StudioPeopleResponse | null;
  peopleNodes: Record<string, PeopleNodeCoverage> | null;
  peopleLoading: boolean;

  // ─── L2 station detail ───
  station: StudioStationView | null;
  stationLoading: boolean;
  /** Force-refetch the focused node's bound station (after an L2 edit/publish). */
  reloadStation: () => void;

  // ─── Draft editing state (ST4) ───
  canManage: boolean;
  isDraft: boolean;
  editing: boolean;
  dirty: boolean;
  busy: Busy;
  actionError: string | null;

  // ─── Template library (ST6 / Phase E4) ───
  templates: StudioTemplateSummary[];
  /** The template currently being imported (a clone is in flight), else null. */
  importingTemplateId: number | null;

  // ─── Handlers ───
  onGraphChange: (patch: { nodes?: StudioGraphNode[]; edges?: StudioGraphEdge[] }) => void;
  onAddNode: (type: string) => void;
  onUpdateNodeConfig: (nodeId: string, patch: Record<string, unknown>) => void;
  onDeleteNode: (nodeId: string) => void;
  // ─── Annotation CRUD (Phase E3) — draft-only sticky-note edits ───
  onAddAnnotation: () => void;
  onMoveAnnotation: (id: string, x: number, y: number) => void;
  onUpdateAnnotationText: (id: string, text: string) => void;
  onDeleteAnnotation: (id: string) => void;
  createDraft: () => Promise<void>;
  saveDraft: () => Promise<boolean>;
  publish: () => Promise<void>;
  discardDraft: () => Promise<void>;
  /** Clone a system template into the org as a new draft, then switch to it. */
  importTemplate: (templateId: number) => Promise<void>;
}
