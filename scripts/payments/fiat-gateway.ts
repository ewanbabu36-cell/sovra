import crypto from 'node:crypto';

export interface FiatPayoutRequest {
  payoutId: string;
  userDid: string;
  amountSov: number;
  fiatAmount: number;
  currency: string;
  destinationRef: string;
}

export interface FiatPayoutResponse {
  ok: boolean;
  provider: 'stripe' | 'razorpayx';
  externalPayoutId?: string;
  status: 'PENDING_BANK_PAYOUT' | 'SETTLED' | 'FAILED';
  error?: string;
}

export interface ParsedFiatPayoutWebhookEvent {
  provider: 'stripe' | 'razorpayx';
  payoutId?: string;
  externalPayoutId?: string;
  outcome: 'SETTLED' | 'FAILED' | 'IGNORED';
  failureReason?: string;
}

export interface FiatPayoutProvider {
  readonly name: 'stripe' | 'razorpayx';
  isConfigured(): boolean;
  createPayout(req: FiatPayoutRequest): Promise<FiatPayoutResponse>;
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; reason?: string; event?: ParsedFiatPayoutWebhookEvent };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === target) {
      return Array.isArray(v) ? String(v[0] || '') : String(v || '');
    }
  }
  return '';
}

function timingSafeHexEqual(expectedHex: string, actualHex: string): boolean {
  try {
    const a = Buffer.from(expectedHex.trim().toLowerCase(), 'utf8');
    const b = Buffer.from(actualHex.trim().toLowerCase(), 'utf8');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export class StripePayoutAdapter implements FiatPayoutProvider {
  public readonly name = 'stripe' as const;
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly apiBase: string;
  private readonly fetchFn: FetchLike;

  constructor(opts?: { secretKey?: string; webhookSecret?: string; apiBase?: string; fetchFn?: FetchLike }) {
    this.secretKey = (opts?.secretKey ?? process.env.STRIPE_SECRET_KEY ?? '').trim();
    this.webhookSecret = (opts?.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
    this.apiBase = (opts?.apiBase ?? process.env.STRIPE_API_BASE ?? 'https://api.stripe.com').replace(/\/+$/, '');
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.secretKey && (this.webhookSecret || process.env.NODE_ENV === 'test'));
  }

  public async createPayout(req: FiatPayoutRequest): Promise<FiatPayoutResponse> {
    if (!this.secretKey) {
      return { ok: false, provider: 'stripe', status: 'FAILED', error: 'STRIPE_SECRET_KEY missing' };
    }
    const minorUnits = Math.max(100, Math.round(req.fiatAmount * 100));
    const form = new URLSearchParams({
      amount: String(minorUnits),
      currency: req.currency.toLowerCase(),
      destination: req.destinationRef,
      'metadata[sovra_payout_id]': req.payoutId,
      'metadata[sovra_user_did]': req.userDid,
    });
    try {
      const resp = await this.fetchFn(`${this.apiBase}/v1/payouts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': req.payoutId,
        },
        body: form.toString(),
      });
      const json = (await resp.json().catch(() => ({}))) as any;
      if (!resp.ok) {
        return {
          ok: false,
          provider: 'stripe',
          status: 'FAILED',
          error: json?.error?.message || `Stripe HTTP ${resp.status}`,
        };
      }
      const st = String(json?.status || 'pending').toLowerCase();
      return {
        ok: true,
        provider: 'stripe',
        externalPayoutId: String(json?.id || `po_${req.payoutId}`),
        status: st === 'paid' ? 'SETTLED' : 'PENDING_BANK_PAYOUT',
      };
    } catch (err: any) {
      return { ok: false, provider: 'stripe', status: 'FAILED', error: err?.message || 'Stripe request failed' };
    }
  }

  public verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; reason?: string; event?: ParsedFiatPayoutWebhookEvent } {
    if (!this.webhookSecret) {
      return { valid: false, reason: 'STRIPE_WEBHOOK_SECRET is not configured' };
    }
    const sigHeader = headerValue(headers, 'stripe-signature');
    if (!sigHeader) {
      return { valid: false, reason: 'Missing Stripe-Signature header' };
    }
    let timestamp = '';
    const v1Sigs: string[] = [];
    for (const part of sigHeader.split(',')) {
      const [k, v] = part.split('=', 2).map((s) => s.trim());
      if (k === 't' && v) timestamp = v;
      if (k === 'v1' && v) v1Sigs.push(v);
    }
    const tsNum = Number(timestamp);
    if (!timestamp || !Number.isFinite(tsNum) || v1Sigs.length === 0) {
      return { valid: false, reason: 'Malformed Stripe-Signature header' };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > 300) {
      return { valid: false, reason: 'Stripe webhook timestamp outside replay window' };
    }
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
    const matched = v1Sigs.some((sig) => timingSafeHexEqual(expected, sig));
    if (!matched) {
      return { valid: false, reason: 'Stripe HMAC signature mismatch' };
    }

    try {
      const parsed = JSON.parse(rawBody || '{}');
      const obj = parsed?.data?.object || {};
      const evType = String(parsed?.type || '').toLowerCase();
      let outcome: 'SETTLED' | 'FAILED' | 'IGNORED' = 'IGNORED';
      if (evType === 'payout.paid') outcome = 'SETTLED';
      else if (evType === 'payout.failed' || evType === 'payout.canceled') outcome = 'FAILED';

      return {
        valid: true,
        event: {
          provider: 'stripe',
          payoutId: obj?.metadata?.sovra_payout_id ? String(obj.metadata.sovra_payout_id) : undefined,
          externalPayoutId: obj?.id ? String(obj.id) : undefined,
          outcome,
          failureReason: obj?.failure_message || obj?.failure_code || undefined,
        },
      };
    } catch {
      return { valid: false, reason: 'Invalid JSON webhook body' };
    }
  }
}

export class RazorpayXPayoutAdapter implements FiatPayoutProvider {
  public readonly name = 'razorpayx' as const;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly accountNumber: string;
  private readonly webhookSecret: string;
  private readonly apiBase: string;
  private readonly fetchFn: FetchLike;

  constructor(opts?: {
    keyId?: string;
    keySecret?: string;
    accountNumber?: string;
    webhookSecret?: string;
    apiBase?: string;
    fetchFn?: FetchLike;
  }) {
    this.keyId = (opts?.keyId ?? process.env.RAZORPAYX_KEY_ID ?? '').trim();
    this.keySecret = (opts?.keySecret ?? process.env.RAZORPAYX_KEY_SECRET ?? '').trim();
    this.accountNumber = (opts?.accountNumber ?? process.env.RAZORPAYX_ACCOUNT_NUMBER ?? '').trim();
    this.webhookSecret = (opts?.webhookSecret ?? process.env.RAZORPAYX_WEBHOOK_SECRET ?? '').trim();
    this.apiBase = (opts?.apiBase ?? process.env.RAZORPAYX_API_BASE ?? 'https://api.razorpay.com').replace(/\/+$/, '');
    this.fetchFn = opts?.fetchFn ?? globalThis.fetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret && this.accountNumber);
  }

  public async createPayout(req: FiatPayoutRequest): Promise<FiatPayoutResponse> {
    if (!this.isConfigured()) {
      return { ok: false, provider: 'razorpayx', status: 'FAILED', error: 'RazorpayX API credentials missing' };
    }
    const minorUnits = Math.max(100, Math.round(req.fiatAmount * 100));
    const basicAuth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    try {
      const resp = await this.fetchFn(`${this.apiBase}/v1/payouts`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
          'X-Payout-Idempotency': req.payoutId,
        },
        body: JSON.stringify({
          account_number: this.accountNumber,
          fund_account_id: req.destinationRef,
          amount: minorUnits,
          currency: req.currency.toUpperCase(),
          mode: req.currency.toUpperCase() === 'INR' ? 'IMPS' : 'NEFT',
          purpose: 'payout',
          reference_id: req.payoutId,
          narration: `Sovra cashout ${req.payoutId}`,
          notes: {
            sovra_payout_id: req.payoutId,
            sovra_user_did: req.userDid,
          },
        }),
      });
      const json = (await resp.json().catch(() => ({}))) as any;
      if (!resp.ok) {
        return {
          ok: false,
          provider: 'razorpayx',
          status: 'FAILED',
          error: json?.error?.description || `RazorpayX HTTP ${resp.status}`,
        };
      }
      const st = String(json?.status || 'queued').toLowerCase();
      return {
        ok: true,
        provider: 'razorpayx',
        externalPayoutId: String(json?.id || `pout_${req.payoutId}`),
        status: st === 'processed' ? 'SETTLED' : 'PENDING_BANK_PAYOUT',
      };
    } catch (err: any) {
      return { ok: false, provider: 'razorpayx', status: 'FAILED', error: err?.message || 'RazorpayX request failed' };
    }
  }

  public verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; reason?: string; event?: ParsedFiatPayoutWebhookEvent } {
    if (!this.webhookSecret) {
      return { valid: false, reason: 'RAZORPAYX_WEBHOOK_SECRET is not configured' };
    }
    const sig = headerValue(headers, 'x-razorpay-signature');
    if (!sig) {
      return { valid: false, reason: 'Missing X-Razorpay-Signature header' };
    }
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    if (!timingSafeHexEqual(expected, sig)) {
      return { valid: false, reason: 'RazorpayX HMAC signature mismatch' };
    }
    try {
      const parsed = JSON.parse(rawBody || '{}');
      const entity = parsed?.payload?.payout?.entity || parsed?.entity || {};
      const evType = String(parsed?.event || '').toLowerCase();
      let outcome: 'SETTLED' | 'FAILED' | 'IGNORED' = 'IGNORED';
      if (evType === 'payout.processed') outcome = 'SETTLED';
      else if (evType === 'payout.failed' || evType === 'payout.reversed' || evType === 'payout.rejected') outcome = 'FAILED';
      return {
        valid: true,
        event: {
          provider: 'razorpayx',
          payoutId: entity?.reference_id ? String(entity.reference_id) : (entity?.notes?.sovra_payout_id ? String(entity.notes.sovra_payout_id) : undefined),
          externalPayoutId: entity?.id ? String(entity.id) : undefined,
          outcome,
          failureReason: entity?.failure_reason || entity?.status_details?.description || undefined,
        },
      };
    } catch {
      return { valid: false, reason: 'Invalid JSON webhook body' };
    }
  }
}

export function resolveFiatPayoutProvider(requestedProvider?: string, fetchFn?: FetchLike): {
  enabled: boolean;
  adapter: FiatPayoutProvider | null;
  code?: string;
  error?: string;
} {
  if (process.env.FIAT_PAYOUT_PROVIDER_ENABLED !== 'true') {
    return {
      enabled: false,
      adapter: null,
      code: 'SANDBOX_DISABLED',
      error: 'ERR_FIAT_GATEWAY_DISABLED: Live fiat settlement requires FIAT_PAYOUT_PROVIDER_ENABLED=true and configured Stripe/RazorpayX credentials',
    };
  }

  const chosen = (requestedProvider || process.env.FIAT_PAYOUT_PROVIDER || 'razorpayx').toLowerCase();
  const adapter: FiatPayoutProvider =
    chosen === 'stripe'
      ? new StripePayoutAdapter({ fetchFn })
      : new RazorpayXPayoutAdapter({ fetchFn });

  if (!adapter.isConfigured()) {
    return {
      enabled: true,
      adapter: null,
      code: 'ERR_FIAT_CREDENTIALS_MISSING',
      error: `ERR_FIAT_CREDENTIALS_MISSING: ${adapter.name} selected with FIAT_PAYOUT_PROVIDER_ENABLED=true but required API credentials are missing`,
    };
  }

  return { enabled: true, adapter };
}
