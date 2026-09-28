import type { Checkpoint, Evidence, Finding, Page, Thread, Visit } from '@jevtabs/core-domain';

/** The read surface a ContextPack is assembled from. */
export interface BrokerReadModel {
  thread(threadId: string): Promise<Thread | null>;
  findings(threadId: string): Promise<Finding[]>;
  evidence(threadId: string): Promise<Evidence[]>;
  checkpoints(threadId: string): Promise<Checkpoint[]>;
  /** Most recent meaningful Visits, newest first. Used only at `full_trace`. */
  timeline(threadId: string, limit: number): Promise<{ visit: Visit; page: Page }[]>;
}
