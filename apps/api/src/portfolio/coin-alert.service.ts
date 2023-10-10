import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class CoinAlertService {
  private BASE_URL = 'https://api.cryptocurrencyalerting.com/v1/alert-conditions';
  private auth = {};
  constructor(config: ConfigService, private http: HttpService) {
    this.auth = {
      auth: {
        username: config.get('CCA_API_KEY'),
        password: ''
      }
    };
  }

  async get(type: AlertType = 'percent_price') {
    return await firstValueFrom(this.http.get(this.BASE_URL, { ...this.auth, params: { type } }));
  }

  async create(coin: string, type: AlertType = 'percent_price') {
    const data = {
      type,
      exchange: 'Binance',
      channel: { name: 'webhook' },
      window: 15
    };
    return await firstValueFrom(this.http.post(this.BASE_URL, data, { ...this.auth, params: { type } }));
  }
}

type AlertType = 'new_coin' | 'price' | 'percent_price' | 'periodic_price' | 'bitcoin_mempool' | 'wallet';
