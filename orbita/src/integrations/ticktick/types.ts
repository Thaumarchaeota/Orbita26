export type DidaProject = {
  id: string;
  name: string;
  color?: string;
  closed?: boolean;
};

export type DidaTask = {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  dueDate?: string;
  startDate?: string;
  isAllDay?: boolean;
  priority?: number;
  status?: number;
  tags?: string[];
};

export type DidaAuthStatus = {
  connected: boolean;
};

export type DidaCreateTaskInput = {
  title: string;
  projectId: string;
  content?: string;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  isAllDay?: boolean;
  priority?: number;
};

export type DidaUpdateTaskInput = DidaCreateTaskInput;
