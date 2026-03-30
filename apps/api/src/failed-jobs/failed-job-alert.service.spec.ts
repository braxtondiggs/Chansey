import { Test, TestingModule } from '@nestjs/testing';

import { FailedJobSeverity } from './entities/failed-job-log.entity';
import { FailedJobAlertService } from './failed-job-alert.service';

import { AuditService } from '../audit/audit.service';

describe('FailedJobAlertService', () => {
  let service: FailedJobAlertService;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FailedJobAlertService,
        {
          provide: AuditService,
          useValue: { createAuditLog: jest.fn().mockResolvedValue({}) }
        }
      ]
    }).compile();

    service = module.get(FailedJobAlertService);
    auditService = module.get(AuditService);
  });

  it('should not trigger spike for below-threshold failures', () => {
    for (let i = 0; i < 4; i++) {
      service.recordFailure(FailedJobSeverity.CRITICAL);
    }

    expect(auditService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should trigger spike at threshold', () => {
    for (let i = 0; i < 5; i++) {
      service.recordFailure(FailedJobSeverity.CRITICAL);
    }

    expect(auditService.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'FAILED_JOB_SPIKE_DETECTED',
        metadata: expect.objectContaining({ count: 5 })
      })
    );
  });

  it('should not trigger spike for non-CRITICAL severity', () => {
    for (let i = 0; i < 10; i++) {
      service.recordFailure(FailedJobSeverity.HIGH);
    }

    expect(auditService.createAuditLog).not.toHaveBeenCalled();
  });

  it('should prune entries outside the rolling window', () => {
    jest.useFakeTimers();
    try {
      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        service.recordFailure(FailedJobSeverity.CRITICAL);
      }

      // Advance past the 5-minute window
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);

      // 5th failure should NOT trigger spike — the first 4 expired
      service.recordFailure(FailedJobSeverity.CRITICAL);

      expect(auditService.createAuditLog).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('should not throw when audit service rejects', () => {
    auditService.createAuditLog.mockRejectedValueOnce(new Error('audit down'));

    expect(() => {
      for (let i = 0; i < 5; i++) {
        service.recordFailure(FailedJobSeverity.CRITICAL);
      }
    }).not.toThrow();
  });

  it('should reset after spike detection', () => {
    // Trigger first spike
    for (let i = 0; i < 5; i++) {
      service.recordFailure(FailedJobSeverity.CRITICAL);
    }
    expect(auditService.createAuditLog).toHaveBeenCalledTimes(1);

    // Should need 5 more to trigger again
    for (let i = 0; i < 4; i++) {
      service.recordFailure(FailedJobSeverity.CRITICAL);
    }
    expect(auditService.createAuditLog).toHaveBeenCalledTimes(1);

    service.recordFailure(FailedJobSeverity.CRITICAL);
    expect(auditService.createAuditLog).toHaveBeenCalledTimes(2);
  });
});
