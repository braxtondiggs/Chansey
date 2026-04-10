import { type FormControl, type FormGroup } from '@angular/forms';

export interface ExchangeFormState {
  form: FormGroup<{ apiKey: FormControl<string>; secretKey: FormControl<string> }>;
  connected: boolean;
  loading: boolean;
  submitted: boolean;
  editMode: boolean;
  name?: string;
  exchangeId?: string;
  slug: string;
  connectedAt?: Date;
}
