import type { User } from './users.entity';

import type { SupportedExchangeKeyDto } from '../exchange/exchange-key/dto';

export type UserWithExchanges = User & { exchanges: SupportedExchangeKeyDto[] };
