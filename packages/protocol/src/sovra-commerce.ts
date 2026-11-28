import { isValidSovraIdentityId } from '@sovra/identity';
import { Result, err, ok } from '@sovra/shared';
import { InvalidEventError, UnauthorizedOperationError } from './errors.js';
import type { SovraSpecEvent } from './sovra-evt.js';

export interface BusinessRecord {
  readonly businessId: string;
  readonly ownerIdentityId: string;
  readonly name: string;
  readonly category: string;
  readonly catalogueItems: string[];
  readonly createdEventId: string;
  readonly verifiedByFounderAccount: false; // Strictly founder-independent (Section 13)
}

export interface MarketplaceListing {
  readonly listingId: string;
  readonly sellerIdentityId: string;
  readonly title: string;
  readonly kind: 'product' | 'service';
  readonly priceUnits: number;
  readonly currencyOrUnit: string; // Supports fiat/UPI/optional incentives without mandatory token
  availableInventory: number;
  readonly listingEventId: string;
}

export type OrderStatus = 'REQUESTED' | 'ACCEPTED' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';

export interface MarketplaceOrder {
  readonly orderId: string;
  readonly listingId: string;
  readonly buyerIdentityId: string;
  readonly sellerIdentityId: string;
  readonly quantity: number;
  status: OrderStatus;
  readonly paymentRef?: string | undefined;
  readonly historyEventIds: string[];
}

/**
 * Implements Sections 12 & 13 (Sovra Marketplace & Sovra Business) as deterministic
 * signed event state machines with strict inventory & ownership invariants
 * (NEVER resolving conflicting inventory/orders via naive latest-timestamp LWW).
 */
export class SovraCommerceEngine {
  private readonly businesses = new Map<string, BusinessRecord>();
  private readonly listings = new Map<string, MarketplaceListing>();
  private readonly orders = new Map<string, MarketplaceOrder>();

  public processCommerceEvent(
    event: SovraSpecEvent<Record<string, unknown>>,
  ): Result<void, InvalidEventError | UnauthorizedOperationError> {
    if (!isValidSovraIdentityId(event.identity_id)) {
      return err(new InvalidEventError(`Invalid sovra1 identity '${event.identity_id}'`));
    }
    const p = event.payload;

    if (event.event_type === 'business.create') {
      const businessId = String(p['businessId'] || event.event_id);
      if (this.businesses.has(businessId)) {
        return err(new InvalidEventError(`Business '${businessId}' already exists`));
      }
      this.businesses.set(businessId, {
        businessId,
        ownerIdentityId: event.identity_id,
        name: String(p['name'] || 'Community Business'),
        category: String(p['category'] || 'general'),
        catalogueItems: Array.isArray(p['catalogueItems']) ? p['catalogueItems'].map(String) : [],
        createdEventId: event.event_id,
        verifiedByFounderAccount: false,
      });
      return ok(undefined);
    }

    if (event.event_type === 'market.listing') {
      const listingId = String(p['listingId'] || event.event_id);
      const stock = Number(p['availableInventory'] ?? 1);
      if (!Number.isInteger(stock) || stock < 0) {
        return err(new InvalidEventError('Listing inventory must be a non-negative integer'));
      }
      this.listings.set(listingId, {
        listingId,
        sellerIdentityId: event.identity_id,
        title: String(p['title'] || ''),
        kind: p['kind'] === 'service' ? 'service' : 'product',
        priceUnits: Number(p['priceUnits'] ?? 0),
        currencyOrUnit: String(p['currencyOrUnit'] || 'DIRECT'),
        availableInventory: stock,
        listingEventId: event.event_id,
      });
      return ok(undefined);
    }

    if (event.event_type === 'market.order') {
      const orderId = String(p['orderId'] || event.event_id);
      const listingId = String(p['listingId'] || '');
      const quantity = Number(p['quantity'] ?? 1);
      const listing = this.listings.get(listingId);
      if (!listing) return err(new InvalidEventError(`Listing '${listingId}' not found`));
      if (this.orders.has(orderId)) return err(new InvalidEventError(`Order '${orderId}' already exists`));
      if (!Number.isInteger(quantity) || quantity <= 0 || listing.availableInventory < quantity) {
        return err(new InvalidEventError(`Insufficient inventory for listing '${listingId}'`));
      }
      // Atomic reservation: deduct inventory only when valid non-negative invariant holds
      listing.availableInventory -= quantity;
      this.orders.set(orderId, {
        orderId,
        listingId,
        buyerIdentityId: event.identity_id,
        sellerIdentityId: listing.sellerIdentityId,
        quantity,
        status: 'REQUESTED',
        paymentRef: p['paymentRef'] ? String(p['paymentRef']) : undefined,
        historyEventIds: [event.event_id],
      });
      return ok(undefined);
    }

    if (event.event_type === 'market.accept') {
      const orderId = String(p['orderId'] || '');
      const order = this.orders.get(orderId);
      if (!order) return err(new InvalidEventError(`Order '${orderId}' not found`));
      if (order.sellerIdentityId !== event.identity_id) {
        return err(new UnauthorizedOperationError('Only seller may accept an order'));
      }
      if (order.status !== 'REQUESTED') {
        return err(new InvalidEventError(`Order '${orderId}' cannot move from ${order.status} to ACCEPTED`));
      }
      order.status = 'ACCEPTED';
      order.historyEventIds.push(event.event_id);
      return ok(undefined);
    }

    if (event.event_type === 'market.status') {
      const orderId = String(p['orderId'] || '');
      const nextStatus = String(p['status'] || '') as OrderStatus;
      const order = this.orders.get(orderId);
      if (!order) return err(new InvalidEventError(`Order '${orderId}' not found`));
      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
        return err(new InvalidEventError(`Terminal order state '${order.status}' cannot be overwritten`));
      }
      const isSeller = event.identity_id === order.sellerIdentityId;
      const isBuyer = event.identity_id === order.buyerIdentityId;
      if (!isSeller && !isBuyer) {
        return err(new UnauthorizedOperationError('Only buyer or seller may update order status'));
      }
      if (nextStatus === 'DISPATCHED' && (!isSeller || order.status !== 'ACCEPTED')) {
        return err(new InvalidEventError('Only seller may move ACCEPTED order to DISPATCHED'));
      }
      if (nextStatus === 'COMPLETED' && !isBuyer && order.status !== 'DISPATCHED') {
        return err(new InvalidEventError('COMPLETED transition requires buyer or dispatched state'));
      }
      if (nextStatus === 'CANCELLED') {
        const listing = this.listings.get(order.listingId);
        if (listing) listing.availableInventory += order.quantity;
      }
      order.status = nextStatus;
      order.historyEventIds.push(event.event_id);
      return ok(undefined);
    }

    return err(new InvalidEventError(`Unsupported commerce event '${event.event_type}'`));
  }

  public getBusiness(businessId: string): BusinessRecord | undefined {
    return this.businesses.get(businessId);
  }

  public getListing(listingId: string): MarketplaceListing | undefined {
    return this.listings.get(listingId);
  }

  public getOrder(orderId: string): MarketplaceOrder | undefined {
    return this.orders.get(orderId);
  }
}
