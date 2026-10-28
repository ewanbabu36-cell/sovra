import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { PhonyFiErpEngine } from '../../scripts/phonyfi-erp-engine';

describe('PhonyFi Super-ERP God-Level Admin Control System Invariants', () => {
  let db: DatabaseSync;
  let erp: PhonyFiErpEngine;
  const testStorageDir = path.resolve('./.phonyfi-test-erp');
  const dbPath = path.join(testStorageDir, 'test-phonyfi.sqlite');

  beforeEach(() => {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
    fs.mkdirSync(testStorageDir, { recursive: true });
    db = new DatabaseSync(dbPath);
    erp = new PhonyFiErpEngine(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testStorageDir, { recursive: true, force: true });
  });

  // =========================================================================
  // INVARIANT 2: THEFT PREVENTION (5 SHRINKAGE VECTORS)
  // =========================================================================

  it('Shrinkage Vector 1: Void-After-Print must be blocked for cashiers and routed to 4-Eyes Governance', () => {
    // 1. Cashier creates and finalizes an invoice
    const inv = erp.createInvoice({
      storeId: 'STORE_MUMBAI_01',
      cashierId: 'cashier_rahul',
      customerPhone: '+919876543210',
      subtotalInr: 4500.0,
      paymentMode: 'CASH',
      cashierRole: 'STORE_CASHIER',
    });

    const printed = erp.finalizeAndPrintInvoice(inv.invoiceId, 'cashier_rahul');
    expect(printed.status).toBe('FINALIZED_PRINTED');
    expect(printed.printedAt).toBeDefined();

    // 2. Cashier tries to void the printed bill alone (Void-After-Print vector)
    const voidResult = erp.attemptVoidInvoice({
      invoiceId: inv.invoiceId,
      cashierId: 'cashier_rahul',
      role: 'STORE_CASHIER',
      reason: 'Customer walked away claiming change discrepancy',
    });

    expect(voidResult.status).toBe('VOID_REQUESTED_4_EYES');
    expect(voidResult.proposalId).toBeDefined();

    // Verify theft alert was logged
    const alerts = erp.getTheftAlerts();
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const voidAlert = alerts.find(a => a.shrinkageVector === 'VOID_AFTER_PRINT');
    expect(voidAlert).toBeDefined();
    expect(voidAlert?.severity).toBe('CRITICAL');

    // Verify a 4-eyes proposal was generated
    const proposals = erp.getPendingProposals('STORE_MUMBAI_01');
    expect(proposals.length).toBe(1);
    expect(proposals[0].actionType).toBe('VOID_AFTER_PRINT');
    expect(proposals[0].targetResource).toBe(inv.invoiceId);
  });

  it('Shrinkage Vector 2: Discount Skimming must enforce ceiling thresholds and block unapproved discounts', () => {
    // Cashier tries to apply a 15% discount (₹1,500 on ₹10,000 bill) without manager signoff
    expect(() => {
      erp.createInvoice({
        storeId: 'STORE_DELHI_02',
        cashierId: 'cashier_amit',
        customerPhone: '+919988776655',
        subtotalInr: 10000.0,
        discountInr: 1500.0, // 15% > 5% ceiling
        paymentMode: 'CASH',
        cashierRole: 'STORE_CASHIER',
      });
    }).toThrow(/DISCOUNT_SKIMMING_BLOCKED/i);

    // Verify discount skimming alert was registered
    const alerts = erp.getTheftAlerts();
    const skimAlert = alerts.find(a => a.shrinkageVector === 'DISCOUNT_SKIMMING');
    expect(skimAlert).toBeDefined();
    expect(skimAlert?.actorId).toBe('cashier_amit');

    // Legitimate discount within policy (e.g. 4% = ₹400 on ₹10,000) passes
    const validInv = erp.createInvoice({
      storeId: 'STORE_DELHI_02',
      cashierId: 'cashier_amit',
      customerPhone: '+919988776655',
      subtotalInr: 10000.0,
      discountInr: 400.0, // 4% <= 5% ceiling
      paymentMode: 'CASH',
      cashierRole: 'STORE_CASHIER',
    });
    expect(validInv.totalInr).toBe(9600.0);
    expect(validInv.status).toBe('DRAFT');
  });

  it('Shrinkage Vector 3: No-Sale Drawer Pops must require reason and flag excessive pops', () => {
    const shift = erp.openCashDrawerShift({
      storeId: 'STORE_BLR_01',
      cashierId: 'cashier_sneha',
      openingFloatInr: 5000.0,
    });

    // 1. Missing reason throws error
    expect(() => {
      erp.recordDrawerPop({
        storeId: 'STORE_BLR_01',
        cashierId: 'cashier_sneha',
        shiftId: shift.shiftId,
        reason: '   ',
      });
    }).toThrow(/MANDATORY DETAILED REASON REQUIRED/i);

    // 2. Legitimate pops with reasons
    erp.recordDrawerPop({
      storeId: 'STORE_BLR_01',
      cashierId: 'cashier_sneha',
      shiftId: shift.shiftId,
      reason: 'Provided ₹500 change for customer bill',
    });

    erp.recordDrawerPop({
      storeId: 'STORE_BLR_01',
      cashierId: 'cashier_sneha',
      shiftId: shift.shiftId,
      reason: 'Exchanged 5x ₹100 notes for ₹500',
    });

    // 3. Third unassociated pop triggers excessive drawer pop alert
    erp.recordDrawerPop({
      storeId: 'STORE_BLR_01',
      cashierId: 'cashier_sneha',
      shiftId: shift.shiftId,
      reason: 'Checking coin tray level',
    });

    const alerts = erp.getTheftAlerts();
    const popAlert = alerts.find(a => a.shrinkageVector === 'NO_SALE_DRAWER_POP');
    expect(popAlert).toBeDefined();
    expect(popAlert?.severity).toBe('WARNING');
  });

  it('Shrinkage Vector 4: Appraisal Collusion must detect valuation deviance > 15%', () => {
    // System diagnostic valuation for iPhone 14 is ₹35,000
    // Collusive technician attempts to grade it down to ₹25,000 (28.5% deviation)
    const appraisal = erp.submitDeviceAppraisal({
      storeId: 'STORE_HYD_01',
      technicianId: 'tech_vikram',
      customerPhone: '+919123456789',
      imei: '354892019283741',
      brand: 'Apple',
      model: 'iPhone 14 128GB',
      systemEstimatedPriceInr: 35000.0,
      technicianGradedPriceInr: 25000.0,
      grade: 'GRADE_C',
      diagnosticTelemetry: { batteryHealth: 88, displayOem: true, faceId: true },
    });

    expect(appraisal.status).toBe('PENDING_MANAGER_APPROVAL');
    expect(appraisal.variancePct).toBe(28.6);

    const alerts = erp.getTheftAlerts();
    const collusionAlert = alerts.find(a => a.shrinkageVector === 'APPRAISAL_COLLUSION');
    expect(collusionAlert).toBeDefined();
    expect(collusionAlert?.severity).toBe('CRITICAL');
  });

  it('Shrinkage Vector 5: Galla Creep must detect cash discrepancies during blind shift count', () => {
    const shift = erp.openCashDrawerShift({
      storeId: 'STORE_KOL_01',
      cashierId: 'cashier_pooja',
      openingFloatInr: 3000.0,
    });

    // Simulate 2 cash sales of ₹1,500 each -> expected = ₹6,000
    const inv1 = erp.createInvoice({
      storeId: 'STORE_KOL_01',
      cashierId: 'cashier_pooja',
      customerPhone: '+919000000001',
      subtotalInr: 1500.0,
      paymentMode: 'CASH',
    });
    erp.finalizeAndPrintInvoice(inv1.invoiceId, 'cashier_pooja');

    const inv2 = erp.createInvoice({
      storeId: 'STORE_KOL_01',
      cashierId: 'cashier_pooja',
      customerPhone: '+919000000002',
      subtotalInr: 1500.0,
      paymentMode: 'CASH',
    });
    erp.finalizeAndPrintInvoice(inv2.invoiceId, 'cashier_pooja');

    // Cashier declares ₹5,500 (₹500 short) blind
    const closedShift = erp.submitBlindShiftCount({
      shiftId: shift.shiftId,
      cashierId: 'cashier_pooja',
      declaredCashInr: 5500.0,
    });

    expect(closedShift.status).toBe('BLIND_COUNT_SUBMITTED');
    expect(closedShift.systemExpectedCashInr).toBe(6000.0);
    expect(closedShift.varianceInr).toBe(-500.0);

    const alerts = erp.getTheftAlerts();
    const gallaAlert = alerts.find(a => a.shrinkageVector === 'GALLA_CREEP');
    expect(gallaAlert).toBeDefined();
    expect(gallaAlert?.description).toMatch(/Galla Creep Discrepancy/i);
  });

  // =========================================================================
  // INVARIANT 3: FORENSIC HARDWARE CUSTODY (ANTI-CANNIBALIZATION)
  // =========================================================================

  it('Forensic Hardware Custody: should detect unapproved OEM part cannibalization at egress', () => {
    const imei = '862940051928374';

    // 1. Intake device with genuine OEM serials
    const manifest = erp.createHardwareCustodyIntake({
      imei,
      brand: 'Apple',
      model: 'iPhone 13 Pro',
      displaySerial: 'DSP_OEM_APPLE_9921',
      batterySerial: 'BAT_OEM_SONY_4412',
      batteryCycles: 210,
      cameraSerial: 'CAM_OEM_LG_7721',
      logicBoardSerial: 'MLB_APPLE_8831',
      technicianId: 'tech_deepak',
    });

    expect(manifest.custodyStatus).toBe('INTAKE_ACTIVE');
    expect(manifest.intakeFingerprintSha256).toBeDefined();

    // 2. Rogue technician swaps OEM display for cheap copy DSP_FAKE_COPY_001
    const egressResult = erp.verifyHardwareCustodyEgress({
      imei,
      egressDisplaySerial: 'DSP_FAKE_COPY_001', // Swapped without authorization!
      egressBatterySerial: 'BAT_OEM_SONY_4412',
      egressCameraSerial: 'CAM_OEM_LG_7721',
      verifiedBy: 'tech_deepak',
    });

    expect(egressResult.compliant).toBe(false);
    expect(egressResult.manifest.custodyStatus).toBe('CANNIBALIZATION_ALERT');
    expect(egressResult.violations[0]).toMatch(/UNAUTHORIZED_DISPLAY_SWAP/i);

    // Verify fraud alert logged
    const alerts = erp.getTheftAlerts();
    const canAlert = alerts.find(a => a.shrinkageVector === 'HARDWARE_CANNIBALIZATION');
    expect(canAlert).toBeDefined();
    expect(canAlert?.severity).toBe('FRAUD_CONFIRMED');
  });

  it('Forensic Hardware Custody: should allow legitimate part replacement when requisition is approved', () => {
    const imei = '862940051928375';

    erp.createHardwareCustodyIntake({
      imei,
      brand: 'Samsung',
      model: 'Galaxy S23',
      displaySerial: 'DSP_BROKEN_SAM_01',
      batterySerial: 'BAT_OEM_SAM_02',
      batteryCycles: 150,
      cameraSerial: 'CAM_OEM_SAM_03',
      logicBoardSerial: 'MLB_SAM_04',
      technicianId: 'tech_arun',
    });

    // Store manager issues an authorized part requisition ticket for the new display
    erp.issueAuthorizedPartRequisition({
      imei,
      partType: 'DISPLAY',
      oldSerial: 'DSP_BROKEN_SAM_01',
      newSerial: 'DSP_NEW_OEM_SAM_99',
      authorizedBy: 'mgr_karan',
    });

    // Egress scan with authorized new display
    const egress = erp.verifyHardwareCustodyEgress({
      imei,
      egressDisplaySerial: 'DSP_NEW_OEM_SAM_99',
      egressBatterySerial: 'BAT_OEM_SAM_02',
      egressCameraSerial: 'CAM_OEM_SAM_03',
      verifiedBy: 'tech_arun',
    });

    expect(egress.compliant).toBe(true);
    expect(egress.violations.length).toBe(0);
    expect(egress.manifest.custodyStatus).toBe('COMPLIANT_EGRESS');
  });

  // =========================================================================
  // INVARIANT 4: WORKING CAPITAL PROTECTION & GSTR-2B TAX GATE
  // =========================================================================

  it('Working Capital Protection: should surface aging inventory on Dead Capital Radar', () => {
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;

    // Fresh item: 10 days old
    erp.addInventoryItem({
      imeiOrSku: 'SKU_FRESH_IPHONE15',
      title: 'iPhone 15 Black 128GB',
      category: 'DEVICE',
      costPriceInr: 65000.0,
      sellingPriceInr: 72000.0,
      intakeDate: now - 10 * dayMs,
      storeId: 'STORE_MUMBAI_01',
    });

    // Slow moving item: 45 days old
    erp.addInventoryItem({
      imeiOrSku: 'SKU_SLOW_PIXEL7',
      title: 'Google Pixel 7 Snow 128GB',
      category: 'DEVICE',
      costPriceInr: 32000.0,
      sellingPriceInr: 38000.0,
      intakeDate: now - 45 * dayMs,
      storeId: 'STORE_MUMBAI_01',
    });

    // Dead Capital item: 75 days old (>60 days)
    erp.addInventoryItem({
      imeiOrSku: 'SKU_DEAD_ONEPLUS10',
      title: 'OnePlus 10 Pro Green',
      category: 'DEVICE',
      costPriceInr: 40000.0,
      sellingPriceInr: 44000.0,
      intakeDate: now - 75 * dayMs,
      storeId: 'STORE_MUMBAI_01',
    });

    const radar = erp.getDeadCapitalRadar();
    expect(radar.fresh0to30Days.count).toBe(1);
    expect(radar.slowMoving31to60Days.count).toBe(1);
    expect(radar.deadCapitalOver60Days.count).toBe(1);
    expect(radar.deadCapitalOver60Days.totalCostInr).toBe(40000.0);
    expect(radar.totalWorkingCapitalLockedInr).toBe(137000.0);
    expect(radar.recommendedMarkdownLiquidationInr).toBe(34000.0); // 15% markdown
  });

  it('GSTR-2B Tax Reconciliation Gate: should block vendor payout when invoice is not matched', () => {
    // Register vendor invoice for spare parts purchase
    const vinv = erp.registerVendorInvoice({
      vendorId: 'vend_spares_ltd',
      vendorGstin: '27AABCS1429B1Z8',
      invoiceNum: 'INV-2026-9041',
      invoiceAmountInr: 85000.0,
      taxAmountInr: 15300.0,
      gstr2bStatus: 'NOT_FOUND_IN_2B', // Not filed on GST portal!
    });

    // Finance officer attempts payout -> Gate rejects payout!
    expect(() => {
      erp.approveVendorPayout({
        invoiceId: vinv.invoiceId,
        approverId: 'fin_officer_rohit',
        approverRole: 'FINANCE_CONTROLLER',
      });
    }).toThrow(/GSTR_2B_GATE_REJECTION/i);

    // After vendor uploads to GSTR-1 and it appears in GSTR-2B
    erp.updateGstr2bStatus(vinv.invoiceId, 'MATCHED');

    const approved = erp.approveVendorPayout({
      invoiceId: vinv.invoiceId,
      approverId: 'fin_officer_rohit',
      approverRole: 'FINANCE_CONTROLLER',
    });

    expect(approved.approved).toBe(true);
    expect(approved.paymentStatus).toBe('APPROVED_FOR_PAYOUT');
  });

  // =========================================================================
  // INVARIANT 5: 4-EYES GOVERNANCE (DUAL AUTHORIZATION)
  // =========================================================================

  it('4-Eyes Governance: should prohibit requester self-approval and require manager dual-signoff', () => {
    const proposal = erp.createFourEyesProposal({
      actionType: 'INVENTORY_WRITE_OFF',
      requesterId: 'tech_manish',
      requesterRole: 'BENCH_TECHNICIAN',
      storeId: 'STORE_PUNE_01',
      targetResource: 'item_damaged_screen_01',
      payload: { writeOffAmountInr: 12000.0, reason: 'Cracked during ultrasonic cleaning' },
    });

    // 1. Requester tries to self-approve -> Prohibited!
    expect(() => {
      erp.reviewFourEyesProposal({
        proposalId: proposal.proposalId,
        approverId: 'tech_manish', // Self-approval!
        approverRole: 'STORE_MANAGER',
        decision: 'APPROVE',
        reason: 'Approving my own write-off',
      });
    }).toThrow(/4_EYES_VIOLATION: Requester/i);

    // 2. Unauthorized role tries to approve -> Prohibited!
    expect(() => {
      erp.reviewFourEyesProposal({
        proposalId: proposal.proposalId,
        approverId: 'cashier_arjun',
        approverRole: 'STORE_CASHIER', // Not a manager/controller
        decision: 'APPROVE',
        reason: 'Cashier approving write-off',
      });
    }).toThrow(/4_EYES_UNAUTHORIZED/i);

    // 3. Authorized Store Manager approves
    const reviewResult = erp.reviewFourEyesProposal({
      proposalId: proposal.proposalId,
      approverId: 'mgr_sunil',
      approverRole: 'STORE_MANAGER',
      decision: 'APPROVE',
      reason: 'Physical inspection verified irreparable ultrasonic hairline fracture',
    });

    expect(reviewResult.status).toBe('APPROVED');

    // Verify pending list is now empty
    const pending = erp.getPendingProposals('STORE_PUNE_01');
    expect(pending.length).toBe(0);
  });
});
