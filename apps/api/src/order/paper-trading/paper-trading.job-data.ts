/**
 * Job data types for Paper Trading BullMQ queue
 */

export enum PaperTradingJobType {
  START_SESSION = 'START_SESSION',
  TICK = 'TICK',
  STOP_SESSION = 'STOP_SESSION',
  PROCESS_SIGNAL = 'PROCESS_SIGNAL',
  NOTIFY_PIPELINE = 'NOTIFY_PIPELINE'
}

export interface PaperTradingJobData {
  type: PaperTradingJobType;
  sessionId: string;
  userId: string;
}

export interface StartSessionJobData extends PaperTradingJobData {
  type: PaperTradingJobType.START_SESSION;
}

export interface TickJobData extends PaperTradingJobData {
  type: PaperTradingJobType.TICK;
  tickNumber?: number;
}

export interface StopSessionJobData extends PaperTradingJobData {
  type: PaperTradingJobType.STOP_SESSION;
  reason?: string;
}

export interface ProcessSignalJobData extends PaperTradingJobData {
  type: PaperTradingJobType.PROCESS_SIGNAL;
  signalId: string;
}

export interface NotifyPipelineJobData extends PaperTradingJobData {
  type: PaperTradingJobType.NOTIFY_PIPELINE;
  pipelineId: string;
  stoppedReason?: string;
}

export type AnyPaperTradingJobData =
  | StartSessionJobData
  | TickJobData
  | StopSessionJobData
  | ProcessSignalJobData
  | NotifyPipelineJobData;
