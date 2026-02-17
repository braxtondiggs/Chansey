import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { firstValueFrom } from 'rxjs';

@Injectable()
export class CoinAlertService {
  private BASE_URL = 'https://api.cryptocurrencyalerting.com/v1/alert-conditions';
  private auth = {};
  constructor(
    config: ConfigService,
    private readonly http: HttpService
  ) {
    this.auth = {
      auth: {
        username: config.get('CCA_API_KEY'),
        password: ''
      },
      headers: {
        'Content-Type': 'application/json'
      }
    };
  }

  async get(type: AlertType = 'percent_price') {
    const { data } = await firstValueFrom(this.http.get(this.BASE_URL, { ...this.auth, params: { type } }));
    return data;
  }

  async create(currency: string, type: AlertType = 'percent_price') {
    const data = {
      channel: { name: 'webhook' },
      cooldown: 30,
      currency,
      direction: 'changes',
      exchange: 'Binance US',
      note: 'Chansey',
      percent: '1',
      type,
      window: 5
    };
    const { data: response } = await firstValueFrom(this.http.post(this.BASE_URL, data, { ...this.auth }));
    return response;
  }

  async delete(coin: string, type: AlertType = 'percent_price') {
    const alerts = await this.get(type);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { id } = alerts.find(
      ({ currency, note }: { currency: string; note: string }) => coin === currency && note === 'Chansey'
    );
    if (!id) return;
    const { data } = await firstValueFrom(this.http.delete(`${this.BASE_URL}/${id}`, this.auth));
    return data;
  }
}

type AlertType = 'new_coin' | 'price' | 'percent_price' | 'periodic_price' | 'bitcoin_mempool' | 'wallet';
