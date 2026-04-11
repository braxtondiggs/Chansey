import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingService } from './paper-trading.service';

import { Pipeline } from '../../pipeline/entities/pipeline.entity';
import { PipelineStatus } from '../../pipeline/interfaces';

/**
 * One-shot cleanup utility for overlapping paper-trading sessions.
 *
 * TODO: delete this service (and its bootstrap call from `PaperTradingRecoveryService`)
 * once the legacy duplicate sessions are cleared in production. The orchestration-level
 * guard (`PipelineOrchestrationService.checkDuplicate`) and the `startFromPipeline`
 * defense-in-depth check are the intended long-term protection. Keeping a silent
 * boot-time fix would hide regressions that should fail loudly instead.
 */
@Injectable()
export class PaperTradingCleanupService {
  private readonly logger = new Logger(PaperTradingCleanupService.name);

  constructor(
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    private readonly paperTradingService: PaperTradingService
  ) {}

  /**
   * Cleanup overlapping paper-trading sessions.
   *
   * Finds all ACTIVE/PAUSED sessions, groups them by `(userId, algorithmId)`, and stops
   * every duplicate beyond the oldest one in each group. Linked pipelines are cancelled.
   *
   * Going through `stop()` is the only safe path — it removes the per-session
   * `paper-trading-tick-{sessionId}` BullMQ scheduler and clears in-memory throttle/exit
   * tracker state. A direct DB update would leave orphan schedulers ticking against dead rows.
   *
   * Set `dryRun` to preview the action without writing.
   */
  async cleanupDuplicateSessions(dryRun: boolean): Promise<{
    scanned: number;
    kept: number;
    stopped: Array<{ sessionId: string; pipelineId?: string }>;
    dryRun: boolean;
  }> {
    // Eager-load user + algorithm so we can group on their IDs and call stop() with a User shape
    const sessions = await this.sessionRepository
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.user', 'user')
      .leftJoinAndSelect('s.algorithm', 'algorithm')
      .where('s.status IN (:...active)', {
        active: [PaperTradingStatus.ACTIVE, PaperTradingStatus.PAUSED]
      })
      .orderBy('user.id', 'ASC')
      .addOrderBy('algorithm.id', 'ASC')
      .addOrderBy('s.createdAt', 'ASC')
      .getMany();

    const groups = new Map<string, PaperTradingSession[]>();
    for (const session of sessions) {
      const userId = session.user?.id;
      const algorithmId = session.algorithm?.id;
      if (!userId || !algorithmId) continue;
      const key = `${userId}::${algorithmId}`;
      const list = groups.get(key) ?? [];
      list.push(session);
      groups.set(key, list);
    }

    let kept = 0;
    const stopped: Array<{ sessionId: string; pipelineId?: string }> = [];

    for (const [, group] of groups) {
      if (group.length <= 1) {
        kept += group.length;
        continue;
      }

      // Keep the oldest (closest to legitimate completion, most ticks accrued)
      kept += 1;
      const duplicates = group.slice(1);

      for (const duplicate of duplicates) {
        if (!dryRun) {
          try {
            await this.paperTradingService.stop(duplicate.id, duplicate.user, 'duplicate-cleanup');

            if (duplicate.pipelineId) {
              await this.pipelineRepository.update(
                { id: duplicate.pipelineId },
                {
                  status: PipelineStatus.CANCELLED,
                  failureReason: 'Duplicate paper-trading session cleanup'
                }
              );
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to stop duplicate session ${duplicate.id}: ${message}`);
            continue;
          }
        }

        stopped.push({ sessionId: duplicate.id, pipelineId: duplicate.pipelineId });
      }
    }

    if (stopped.length > 0) {
      this.logger.log(
        `cleanupDuplicateSessions: scanned=${sessions.length}, kept=${kept}, stopped=${stopped.length}, dryRun=${dryRun}`
      );
    } else {
      this.logger.debug(`cleanupDuplicateSessions: scanned=${sessions.length}, no duplicates found`);
    }

    return { scanned: sessions.length, kept, stopped, dryRun };
  }
}
