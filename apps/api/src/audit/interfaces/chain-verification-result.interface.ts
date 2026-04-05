export interface ChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  verifiedEntries: number;
  brokenChainAt: number | null;
  tamperedEntries: string[];
  integrityFailures: string[];
}
