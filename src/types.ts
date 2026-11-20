export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string };
  labels: Array<{ name: string; id: number }>;
  created_at: string;
}

export type IssueCategory =
  | "bug"
  | "feature"
  | "question"
  | "docs"
  | "duplicate"
  | "invalid"
  | "security";

export type IssuePriority = "critical" | "high" | "medium" | "low";

export interface RelatedIssue {
  number: number;
  title: string;
  url: string;
  body?: string;
  state?: "open" | "closed";
  stateReason?: string | null;
  closedAt?: string | null;
  labels?: string[];
}

export interface IssueClassification {
  category: IssueCategory;
  priority: IssuePriority;
  confidence: number;
  summary: string;
  suggestedLabels: string[];
  reasoning: string;
  relatedIssues?: RelatedIssue[];
}

export interface RepoConfig {
  enabled: boolean;
  features: {
    classify: boolean;
    reply: boolean;
    duplicateSearch: boolean;
    commentReply: boolean;
    media: boolean;
    repositoryContext: boolean;
    skipMaintainerComments: boolean;
    commentReplyOnClosed: boolean;
  };
  labelMapping: Record<string, string[]>;
  labeling: {
    minConfidence: number;
    skipAssigned: boolean;
    skipLabeled: boolean;
  };
  security: {
    maxIssueLength: number;
  };
  repositoryRef?: string;
  exclude: {
    labels: string[];
    users: string[];
  };
  llm: {
    provider: "anthropic" | "openai";
    model: string;
    maxTokens: number;
  };
}

export interface PipelineResult {
  classification: IssueClassification | null;
  labelsApplied: string[];
  replyPosted: boolean;
  labelingStatus:
    | "not-run"
    | "applied"
    | "partial"
    | "skipped-confidence"
    | "skipped-assigned"
    | "skipped-labeled"
    | "failed";
  errors: PipelineError[];
}

export interface PipelineError {
  step: "classify" | "label" | "reply" | "duplicate" | "related-pr";
  message: string;
  cause?: Error;
}

export interface LogFields {
  module?: string;
  title?: string;
  category?: IssueCategory;
  priority?: IssuePriority;
  confidence?: number;
  minConfidence?: number;
  label?: string;
  owner?: string;
  repo?: string;
  issueNumber?: number;
  commentAuthor?: string;
  replyLength?: number;
  model?: string;
  messageCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  err?: unknown;
  devMode?: boolean;
  labels?: string[];
  candidateCount?: number;
  duplicateCount?: number;
  duplicateNumbers?: number[];
  reasoning?: string;
}

export interface Logger {
  info(msgOrObj: string | LogFields, msg?: string): void;
  warn(msgOrObj: string | LogFields, msg?: string): void;
  error(msgOrObj: string | LogFields, msg?: string): void;
  debug(msgOrObj: string | LogFields, msg?: string): void;
  child(bindings: LogFields): Logger;
}

export interface ActionContext {
  owner: string;
  repo: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any;
  logger: Logger;
  configPath?: string;
  botLogin?: string;
  repositoryRef?: string;
  signal?: AbortSignal;
  eventName: string;
  payload: {
    action: string;
    issue: {
      number: number;
      title: string;
      body: string | null;
      html_url: string;
      user?: { login: string; type?: string } | null;
      labels?: Array<{ name: string; id: number }>;
      created_at: string;
      pull_request?: unknown;
      state?: "open" | "closed";
      state_reason?: "completed" | "not_planned" | "not planned" | "duplicate" | "reopened" | null;
      locked?: boolean;
    };
    comment?: {
      id: number;
      body: string | null;
      html_url: string;
      user?: { login: string; type?: string };
      author_association?: string;
      created_at: string;
    };
    sender?: { login: string; type?: string };
    repository: {
      name: string;
      owner: { login: string };
      default_branch: string;
    };
  };
}
