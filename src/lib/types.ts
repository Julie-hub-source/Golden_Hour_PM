export const ROLES = ['PM', 'PO', 'BA', 'Designer', 'FE', 'BE', 'QC'] as const;
export type Role = (typeof ROLES)[number];

export const ENVIRONMENTS = ['UAT', 'STG', 'Prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const STATUSES = ['todo', 'in_progress', 'uat', 'stg', 'prod', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  uat: 'In test (UAT)',
  stg: 'In test (STG)',
  prod: 'In test (Prod)',
  closed: 'Closed',
};

export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const OUTPUT_TYPES = [
  'PRD',
  'SRS',
  'Test case',
  'Test evidence',
  'Design',
  'Meeting notes',
  'Code / PR',
  'Other',
] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** Role order used for timeline lanes and team lists. */
export const ROLE_ORDER: Role[] = ['PM', 'PO', 'BA', 'Designer', 'FE', 'BE', 'QC'];

/** How a member is shown in lists and dropdowns: name, a dot, then role, e.g. Alex.PM */
export const memberLabel = (m: { name: string; role: string }) => `${m.name}.${m.role}`;

export interface Member {
  id: string;
  name: string;
  role: Role;
}

export interface Project {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  commitUat: string | null;
  commitStg: string | null;
  commitProd: string;
  priority: Priority;
  context: string;
  clientInfo: string;
  documents: string;
  taskSeq: number;
}

/** A struggle on a task: something outside the team's control is in the way. Each one is shown as a flame. */
export interface TaskIssue {
  id: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
  solvedAt: string | null;
}

export interface TaskOutput {
  id: string;
  type: OutputType;
  url: string;
  addedBy: string | null;
  addedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  code: string;
  name: string;
  phase: string;
  environment: Environment;
  role: Role | null;
  picId: string | null;
  status: Status;
  duration: number;
  deadline: string; // YYYY-MM-DD, planned end (inclusive)
  /** Tasks this one depends on: they must finish before it can start. */
  blockedBy: string[];
  /** Derived: true while the task has at least one unsolved struggle. */
  blocked: boolean;
  issues: TaskIssue[];
  description: string;
  sinceDate: string; // YYYY-MM-DD, last status change
  alerts: string[]; // 'late' | 'todo'
  sortOrder: number;
  outputs: TaskOutput[];
}

/** Everything needed to run the scheduling engine for one project. */
export interface ProjectData {
  project: Project;
  members: Member[];
  tasks: Task[];
}
