import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as crypto from 'crypto';

@Injectable()
export class CoinbaseService {
  private readonly apiUrl = 'https://api.coinbase.com/v2';
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.apiKey = this.configService.get<string>('COINBASE_API_KEY');
    this.apiSecret = this.configService.get<string>('COINBASE_API_SECRET');
  }

  async getPrice(symbol: string) {
    const response = await this.httpService.axiosRef.get(`${this.apiUrl}/prices/${symbol}/spot`);
    return response.data;
  }

  async getAccounts() {
    const response = await this.httpService.axiosRef.get(`${this.apiUrl}/accounts`, {
      headers: this.getAuthHeaders()
    });
    return response.data;
  }

  private getAuthHeaders() {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.generateSignature(timestamp);

    return {
      'CB-ACCESS-KEY': this.apiKey,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp
    };
  }

  private generateSignature(timestamp: string): string {
    const message = timestamp + 'GET' + '/accounts';
    const signature = crypto.createHmac('sha256', this.apiSecret).update(message).digest('hex');
    return signature;
  }
}
