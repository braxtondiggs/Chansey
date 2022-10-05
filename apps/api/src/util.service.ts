
import { Injectable } from '@nestjs/common';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { environment } from './environments/environment';

@Injectable()
export class UtilService {
  private client = new SecretManagerServiceClient({ projectId: environment.projectId });

  async getSecret(name: string): Promise<string> {
    const [response] = await this.client.accessSecretVersion({ name: `projects/753069643084/secrets/${name}/versions/latest` });
    return response.payload.data.toString();
  }
}
