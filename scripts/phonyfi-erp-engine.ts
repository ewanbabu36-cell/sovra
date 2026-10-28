import crypto from 'crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export interface PhonyFiInvoice {
  invoiceId: string;
  storeId: string;
  cashierId: string;
  customerPhone: string;
  subtotalInr: number;
  discountInr: number;
  discountPct: number;
  totalInr: number;
  paymentMode: 'CASH' | 'UPI' | 'CARD' | 'SPLIT';
  cashTenderedInr: number;
  changeReturnedInr: number;
  status: 'DRAFT' | 'FINALIZED_PRINTED' | 'VOID_REQUESTED' | 'VOIDED' | 'REFUNDED';
  printedAt?: number;
  voidReason?: string;
  voidApprovedBy?: string;
  voidAt?: number;
  createdAt: number;
}

export interface PhonyFiDrawerPop {
  id: string;
  storeId: string;
  cashierId: string;
  shiftId: string;
  reason: string;
  hasAssociatedSale: boolean;
  invoiceId?: string;
  poppedAt: number;
}

export interface PhonyFiAppraisal {
  appraisalId: string;
  storeId: string;
  technicianId: string;
  customerPhone: string;
  imei: string;
  brand: string;
  model: string;
  systemEstimatedPriceInr: number;
  technicianGradedPriceInr: number;
  grade: 'GRADE_A' | 'GRADE_B' | 'GRADE_C' | 'SCRAP';
  diagnosticTelemetry: any;
  variancePct: number;
  status: 'AUTO_APPROVED' | 'PENDING_MANAGER_APPROVAL' | 'REJECTED' | 'ACCEPTED';
  createdAt: number;
}

export interface PhonyFiCashDrawerShift {
  shiftId: string;
  storeId: string;
  cashierId: string;
  openingFloatInr: number;
  systemExpectedCashInr: number;
  cashierDeclaredCashInr?: number;
  varianceInr?: number;
  status: 'OPEN' | 'BLIND_COUNT_SUBMITTED' | 'AUDITED_CLOSED';
  openedAt: number;
  closedAt?: number;
}

export interface PhonyFiHardwareManifest {
  manifestId: string;
  imei: string;
  brand: string;
  model: string;
  intakeDisplaySerial: string;
  intakeBatterySerial: string;
  intakeBatteryCycles: number;
  intakeCameraSerial: string;
  intakeLogicBoardSerial: string;
  intakeFingerprintSha256: string;
  intakeTechnicianId: string;
  intakeAt: number;
  egressDisplaySerial?: string;
  egressBatterySerial?: string;
  egressCameraSerial?: string;
  egressFingerprintSha256?: string;
  egressVerifiedBy?: string;
  egressAt?: number;
  custodyStatus: 'INTAKE_ACTIVE' | 'COMPLIANT_EGRESS' | 'CANNIBALIZATION_ALERT';
}

export interface PhonyFiInventoryItem {
  itemId: string;
  imeiOrSku: string;
  title: string;
  category: 'DEVICE' | 'OEM_SPARE_PART' | 'ACCESSORY';
  costPriceInr: number;
  sellingPriceInr: number;
  intakeDate: number;
  status: 'IN_STOCK' | 'SOLD' | 'IN_REPAIR' | 'SCRAPPED';
  storeId: string;
}

export interface PhonyFiVendorInvoice {
  invoiceId: string;
  vendorId: string;
  vendorGstin: string;
  invoiceNum: string;
  invoiceDate: number;
  invoiceAmountInr: number;
  taxAmountInr: number;
  gstr2bStatus: 'MATCHED' | 'NOT_FOUND_IN_2B' | 'MISMATCHED' | 'PENDING';
  paymentStatus: 'HOLD_PENDING_2B' | 'APPROVED_FOR_PAYOUT' | 'PAID';
  createdAt: number;
}

export interface PhonyFiFourEyesProposal {
  proposalId: string;
  actionType:
    | 'VOID_AFTER_PRINT'
    | 'DISCRETIONARY_DISCOUNT_OVERRIDE'
    | 'INVENTORY_WRITE_OFF'
    | 'VENDOR_PAYOUT_OVERRIDE'
    | 'APPRAISAL_DEVIATION'
    | 'CANNIBALIZATION_DISMISSAL';
  requesterId: string;
  requesterRole: string;
  storeId: string;
  targetResource: string;
  payload: any;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approverId?: string;
  approverRole?: string;
  approvalReason?: string;
  approvedAt?: number;
  createdAt: number;
  expiresAt: number;
}

export interface PhonyFiTheftAlert {
  alertId: string;
  storeId: string;
  actorId: string;
  actorRole: string;
  shrinkageVector:
    | 'VOID_AFTER_PRINT'
    | 'DISCOUNT_SKIMMING'
    | 'NO_SALE_DRAWER_POP'
    | 'APPRAISAL_COLLUSION'
    | 'GALLA_CREEP'
    | 'HARDWARE_CANNIBALIZATION';
  severity: 'WARNING' | 'CRITICAL' | 'FRAUD_CONFIRMED';
  description: string;
  evidence: any;
  detectedAt: number;
}

export class PhonyFiErpEngine {
  private db: DatabaseSync;
  private stmtCache = new Map<string, StatementSync>();

  constructor(db: DatabaseSync) {
    this.db = db;
    this.initPhonyFiSchema();
  }

