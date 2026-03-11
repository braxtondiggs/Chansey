export interface AuthMessage {
  content: string;
  severity: 'success' | 'info' | 'warn' | 'error';
  icon: string;
}
