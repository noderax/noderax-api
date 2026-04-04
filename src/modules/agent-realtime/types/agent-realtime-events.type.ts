import { TaskStatus } from '../../tasks/entities/task-status.enum';

export type AgentAuthMessage = {
  type?: 'agent.auth';
  nodeId: string;
  agentToken: string;
  agentVersion?: string;
  rootAccess?: {
    appliedProfile?: string;
    lastAppliedAt?: string | null;
    lastError?: string | null;
  };
};

export type AgentTaskStartedMessage = {
  type: 'task.started';
  taskId: string;
  timestamp?: string;
};

export type AgentTaskAcceptedMessage = {
  type: 'task.accepted';
  taskId: string;
  timestamp?: string;
};

export type AgentPingMessage = {
  type: 'agent.ping';
  timestamp?: string;
};

export type AgentAuthAckMessage = {
  authenticated: boolean;
  nodeId?: string;
  rootAccess?: {
    profile: string;
    updatedAt?: string | null;
  } | null;
};

export type AgentTaskLogEntryMessage = {
  timestamp?: string;
  stream: string;
  line: string;
};

export type AgentTaskLogMessage = {
  type: 'task.log';
  taskId: string;
  stream: string;
  line: string;
  timestamp?: string;
};

export type AgentTaskCompletedMessage = {
  type: 'task.completed';
  taskId: string;
  status:
    | TaskStatus.SUCCESS
    | TaskStatus.FAILED
    | TaskStatus.CANCELLED
    | 'canceled'
    | 'timeout';
  result?: Record<string, unknown>;
  output?: string;
  exitCode?: number;
  error?: string;
  timestamp?: string;
  durationMs?: number;
};

export type AgentTaskDispatchPayload = {
  type: 'task.dispatch';
  task: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    timeoutSeconds: number;
  };
};