  private prepareCached(sql: string): StatementSync {
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  private initPhonyFiSchema(): void {
    this.db.exec(`
      -- 1. POS INVOICES (BILLING & VOID-AFTER-PRINT DEFENSE)
      CREATE TABLE IF NOT EXISTS phonyfi_invoices (
        invoice_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        cashier_id TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        subtotal_inr REAL NOT NULL,
        discount_inr REAL NOT NULL DEFAULT 0.0,
        discount_pct REAL NOT NULL DEFAULT 0.0,
        total_inr REAL NOT NULL,
        payment_mode TEXT NOT NULL,
        cash_tendered_inr REAL DEFAULT 0.0,
        change_returned_inr REAL DEFAULT 0.0,
        status TEXT NOT NULL,
        printed_at INTEGER,
        void_reason TEXT,
        void_approved_by TEXT,
        void_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pfi_store_status ON phonyfi_invoices(store_id, status);

      -- 2. CASH DRAWER POPS (NO-SALE OPEN AUDITING)
      CREATE TABLE IF NOT EXISTS phonyfi_drawer_pops (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        cashier_id TEXT NOT NULL,
        shift_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        has_associated_sale INTEGER NOT NULL DEFAULT 0,
        invoice_id TEXT,
        popped_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pfd_shift ON phonyfi_drawer_pops(shift_id);

      -- 3. DEVICE APPRAISALS (ANTI-COLLUSION TRADE-IN ENGINE)
      CREATE TABLE IF NOT EXISTS phonyfi_device_appraisals (
        appraisal_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        technician_id TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        imei TEXT NOT NULL,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        system_estimated_price_inr REAL NOT NULL,
        technician_graded_price_inr REAL NOT NULL,
        grade TEXT NOT NULL,
        diagnostic_telemetry_json TEXT NOT NULL,
        variance_pct REAL NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pfa_imei ON phonyfi_device_appraisals(imei);

      -- 4. CASH DRAWER SHIFTS (GALLA CREEP & BLIND RECONCILIATION)
      CREATE TABLE IF NOT EXISTS phonyfi_cash_drawers (
        shift_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        cashier_id TEXT NOT NULL,
        opening_float_inr REAL NOT NULL,
        system_expected_cash_inr REAL NOT NULL,
        cashier_declared_cash_inr REAL,
        variance_inr REAL,
        status TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER
      );

      -- 5. FORENSIC HARDWARE CUSTODY MANIFESTS (ANTI-CANNIBALIZATION)
      CREATE TABLE IF NOT EXISTS phonyfi_hardware_custody_manifests (
        manifest_id TEXT PRIMARY KEY,
        imei TEXT UNIQUE NOT NULL,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        intake_display_serial TEXT NOT NULL,
        intake_battery_serial TEXT NOT NULL,
        intake_battery_cycles INTEGER NOT NULL,
        intake_camera_serial TEXT NOT NULL,
        intake_logic_board_serial TEXT NOT NULL,
        intake_fingerprint_sha256 TEXT NOT NULL,
        intake_technician_id TEXT NOT NULL,
        intake_at INTEGER NOT NULL,
        egress_display_serial TEXT,
        egress_battery_serial TEXT,
        egress_camera_serial TEXT,
        egress_fingerprint_sha256 TEXT,
        egress_verified_by TEXT,
        egress_at INTEGER,
        custody_status TEXT NOT NULL
      );

      -- 6. PART REQUISITIONS (AUTHORIZED OEM PART REPLACEMENTS)
      CREATE TABLE IF NOT EXISTS phonyfi_part_requisitions (
        requisition_id TEXT PRIMARY KEY,
        imei TEXT NOT NULL,
        part_type TEXT NOT NULL,
        old_serial TEXT NOT NULL,
        new_serial TEXT NOT NULL,
        authorized_by TEXT NOT NULL,
        authorized_at INTEGER NOT NULL
      );

      -- 7. INVENTORY ITEMS (DEAD CAPITAL RADAR)
      CREATE TABLE IF NOT EXISTS phonyfi_inventory_items (
        item_id TEXT PRIMARY KEY,
        imei_or_sku TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        cost_price_inr REAL NOT NULL,
        selling_price_inr REAL NOT NULL,
        intake_date INTEGER NOT NULL,
        status TEXT NOT NULL,
        store_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pfi_intake ON phonyfi_inventory_items(intake_date);

      -- 8. VENDOR INVOICES & GSTR-2B TAX RECONCILIATION
      CREATE TABLE IF NOT EXISTS phonyfi_vendor_invoices (
        invoice_id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL,
        vendor_gstin TEXT NOT NULL,
        invoice_num TEXT NOT NULL,
        invoice_date INTEGER NOT NULL,
        invoice_amount_inr REAL NOT NULL,
        tax_amount_inr REAL NOT NULL,
        gstr_2b_status TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- 9. 4-EYES DUAL AUTHORIZATION PROPOSALS
      CREATE TABLE IF NOT EXISTS phonyfi_four_eyes_proposals (
        proposal_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        requester_role TEXT NOT NULL,
        store_id TEXT NOT NULL,
        target_resource TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        approver_id TEXT,
        approver_role TEXT,
        approval_reason TEXT,
        approved_at INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pfe_status ON phonyfi_four_eyes_proposals(status);

      -- 10. SHRINKAGE & THEFT ALERTS STREAM
      CREATE TABLE IF NOT EXISTS phonyfi_theft_alerts (
        alert_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        shrinkage_vector TEXT NOT NULL,
        severity TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pft_detected ON phonyfi_theft_alerts(detected_at);
    `);
  }

  // =========================================================================
  // 1. ZERO-TRUST SECURITY: AUDITABLE & ROLE-ISOLATED LOGGING
  // =========================================================================
  public recordTheftAlert(alert: Omit<PhonyFiTheftAlert, 'alertId' | 'detectedAt'>): PhonyFiTheftAlert {
    const alertId = 'alert_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();
    const fullAlert: PhonyFiTheftAlert = {
      ...alert,
      alertId,
      detectedAt: now,
    };

    this.prepareCached(`
      INSERT INTO phonyfi_theft_alerts (alert_id, store_id, actor_id, actor_role, shrinkage_vector, severity, description, evidence_json, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      alertId,
      alert.storeId,
      alert.actorId,
      alert.actorRole,
      alert.shrinkageVector,
      alert.severity,
      alert.description,
      JSON.stringify(alert.evidence || {}),
      now
    );

    return fullAlert;
  }

  public getTheftAlerts(limit = 50): PhonyFiTheftAlert[] {
    try {
      const rows = this.db.prepare('SELECT * FROM phonyfi_theft_alerts ORDER BY detected_at DESC LIMIT ?').all(limit) as any[];
      return rows.map(r => ({
        alertId: r.alert_id,
        storeId: r.store_id,
        actorId: r.actor_id,
        actorRole: r.actor_role,
        shrinkageVector: r.shrinkage_vector,
        severity: r.severity,
        description: r.description,
        evidence: JSON.parse(r.evidence_json || '{}'),
        detectedAt: r.detected_at,
      }));
    } catch (_) {
      return [];
    }
  }

  // =========================================================================
  // 2. THEFT PREVENTION: 5 SHRINKAGE VECTORS
  // =========================================================================

  // VECTOR 1 & 2: POS Invoicing, Discount Skimming & Void-After-Print Guard
  public createInvoice(params: {
    storeId: string;
    cashierId: string;
    customerPhone: string;
    subtotalInr: number;
    discountInr?: number;
    paymentMode: 'CASH' | 'UPI' | 'CARD' | 'SPLIT';
    cashTenderedInr?: number;
    cashierRole?: string;
  }): PhonyFiInvoice {
    const subtotal = Math.round(Number(params.subtotalInr) * 100) / 100;
    const discount = Math.round(Number(params.discountInr || 0) * 100) / 100;
    const discountPct = subtotal > 0 ? Math.round((discount / subtotal) * 1000) / 10 : 0;
    const total = Math.max(0, subtotal - discount);
    const cashierRole = params.cashierRole || 'STORE_CASHIER';

    // SHRINKAGE VECTOR 2: DISCOUNT SKIMMING CEILING
    // If cashier attempts a discount > 5% or > ₹500 without manager authority
    const maxDiscretionaryPct = 5.0;
    const maxDiscretionaryInr = 500.0;

    if ((discountPct > maxDiscretionaryPct || discount > maxDiscretionaryInr) && cashierRole === 'STORE_CASHIER') {
      this.recordTheftAlert({
        storeId: params.storeId,
        actorId: params.cashierId,
        actorRole: cashierRole,
        shrinkageVector: 'DISCOUNT_SKIMMING',
        severity: 'WARNING',
        description: `Cashier attempted unapproved discretionary discount of ₹${discount} (${discountPct}%) on ₹${subtotal} bill.`,
        evidence: { subtotal, discount, discountPct, allowedMaxPct: maxDiscretionaryPct, allowedMaxInr: maxDiscretionaryInr },
      });
      throw new Error(`DISCOUNT_SKIMMING_BLOCKED: Cashier discount exceeds policy ceiling (${maxDiscretionaryPct}% or ₹${maxDiscretionaryInr}). Requires 4-Eyes Manager Dual-Authorization.`);
    }

    const invoiceId = 'inv_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();
    const cashTendered = Number(params.cashTenderedInr || (params.paymentMode === 'CASH' ? total : 0));
    const changeReturned = Math.max(0, cashTendered - total);

    this.prepareCached(`
      INSERT INTO phonyfi_invoices (
        invoice_id, store_id, cashier_id, customer_phone, subtotal_inr, discount_inr, discount_pct,
        total_inr, payment_mode, cash_tendered_inr, change_returned_inr, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)
    `).run(
      invoiceId,
      params.storeId,
      params.cashierId,
      params.customerPhone,
      subtotal,
      discount,
      discountPct,
      total,
      params.paymentMode,
      cashTendered,
      changeReturned,
      now
    );

    return {
      invoiceId,
      storeId: params.storeId,
      cashierId: params.cashierId,
      customerPhone: params.customerPhone,
      subtotalInr: subtotal,
      discountInr: discount,
      discountPct,
      totalInr: total,
      paymentMode: params.paymentMode,
      cashTenderedInr: cashTendered,
      changeReturnedInr: changeReturned,
      status: 'DRAFT',
      createdAt: now,
    };
  }

  public finalizeAndPrintInvoice(invoiceId: string, cashierId: string): PhonyFiInvoice {
    const row = this.db.prepare('SELECT * FROM phonyfi_invoices WHERE invoice_id = ?').get(invoiceId) as any;
    if (!row) throw new Error(`Invoice ${invoiceId} not found`);
    if (row.status !== 'DRAFT') throw new Error(`Invoice ${invoiceId} is already in state ${row.status}`);

    const now = Date.now();
    this.prepareCached('UPDATE phonyfi_invoices SET status = ?, printed_at = ? WHERE invoice_id = ?')
      .run('FINALIZED_PRINTED', now, invoiceId);

    // If cash payment, update cash drawer expected collection
    if (row.payment_mode === 'CASH') {
      try {
        this.prepareCached("UPDATE phonyfi_cash_drawers SET system_expected_cash_inr = system_expected_cash_inr + ? WHERE store_id = ? AND status = 'OPEN'")
          .run(row.total_inr, row.store_id);
      } catch (_) {}
    }

    return {
      invoiceId: row.invoice_id,
      storeId: row.store_id,
      cashierId: row.cashier_id,
      customerPhone: row.customer_phone,
      subtotalInr: row.subtotal_inr,
      discountInr: row.discount_inr,
      discountPct: row.discount_pct,
      totalInr: row.total_inr,
      paymentMode: row.payment_mode,
      cashTenderedInr: row.cash_tendered_inr,
      changeReturnedInr: row.change_returned_inr,
      status: 'FINALIZED_PRINTED',
      printedAt: now,
      createdAt: row.created_at,
    };
  }

  // SHRINKAGE VECTOR 1: VOID-AFTER-PRINT PREVENTATIVE GATE
  public attemptVoidInvoice(params: {
    invoiceId: string;
    cashierId: string;
    role: string;
    reason: string;
    ipAddress?: string;
  }): { status: 'VOID_REQUESTED_4_EYES' | 'VOIDED'; proposalId?: string } {
    const row = this.db.prepare('SELECT * FROM phonyfi_invoices WHERE invoice_id = ?').get(params.invoiceId) as any;
    if (!row) throw new Error(`Invoice ${params.invoiceId} not found`);

    if (row.status === 'DRAFT') {
      // Unprinted draft can be discarded directly
      this.prepareCached("UPDATE phonyfi_invoices SET status = 'VOIDED', void_reason = ?, void_at = ? WHERE invoice_id = ?")
        .run(params.reason, Date.now(), params.invoiceId);
      return { status: 'VOIDED' };
    }

    if (row.status === 'FINALIZED_PRINTED') {
      // THEFT PREVENTATIVE GATE: Cashier cannot void a printed bill alone
      this.recordTheftAlert({
        storeId: row.store_id,
        actorId: params.cashierId,
        actorRole: params.role,
        shrinkageVector: 'VOID_AFTER_PRINT',
        severity: 'CRITICAL',
        description: `Attempted Void-After-Print on Invoice ${params.invoiceId} for ₹${row.total_inr}. Routed to 4-Eyes Dual Authorization.`,
        evidence: { invoiceId: params.invoiceId, totalInr: row.total_inr, cashierId: params.cashierId, reason: params.reason },
      });

      this.prepareCached("UPDATE phonyfi_invoices SET status = 'VOID_REQUESTED', void_reason = ? WHERE invoice_id = ?")
        .run(params.reason, params.invoiceId);

      // Create 4-Eyes Proposal
      const proposal = this.createFourEyesProposal({
        actionType: 'VOID_AFTER_PRINT',
        requesterId: params.cashierId,
        requesterRole: params.role,
        storeId: row.store_id,
        targetResource: params.invoiceId,
        payload: { invoiceId: params.invoiceId, totalInr: row.total_inr, reason: params.reason },
      });

      return { status: 'VOID_REQUESTED_4_EYES', proposalId: proposal.proposalId };
    }

    throw new Error(`Cannot void invoice in status ${row.status}`);
  }

  // SHRINKAGE VECTOR 3: NO-SALE DRAWER POPS AUDITING
  public recordDrawerPop(params: {
    storeId: string;
    cashierId: string;
    shiftId: string;
    reason: string;
    hasAssociatedSale?: boolean;
    invoiceId?: string;
  }): PhonyFiDrawerPop {
    if (!params.reason || params.reason.trim().length < 4) {
      throw new Error('NO_SALE_POP_BLOCKED: Mandatory detailed reason required to pop cash drawer.');
    }

    const id = 'pop_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();
    const hasSale = params.hasAssociatedSale ? 1 : 0;

    this.prepareCached(`
      INSERT INTO phonyfi_drawer_pops (id, store_id, cashier_id, shift_id, reason, has_associated_sale, invoice_id, popped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.storeId, params.cashierId, params.shiftId, params.reason.trim(), hasSale, params.invoiceId || null, now);

    // Audit unassociated pops in this shift
    const unassociatedCount = (this.db.prepare('SELECT COUNT(*) as c FROM phonyfi_drawer_pops WHERE shift_id = ? AND has_associated_sale = 0').get(params.shiftId) as any)?.c || 0;

    if (unassociatedCount > 2 && hasSale === 0) {
      this.recordTheftAlert({
        storeId: params.storeId,
        actorId: params.cashierId,
        actorRole: 'STORE_CASHIER',
        shrinkageVector: 'NO_SALE_DRAWER_POP',
        severity: 'WARNING',
        description: `Excessive No-Sale drawer pops detected in shift ${params.shiftId} (${unassociatedCount} unassociated pops). Potential cash siphoning.`,
        evidence: { shiftId: params.shiftId, unassociatedCount, latestReason: params.reason },
      });
    }

    return {
      id,
      storeId: params.storeId,
      cashierId: params.cashierId,
      shiftId: params.shiftId,
      reason: params.reason,
      hasAssociatedSale: Boolean(hasSale),
      invoiceId: params.invoiceId,
      poppedAt: now,
    };
  }

  // SHRINKAGE VECTOR 4: APPRAISAL COLLUSION TRADE-IN ENGINE
  public submitDeviceAppraisal(params: {
    storeId: string;
    technicianId: string;
    customerPhone: string;
    imei: string;
    brand: string;
    model: string;
    systemEstimatedPriceInr: number;
    technicianGradedPriceInr: number;
    grade: 'GRADE_A' | 'GRADE_B' | 'GRADE_C' | 'SCRAP';
    diagnosticTelemetry: any;
  }): PhonyFiAppraisal {
    const sysPrice = Math.round(Number(params.systemEstimatedPriceInr) * 100) / 100;
    const techPrice = Math.round(Number(params.technicianGradedPriceInr) * 100) / 100;
    const variancePct = sysPrice > 0 ? Math.round((Math.abs(techPrice - sysPrice) / sysPrice) * 1000) / 10 : 0;
    const now = Date.now();
    const appraisalId = 'appr_' + crypto.randomUUID().slice(0, 10);

    // If technician deviance is > 15%, flag potential appraisal collusion
    let status: 'AUTO_APPROVED' | 'PENDING_MANAGER_APPROVAL' = 'AUTO_APPROVED';
    if (variancePct > 15.0) {
      status = 'PENDING_MANAGER_APPROVAL';
      this.recordTheftAlert({
        storeId: params.storeId,
        actorId: params.technicianId,
        actorRole: 'BENCH_TECHNICIAN',
        shrinkageVector: 'APPRAISAL_COLLUSION',
        severity: 'CRITICAL',
        description: `Appraisal Collusion Risk: Graded price (₹${techPrice}) deviates by ${variancePct}% from system diagnostic valuation (₹${sysPrice}) for ${params.brand} ${params.model} [${params.imei}].`,
        evidence: { imei: params.imei, sysPrice, techPrice, variancePct, grade: params.grade },
      });

      this.createFourEyesProposal({
        actionType: 'APPRAISAL_DEVIATION',
        requesterId: params.technicianId,
        requesterRole: 'BENCH_TECHNICIAN',
        storeId: params.storeId,
        targetResource: appraisalId,
        payload: { imei: params.imei, sysPrice, techPrice, variancePct, grade: params.grade },
      });
    }

    this.prepareCached(`
      INSERT INTO phonyfi_device_appraisals (
        appraisal_id, store_id, technician_id, customer_phone, imei, brand, model,
        system_estimated_price_inr, technician_graded_price_inr, grade, diagnostic_telemetry_json,
        variance_pct, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      appraisalId,
      params.storeId,
      params.technicianId,
      params.customerPhone,
      params.imei,
      params.brand,
      params.model,
      sysPrice,
      techPrice,
      params.grade,
      JSON.stringify(params.diagnosticTelemetry || {}),
      variancePct,
      status,
      now
    );

    return {
      appraisalId,
      storeId: params.storeId,
      technicianId: params.technicianId,
      customerPhone: params.customerPhone,
      imei: params.imei,
      brand: params.brand,
      model: params.model,
      systemEstimatedPriceInr: sysPrice,
      technicianGradedPriceInr: techPrice,
      grade: params.grade,
      diagnosticTelemetry: params.diagnosticTelemetry,
      variancePct,
      status,
      createdAt: now,
    };
  }

  // SHRINKAGE VECTOR 5: GALLA CREEP (BLIND SHIFT CLOSE RECONCILIATION)
  public openCashDrawerShift(params: {
    storeId: string;
    cashierId: string;
    openingFloatInr: number;
  }): PhonyFiCashDrawerShift {
    const shiftId = 'shift_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();
    const openingFloat = Math.round(Number(params.openingFloatInr) * 100) / 100;

    this.prepareCached(`
      INSERT INTO phonyfi_cash_drawers (shift_id, store_id, cashier_id, opening_float_inr, system_expected_cash_inr, status, opened_at)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
    `).run(shiftId, params.storeId, params.cashierId, openingFloat, openingFloat, now);

    return {
      shiftId,
      storeId: params.storeId,
      cashierId: params.cashierId,
      openingFloatInr: openingFloat,
      systemExpectedCashInr: openingFloat,
      status: 'OPEN',
      openedAt: now,
    };
  }

  public submitBlindShiftCount(params: {
    shiftId: string;
    cashierId: string;
    declaredCashInr: number;
  }): PhonyFiCashDrawerShift {
    const row = this.db.prepare('SELECT * FROM phonyfi_cash_drawers WHERE shift_id = ?').get(params.shiftId) as any;
    if (!row) throw new Error(`Shift ${params.shiftId} not found`);
    if (row.status !== 'OPEN') throw new Error(`Shift ${params.shiftId} is already ${row.status}`);

    const declared = Math.round(Number(params.declaredCashInr) * 100) / 100;
    const expected = Number(row.system_expected_cash_inr);
    const variance = Math.round((declared - expected) * 100) / 100;
    const now = Date.now();

    // If variance is more than ₹100, trigger Galla Creep alert
    if (Math.abs(variance) > 100.0) {
      this.recordTheftAlert({
        storeId: row.store_id,
        actorId: params.cashierId,
        actorRole: 'STORE_CASHIER',
        shrinkageVector: 'GALLA_CREEP',
        severity: Math.abs(variance) > 1000 ? 'CRITICAL' : 'WARNING',
        description: `Galla Creep Discrepancy: Blind count entered ₹${declared} vs system expected ₹${expected} (Variance: ₹${variance}).`,
        evidence: { shiftId: params.shiftId, declared, expected, varianceInr: variance },
      });
    }

    this.prepareCached(`
      UPDATE phonyfi_cash_drawers
      SET cashier_declared_cash_inr = ?, variance_inr = ?, status = 'BLIND_COUNT_SUBMITTED', closed_at = ?
      WHERE shift_id = ?
    `).run(declared, variance, now, params.shiftId);

    return {
      shiftId: row.shift_id,
      storeId: row.store_id,
      cashierId: row.cashier_id,
      openingFloatInr: row.opening_float_inr,
      systemExpectedCashInr: expected,
      cashierDeclaredCashInr: declared,
      varianceInr: variance,
      status: 'BLIND_COUNT_SUBMITTED',
      openedAt: row.opened_at,
      closedAt: now,
    };
  }

  // =========================================================================
  // 3. FORENSIC HARDWARE CUSTODY: CRYPTOGRAPHIC PART CUSTODY & ANTI-CANNIBALIZATION
  // =========================================================================
  public createHardwareCustodyIntake(params: {
    imei: string;
    brand: string;
    model: string;
    displaySerial: string;
    batterySerial: string;
    batteryCycles: number;
    cameraSerial: string;
    logicBoardSerial: string;
    technicianId: string;
  }): PhonyFiHardwareManifest {
    const manifestId = 'cust_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();

    // Compute cryptographic intake fingerprint
    const fingerprintInput = `${params.imei}|${params.displaySerial}|${params.batterySerial}|${params.cameraSerial}|${params.logicBoardSerial}|${now}`;
    const fingerprintSha256 = crypto.createHash('sha256').update(fingerprintInput).digest('hex');

    this.prepareCached(`
      INSERT INTO phonyfi_hardware_custody_manifests (
        manifest_id, imei, brand, model, intake_display_serial, intake_battery_serial,
        intake_battery_cycles, intake_camera_serial, intake_logic_board_serial,
        intake_fingerprint_sha256, intake_technician_id, intake_at, custody_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INTAKE_ACTIVE')
    `).run(
      manifestId,
      params.imei,
      params.brand,
      params.model,
      params.displaySerial,
      params.batterySerial,
      params.batteryCycles,
      params.cameraSerial,
      params.logicBoardSerial,
      fingerprintSha256,
      params.technicianId,
      now
    );

    return {
      manifestId,
      imei: params.imei,
      brand: params.brand,
      model: params.model,
      intakeDisplaySerial: params.displaySerial,
      intakeBatterySerial: params.batterySerial,
      intakeBatteryCycles: params.batteryCycles,
      intakeCameraSerial: params.cameraSerial,
      intakeLogicBoardSerial: params.logicBoardSerial,
      intakeFingerprintSha256: fingerprintSha256,
      intakeTechnicianId: params.technicianId,
      intakeAt: now,
      custodyStatus: 'INTAKE_ACTIVE',
    };
  }

  public issueAuthorizedPartRequisition(params: {
    imei: string;
    partType: 'DISPLAY' | 'BATTERY' | 'CAMERA';
    oldSerial: string;
    newSerial: string;
    authorizedBy: string;
  }): { requisitionId: string; imei: string; partType: string; newSerial: string } {
    const requisitionId = 'req_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();

    this.prepareCached(`
      INSERT INTO phonyfi_part_requisitions (requisition_id, imei, part_type, old_serial, new_serial, authorized_by, authorized_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(requisitionId, params.imei, params.partType, params.oldSerial, params.newSerial, params.authorizedBy, now);

    return {
      requisitionId,
      imei: params.imei,
      partType: params.partType,
      newSerial: params.newSerial,
    };
  }

  public verifyHardwareCustodyEgress(params: {
    imei: string;
    egressDisplaySerial: string;
    egressBatterySerial: string;
    egressCameraSerial: string;
    verifiedBy: string;
    storeId?: string;
  }): { compliant: boolean; manifest: PhonyFiHardwareManifest; violations: string[] } {
    const row = this.db.prepare('SELECT * FROM phonyfi_hardware_custody_manifests WHERE imei = ?').get(params.imei) as any;
    if (!row) throw new Error(`No hardware custody manifest found for IMEI ${params.imei}`);

    const violations: string[] = [];

    // Helper to check if a replacement was authorized
    const isAuthorized = (partType: string, oldSerial: string, newSerial: string): boolean => {
      if (oldSerial === newSerial) return true;
      const req = this.db.prepare('SELECT requisition_id FROM phonyfi_part_requisitions WHERE imei = ? AND part_type = ? AND new_serial = ?').get(params.imei, partType, newSerial) as any;
      return Boolean(req);
    };

    if (row.intake_display_serial !== params.egressDisplaySerial && !isAuthorized('DISPLAY', row.intake_display_serial, params.egressDisplaySerial)) {
      violations.push(`UNAUTHORIZED_DISPLAY_SWAP: Intake OEM serial ${row.intake_display_serial} replaced by unapproved ${params.egressDisplaySerial}`);
    }
    if (row.intake_battery_serial !== params.egressBatterySerial && !isAuthorized('BATTERY', row.intake_battery_serial, params.egressBatterySerial)) {
      violations.push(`UNAUTHORIZED_BATTERY_SWAP: Intake OEM serial ${row.intake_battery_serial} replaced by unapproved ${params.egressBatterySerial}`);
    }
    if (row.intake_camera_serial !== params.egressCameraSerial && !isAuthorized('CAMERA', row.intake_camera_serial, params.egressCameraSerial)) {
      violations.push(`UNAUTHORIZED_CAMERA_SWAP: Intake OEM serial ${row.intake_camera_serial} replaced by unapproved ${params.egressCameraSerial}`);
    }

    const now = Date.now();
    const egressFingerprintInput = `${params.imei}|${params.egressDisplaySerial}|${params.egressBatterySerial}|${params.egressCameraSerial}|${row.intake_logic_board_serial}|${now}`;
    const egressFingerprintSha256 = crypto.createHash('sha256').update(egressFingerprintInput).digest('hex');

    const compliant = violations.length === 0;
    const custodyStatus = compliant ? 'COMPLIANT_EGRESS' : 'CANNIBALIZATION_ALERT';

    this.prepareCached(`
      UPDATE phonyfi_hardware_custody_manifests
      SET egress_display_serial = ?, egress_battery_serial = ?, egress_camera_serial = ?,
          egress_fingerprint_sha256 = ?, egress_verified_by = ?, egress_at = ?, custody_status = ?
      WHERE imei = ?
    `).run(
      params.egressDisplaySerial,
      params.egressBatterySerial,
      params.egressCameraSerial,
      egressFingerprintSha256,
      params.verifiedBy,
      now,
      custodyStatus,
      params.imei
    );

    if (!compliant) {
      this.recordTheftAlert({
        storeId: params.storeId || 'STORE_MAIN',
        actorId: params.verifiedBy,
        actorRole: 'BENCH_TECHNICIAN',
        shrinkageVector: 'HARDWARE_CANNIBALIZATION',
        severity: 'FRAUD_CONFIRMED',
        description: `Hardware Cannibalization Detected on ${row.brand} ${row.model} [${params.imei}]: ${violations.join('; ')}`,
        evidence: { imei: params.imei, violations, intakeManifest: row },
      });
    }

    return {
      compliant,
      violations,
      manifest: {
        manifestId: row.manifest_id,
        imei: row.imei,
        brand: row.brand,
        model: row.model,
        intakeDisplaySerial: row.intake_display_serial,
        intakeBatterySerial: row.intake_battery_serial,
        intakeBatteryCycles: row.intake_battery_cycles,
        intakeCameraSerial: row.intake_camera_serial,
        intakeLogicBoardSerial: row.intake_logic_board_serial,
        intakeFingerprintSha256: row.intake_fingerprint_sha256,
        intakeTechnicianId: row.intake_technician_id,
        intakeAt: row.intake_at,
        egressDisplaySerial: params.egressDisplaySerial,
        egressBatterySerial: params.egressBatterySerial,
        egressCameraSerial: params.egressCameraSerial,
        egressFingerprintSha256,
        egressVerifiedBy: params.verifiedBy,
        egressAt: now,
        custodyStatus,
      },
    };
  }

  // =========================================================================
  // 4. WORKING CAPITAL PROTECTION: DEAD CAPITAL RADAR & GSTR-2B TAX GATE
  // =========================================================================
  public addInventoryItem(params: {
    imeiOrSku: string;
    title: string;
    category: 'DEVICE' | 'OEM_SPARE_PART' | 'ACCESSORY';
    costPriceInr: number;
    sellingPriceInr: number;
    intakeDate?: number;
    storeId: string;
  }): PhonyFiInventoryItem {
    const itemId = 'item_' + crypto.randomUUID().slice(0, 10);
    const intakeDate = params.intakeDate || Date.now();

    this.prepareCached(`
      INSERT OR REPLACE INTO phonyfi_inventory_items (item_id, imei_or_sku, title, category, cost_price_inr, selling_price_inr, intake_date, status, store_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', ?)
    `).run(itemId, params.imeiOrSku, params.title, params.category, params.costPriceInr, params.sellingPriceInr, intakeDate, params.storeId);

    return {
      itemId,
      imeiOrSku: params.imeiOrSku,
      title: params.title,
      category: params.category,
      costPriceInr: params.costPriceInr,
      sellingPriceInr: params.sellingPriceInr,
      intakeDate,
      status: 'IN_STOCK',
      storeId: params.storeId,
    };
  }

  public getDeadCapitalRadar(): {
    fresh0to30Days: { count: number; totalCostInr: number; items: PhonyFiInventoryItem[] };
    slowMoving31to60Days: { count: number; totalCostInr: number; items: PhonyFiInventoryItem[] };
    deadCapitalOver60Days: { count: number; totalCostInr: number; items: PhonyFiInventoryItem[] };
    totalWorkingCapitalLockedInr: number;
    recommendedMarkdownLiquidationInr: number;
  } {
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const rows = this.db.prepare("SELECT * FROM phonyfi_inventory_items WHERE status = 'IN_STOCK'").all() as any[];

    const fresh: PhonyFiInventoryItem[] = [];
    const slow: PhonyFiInventoryItem[] = [];
    const dead: PhonyFiInventoryItem[] = [];

    let freshCost = 0;
    let slowCost = 0;
    let deadCost = 0;

    for (const r of rows) {
      const ageDays = Math.floor((now - Number(r.intake_date)) / dayMs);
      const item: PhonyFiInventoryItem = {
        itemId: r.item_id,
        imeiOrSku: r.imei_or_sku,
        title: r.title,
        category: r.category,
        costPriceInr: Number(r.cost_price_inr),
        sellingPriceInr: Number(r.selling_price_inr),
        intakeDate: Number(r.intake_date),
        status: r.status,
        storeId: r.store_id,
      };

      if (ageDays <= 30) {
        fresh.push(item);
        freshCost += item.costPriceInr;
      } else if (ageDays <= 60) {
        slow.push(item);
        slowCost += item.costPriceInr;
      } else {
        dead.push(item);
        deadCost += item.costPriceInr;
      }
    }

    return {
      fresh0to30Days: { count: fresh.length, totalCostInr: Math.round(freshCost * 100) / 100, items: fresh },
      slowMoving31to60Days: { count: slow.length, totalCostInr: Math.round(slowCost * 100) / 100, items: slow },
      deadCapitalOver60Days: { count: dead.length, totalCostInr: Math.round(deadCost * 100) / 100, items: dead },
      totalWorkingCapitalLockedInr: Math.round((freshCost + slowCost + deadCost) * 100) / 100,
      recommendedMarkdownLiquidationInr: Math.round(deadCost * 0.85 * 100) / 100, // 15% clearance discount
    };
  }

  // GSTR-2B TAX RECONCILIATION PREVENTATIVE GATE
  public registerVendorInvoice(params: {
    vendorId: string;
    vendorGstin: string;
    invoiceNum: string;
    invoiceAmountInr: number;
    taxAmountInr: number;
    gstr2bStatus?: 'MATCHED' | 'NOT_FOUND_IN_2B' | 'MISMATCHED' | 'PENDING';
  }): PhonyFiVendorInvoice {
    const invoiceId = 'vinv_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();
    const gstrStatus = params.gstr2bStatus || 'PENDING';

    this.prepareCached(`
      INSERT INTO phonyfi_vendor_invoices (
        invoice_id, vendor_id, vendor_gstin, invoice_num, invoice_date,
        invoice_amount_inr, tax_amount_inr, gstr_2b_status, payment_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'HOLD_PENDING_2B', ?)
    `).run(
      invoiceId,
      params.vendorId,
      params.vendorGstin,
      params.invoiceNum,
      now,
      params.invoiceAmountInr,
      params.taxAmountInr,
      gstrStatus,
      now
    );

    return {
      invoiceId,
      vendorId: params.vendorId,
      vendorGstin: params.vendorGstin,
      invoiceNum: params.invoiceNum,
      invoiceDate: now,
      invoiceAmountInr: params.invoiceAmountInr,
      taxAmountInr: params.taxAmountInr,
      gstr2bStatus: gstrStatus,
      paymentStatus: 'HOLD_PENDING_2B',
      createdAt: now,
    };
  }

  public updateGstr2bStatus(invoiceId: string, status: 'MATCHED' | 'NOT_FOUND_IN_2B' | 'MISMATCHED'): void {
    this.prepareCached('UPDATE phonyfi_vendor_invoices SET gstr_2b_status = ? WHERE invoice_id = ?').run(status, invoiceId);
  }

  public approveVendorPayout(params: {
    invoiceId: string;
    approverId: string;
    approverRole: string;
    isOverride?: boolean;
  }): { approved: boolean; paymentStatus: string; error?: string } {
    const row = this.db.prepare('SELECT * FROM phonyfi_vendor_invoices WHERE invoice_id = ?').get(params.invoiceId) as any;
    if (!row) throw new Error(`Vendor invoice ${params.invoiceId} not found`);

    // GSTR-2B PREVENTATIVE GATE: Prevent payout if vendor invoice not matched in GSTR-2B
    if (row.gstr_2b_status !== 'MATCHED' && !params.isOverride) {
      throw new Error(`GSTR_2B_GATE_REJECTION: Vendor invoice ${row.invoice_num} is '${row.gstr_2b_status}'. Payout blocked to prevent ITC (Input Tax Credit) loss. Requires 4-Eyes Governance override.`);
    }

    this.prepareCached("UPDATE phonyfi_vendor_invoices SET payment_status = 'APPROVED_FOR_PAYOUT' WHERE invoice_id = ?").run(params.invoiceId);

    return { approved: true, paymentStatus: 'APPROVED_FOR_PAYOUT' };
  }

  // =========================================================================
  // 5. 4-EYES GOVERNANCE: DUAL AUTHORIZATION ENGINE
  // =========================================================================
  public createFourEyesProposal(params: {
    actionType: PhonyFiFourEyesProposal['actionType'];
    requesterId: string;
    requesterRole: string;
    storeId: string;
    targetResource: string;
    payload: any;
    ttlMinutes?: number;
  }): PhonyFiFourEyesProposal {
    const proposalId = 'prop_' + crypto.randomUUID().slice(0, 10);
    const now = Date.now();
    const expiresAt = now + (params.ttlMinutes || 120) * 60 * 1000;

    this.prepareCached(`
      INSERT INTO phonyfi_four_eyes_proposals (
        proposal_id, action_type, requester_id, requester_role, store_id, target_resource,
        payload_json, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(
      proposalId,
      params.actionType,
      params.requesterId,
      params.requesterRole,
      params.storeId,
      params.targetResource,
      JSON.stringify(params.payload || {}),
      now,
      expiresAt
    );

    return {
      proposalId,
      actionType: params.actionType,
      requesterId: params.requesterId,
      requesterRole: params.requesterRole,
      storeId: params.storeId,
      targetResource: params.targetResource,
      payload: params.payload,
      status: 'PENDING',
      createdAt: now,
      expiresAt,
    };
  }

  public getPendingProposals(storeId?: string): PhonyFiFourEyesProposal[] {
    try {
      let rows: any[] = [];
      if (storeId) {
        rows = this.db.prepare("SELECT * FROM phonyfi_four_eyes_proposals WHERE status = 'PENDING' AND store_id = ? ORDER BY created_at DESC").all(storeId) as any[];
      } else {
        rows = this.db.prepare("SELECT * FROM phonyfi_four_eyes_proposals WHERE status = 'PENDING' ORDER BY created_at DESC").all() as any[];
      }

      return rows.map(r => ({
        proposalId: r.proposal_id,
        actionType: r.action_type,
        requesterId: r.requester_id,
        requesterRole: r.requester_role,
        storeId: r.store_id,
        targetResource: r.target_resource,
        payload: JSON.parse(r.payload_json || '{}'),
        status: r.status,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    } catch (_) {
      return [];
    }
  }

  public reviewFourEyesProposal(params: {
    proposalId: string;
    approverId: string;
    approverRole: string;
    decision: 'APPROVE' | 'REJECT';
    reason: string;
  }): { proposalId: string; status: 'APPROVED' | 'REJECTED'; executed: boolean } {
    const row = this.db.prepare('SELECT * FROM phonyfi_four_eyes_proposals WHERE proposal_id = ?').get(params.proposalId) as any;
    if (!row) throw new Error(`Proposal ${params.proposalId} not found`);
    if (row.status !== 'PENDING') throw new Error(`Proposal ${params.proposalId} is already ${row.status}`);

    // DUAL AUTHORIZATION INVARIANT: Requester cannot self-approve
    if (row.requester_id === params.approverId) {
      throw new Error(`4_EYES_VIOLATION: Requester (${params.approverId}) cannot self-approve their own high-risk mutation.`);
    }

    // Role verification: Must have manager or controller role
    const authorizedRoles = ['STORE_MANAGER', 'FINANCE_CONTROLLER', 'SUPER_ADMIN'];
    if (!authorizedRoles.includes(params.approverRole)) {
      throw new Error(`4_EYES_UNAUTHORIZED: Role ${params.approverRole} is not authorized for 4-Eyes dual signoff.`);
    }

    const now = Date.now();
    const newStatus = params.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    this.prepareCached(`
      UPDATE phonyfi_four_eyes_proposals
      SET status = ?, approver_id = ?, approver_role = ?, approval_reason = ?, approved_at = ?
      WHERE proposal_id = ?
    `).run(newStatus, params.approverId, params.approverRole, params.reason, now, params.proposalId);

    // If approved, execute mutation
    let executed = false;
    if (params.decision === 'APPROVE') {
      const payload = JSON.parse(row.payload_json || '{}');
      if (row.action_type === 'VOID_AFTER_PRINT') {
        this.prepareCached("UPDATE phonyfi_invoices SET status = 'VOIDED', void_approved_by = ?, void_at = ? WHERE invoice_id = ?")
          .run(params.approverId, now, row.target_resource);
        executed = true;
      } else if (row.action_type === 'APPRAISAL_DEVIATION') {
        this.prepareCached("UPDATE phonyfi_device_appraisals SET status = 'ACCEPTED' WHERE appraisal_id = ?")
          .run(row.target_resource);
        executed = true;
      } else if (row.action_type === 'VENDOR_PAYOUT_OVERRIDE') {
        this.prepareCached("UPDATE phonyfi_vendor_invoices SET payment_status = 'APPROVED_FOR_PAYOUT' WHERE invoice_id = ?")
          .run(row.target_resource);
        executed = true;
      }
    }

    return { proposalId: params.proposalId, status: newStatus, executed };
  }

  // =========================================================================
  // 6. ENTERPRISE TELEMETRY SUMMARY (FOR GLASSMORPHIC HUD)
  // =========================================================================
  public getEnterpriseTelemetrySummary() {
    const totalInvoices = (this.db.prepare('SELECT COUNT(*) as c FROM phonyfi_invoices').get() as any)?.c || 0;
    const totalVoided = (this.db.prepare("SELECT COUNT(*) as c FROM phonyfi_invoices WHERE status = 'VOIDED'").get() as any)?.c || 0;
    const totalTheftAlerts = (this.db.prepare('SELECT COUNT(*) as c FROM phonyfi_theft_alerts').get() as any)?.c || 0;
    const pendingProposalsCount = (this.db.prepare("SELECT COUNT(*) as c FROM phonyfi_four_eyes_proposals WHERE status = 'PENDING'").get() as any)?.c || 0;
    const activeHardwareManifests = (this.db.prepare("SELECT COUNT(*) as c FROM phonyfi_hardware_custody_manifests WHERE custody_status = 'INTAKE_ACTIVE'").get() as any)?.c || 0;
    const cannibalizationAlerts = (this.db.prepare("SELECT COUNT(*) as c FROM phonyfi_hardware_custody_manifests WHERE custody_status = 'CANNIBALIZATION_ALERT'").get() as any)?.c || 0;
    const deadCapital = this.getDeadCapitalRadar();

    return {
      invoicing: {
        totalInvoices,
        totalVoided,
        voidRatePct: totalInvoices > 0 ? Math.round((totalVoided / totalInvoices) * 1000) / 10 : 0,
      },
      theftDefense: {
        totalTheftAlerts,
        cannibalizationAlerts,
        pendingProposalsCount,
      },
      hardwareCustody: {
        activeManifests: activeHardwareManifests,
        tamperedDevicesCount: cannibalizationAlerts,
      },
      workingCapital: {
        totalLockedInr: deadCapital.totalWorkingCapitalLockedInr,
        deadCapitalOver60DaysInr: deadCapital.deadCapitalOver60Days.totalCostInr,
        deadItemsCount: deadCapital.deadCapitalOver60Days.count,
        recommendedClearanceInr: deadCapital.recommendedMarkdownLiquidationInr,
      },
    };
  }
}
