import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class HealthCheckHelper {
  private readonly logger = new Logger(HealthCheckHelper.name);

  constructor(private readonly http: HttpService) {}

  private getUrl(uuid: string, status?: 'start' | 'fail'): string {
    const baseUrl = process.env.HEALTH_CHECK_URL || 'https://uptime.cymbit.com';
    return `${baseUrl}/ping/${uuid}${status ? `/${status}` : ''}`;
  }

  async ping(uuid: string, status?: 'start' | 'fail'): Promise<void> {
    if (process.env.NODE_ENV !== 'production') Promise.resolve();
    try {
      await firstValueFrom(this.http.get(this.getUrl(uuid, status)));
    } catch (error) {
      this.logger.warn(`Failed to send health check ping: ${error.message}`);
    }
  }
}
