/**
 * Job data types for Paper Trading BullMQ queue
 */

export enum PaperTradingJobType {
  START_SESSION = 'START_SESSION',
  TICK = 'TICK',
  STOP_SESSION = 'STOP_SESSION',
  PROCESS_SIGNAL = 'PROCESS_SIGNAL'
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

export type AnyPaperTradingJobData = StartSessionJobData | TickJobData | StopSessionJobData | ProcessSignalJobData;
