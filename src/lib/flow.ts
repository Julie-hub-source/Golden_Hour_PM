import type { Environment, Role } from './types';

export interface FlowTaskTemplate {
  name: string;
  role: Role;
  duration: number;
}

export interface FlowStep {
  step: number;
  phase: string;
  environment: Environment;
  tasks: FlowTaskTemplate[];
}

/** Default flow from CLAUDE.md section 5. Every task in a step is blocked by all tasks of the previous step. */
export const DEFAULT_FLOW: FlowStep[] = [
  {
    step: 1,
    phase: 'Prepare documents',
    environment: 'UAT',
    tasks: [
      { name: 'Prepare business documents', role: 'BA', duration: 3 },
      { name: 'Prepare product documents', role: 'PO', duration: 3 },
    ],
  },
  {
    step: 2,
    phase: 'Dev UAT',
    environment: 'UAT',
    tasks: [
      { name: 'Dev front-end UAT', role: 'FE', duration: 4 },
      { name: 'Dev back-end UAT', role: 'BE', duration: 5 },
    ],
  },
  {
    step: 3,
    phase: 'Test & Debug UAT',
    environment: 'UAT',
    tasks: [
      { name: 'Test UAT', role: 'QC', duration: 2 },
      { name: 'Debug UAT', role: 'BE', duration: 2 },
      { name: 'Debug front-end UAT', role: 'FE', duration: 2 },
    ],
  },
  {
    step: 4,
    phase: 'Internal acceptance UAT',
    environment: 'UAT',
    tasks: [
      { name: 'Internal acceptance UAT (QC)', role: 'QC', duration: 1 },
      { name: 'Internal acceptance UAT (BA)', role: 'BA', duration: 1 },
      { name: 'Internal acceptance UAT (PO)', role: 'PO', duration: 1 },
    ],
  },
  {
    step: 5,
    phase: 'Customer acceptance UAT',
    environment: 'UAT',
    tasks: [
      { name: 'Customer acceptance UAT (QC)', role: 'QC', duration: 2 },
      { name: 'Customer acceptance UAT (BA)', role: 'BA', duration: 2 },
      { name: 'Customer acceptance UAT (PO)', role: 'PO', duration: 2 },
    ],
  },
  {
    step: 6,
    phase: 'Dev STG',
    environment: 'STG',
    tasks: [
      { name: 'Dev front-end STG', role: 'FE', duration: 4 },
      { name: 'Dev back-end STG', role: 'BE', duration: 5 },
    ],
  },
  {
    step: 7,
    phase: 'Test & Debug STG',
    environment: 'STG',
    tasks: [
      { name: 'Test STG', role: 'QC', duration: 2 },
      { name: 'Debug STG', role: 'BE', duration: 2 },
      { name: 'Debug front-end STG', role: 'FE', duration: 2 },
    ],
  },
  {
    step: 8,
    phase: 'Internal acceptance STG',
    environment: 'STG',
    tasks: [
      { name: 'Internal acceptance STG (QC)', role: 'QC', duration: 1 },
      { name: 'Internal acceptance STG (BA)', role: 'BA', duration: 1 },
      { name: 'Internal acceptance STG (PO)', role: 'PO', duration: 1 },
    ],
  },
  {
    step: 9,
    phase: 'Customer acceptance STG',
    environment: 'STG',
    tasks: [
      { name: 'Customer acceptance STG (QC)', role: 'QC', duration: 2 },
      { name: 'Customer acceptance STG (BA)', role: 'BA', duration: 2 },
      { name: 'Customer acceptance STG (PO)', role: 'PO', duration: 2 },
    ],
  },
  {
    step: 10,
    phase: 'Dev Prod',
    environment: 'Prod',
    tasks: [
      { name: 'Dev front-end Prod', role: 'FE', duration: 2 },
      { name: 'Dev back-end Prod', role: 'BE', duration: 2 },
    ],
  },
  {
    step: 11,
    phase: 'Test & Debug Prod',
    environment: 'Prod',
    tasks: [
      { name: 'Test Prod', role: 'QC', duration: 2 },
      { name: 'Debug Prod', role: 'BE', duration: 2 },
      { name: 'Debug front-end Prod', role: 'FE', duration: 2 },
    ],
  },
  {
    step: 12,
    phase: 'Internal acceptance Prod',
    environment: 'Prod',
    tasks: [
      { name: 'Internal acceptance Prod (QC)', role: 'QC', duration: 1 },
      { name: 'Internal acceptance Prod (BA)', role: 'BA', duration: 1 },
      { name: 'Internal acceptance Prod (PO)', role: 'PO', duration: 1 },
    ],
  },
  {
    step: 13,
    phase: 'Customer acceptance Prod',
    environment: 'Prod',
    tasks: [
      { name: 'Customer acceptance Prod (QC)', role: 'QC', duration: 2 },
      { name: 'Customer acceptance Prod (BA)', role: 'BA', duration: 2 },
      { name: 'Customer acceptance Prod (PO)', role: 'PO', duration: 2 },
    ],
  },
];
