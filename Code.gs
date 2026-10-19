/**
 * ============================================================================
 * NEWSPAPER DELIVERY AUTOMATION SYSTEM (LEAN STACK)
 * ============================================================================
 * Business Model: 150 Subscribers @ ₹150/month (Gross: ₹22,500/month)
 * Stack: Google Sheets + Google Apps Script + Razorpay API + Meta WhatsApp Cloud API
 * Features:
 *   - Automatic Previous Outstanding Balance (Backlog / Arrears) calculation
 *   - Combined Dynamic UPI / Razorpay Payment Links
 *   - Automated WhatsApp Reminders with Current Fee + Previous Dues breakdown
 *   - Auto-reconciliation via Webhook (clears both current & backlog invoices)
 *   - Cash collection with multi-month backlog clearance
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// CONFIGURATION - Update with your actual credentials
// ----------------------------------------------------------------------------
const CONFIG = {
  // Sheet Names
  SHEET_SUBSCRIBERS: "Subscribers",
  SHEET_LEDGER: "Billing_Ledger",

  // Business Details
  BUSINESS_NAME: "Deepak News Agency, Rewan",
  DEFAULT_MONTHLY_FEE: 150, // in Rupees
  DUE_DAY_OF_MONTH: 5,      // Payment due on 5th of every month

  // Razorpay Credentials (Get from https://dashboard.razorpay.com/app/keys)
  RAZORPAY_KEY_ID: "rzp_live_YOUR_KEY_ID_HERE",
  RAZORPAY_KEY_SECRET: "YOUR_KEY_SECRET_HERE",

  // Meta WhatsApp Cloud API Credentials (Get from https://developers.facebook.com)
  WHATSAPP_PHONE_NUMBER_ID: "YOUR_WHATSAPP_PHONE_NUMBER_ID",
  WHATSAPP_ACCESS_TOKEN: "YOUR_PERMANENT_META_ACCESS_TOKEN",

  // Template Names (Approved under Utility category in Meta WhatsApp Manager)
  TEMPLATE_INVOICE: "monthly_newspaper_bill",
  TEMPLATE_REMINDER: "newspaper_bill_reminder",
  TEMPLATE_RECEIPT: "newspaper_payment_receipt"
};

// ============================================================================
// 1. CUSTOM MENU & CASH PAYMENT HANDLER (FOR SELF-COLLECTION)
// ============================================================================

/**
 * Creates custom dropdown menu in Google Sheets on open.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("📰 Newspaper Billing")
    .addItem("💵 Mark Selected as Paid (Cash)", "markSelectedRowsAsCashPaid")
    .addItem("📲 Send WhatsApp Bill Reminder (Selected Row)", "sendWhatsAppBillForSelectedRow")
    .addSeparator()
    .addItem("🚀 Run 1st-of-Month Billing Batch (All Subs)", "runMonthlyBillingBatch")
    .addItem("⏰ Send Due-Date Reminders (Unpaid Only)", "runDueReminderBatch")
    .addSeparator()
    .addItem("📊 Show Collection Summary", "showCollectionSummary")
    .addToUi();
}

/**
 * Calculates previous unpaid balance (arrears) for a given subscriber up to (not including) a given month.
 */
function getSubscriberPreviousArrears(ledgerSheet, custId, currentYearMonth) {
  const data = ledgerSheet.getDataRange().getValues();
  let totalArrears = 0;
  let unpaidMonths = [];
  let unpaidRows = []; // 1-indexed row numbers in the sheet

  for (let r = 1; r < data.length; r++) {
    const rowCustId = String(data[r][1]).trim();
    const rowMonth = String(data[r][4]).trim();
    const rowStatus = String(data[r][7]).trim();
    const rowAmount = Number(data[r][5]) || 0;

    // Matches customer, is Unpaid, and belongs to a prior billing month
    if (rowCustId === custId && rowStatus === "Unpaid" && rowMonth < currentYearMonth) {
      totalArrears += rowAmount;
      unpaidMonths.push(rowMonth);
      unpaidRows.push(r + 1);
    }
  }

  return {
    totalArrears: totalArrears,
    unpaidMonths: unpaidMonths,
    unpaidRows: unpaidRows,
    count: unpaidMonths.length
  };
}

/**
 * Marks currently selected row(s) in Billing_Ledger as Cash Paid.
 * Detects if the customer has prior unpaid backlog and offers to clear all in 1-click.
 */
function markSelectedRowsAsCashPaid() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  if (sheet.getName() !== CONFIG.SHEET_LEDGER) {
    ui.alert("⚠️ Please switch to the '" + CONFIG.SHEET_LEDGER + "' sheet and select the row(s) to mark as paid.");
    return;
  }

  const selection = sheet.getActiveRange();
  const startRow = selection.getRow();
  const numRows = selection.getNumRows();

  if (startRow === 1) {
    ui.alert("⚠️ Please select a customer row, not the header row.");
    return;
  }

  const now = new Date();
  const cashRef = "CASH-" + Utilities.formatDate(now, "Asia/Kolkata", "yyyyMMdd-HHmm");

  let updatedCount = 0;

  for (let i = 0; i < numRows; i++) {
    const currentRow = startRow + i;
    const invoiceId = sheet.getRange(currentRow, 1).getValue();
    const custId = String(sheet.getRange(currentRow, 2).getValue()).trim();
    const custName = sheet.getRange(currentRow, 3).getValue();
    const phone = String(sheet.getRange(currentRow, 4).getValue());
    const monthStr = sheet.getRange(currentRow, 5).getValue();
    const currentAmount = Number(sheet.getRange(currentRow, 6).getValue()) || 0;
    const currentStatus = sheet.getRange(currentRow, 8).getValue();

    if (currentStatus === "Paid") continue;

    // Check if customer has prior unpaid backlog
    const arrears = getSubscriberPreviousArrears(sheet, custId, monthStr);
    let clearBacklog = false;

    if (arrears.totalArrears > 0) {
      const resp = ui.alert(
        `Arrears Detected: ${custName}`,
        `${custName} (${custId}) has prior unpaid months (${arrears.unpaidMonths.join(", ")}) totaling ₹${arrears.totalArrears}.\n\n` +
        `• Current Month (${monthStr}): ₹${currentAmount}\n` +
        `• Previous Backlog: ₹${arrears.totalArrears}\n` +
        `👉 Total Due: ₹${currentAmount + arrears.totalArrears}\n\n` +
        `Did the customer pay FULL ₹${currentAmount + arrears.totalArrears} in Cash?\n` +
        `Click YES to mark Current + Backlog as Paid.\n` +
        `Click NO to mark ONLY current month as Paid.`,
        ui.ButtonSet.YES_NO_CANCEL
      );

      if (resp === ui.Button.CANCEL) continue;
      clearBacklog = (resp === ui.Button.YES);
    } else {
      const confirmSingle = ui.alert(
        "Confirm Cash Payment",
        `Mark ₹${currentAmount} Cash for ${custName} (${monthStr}) as PAID?`,
        ui.ButtonSet.YES_NO
      );
      if (confirmSingle !== ui.Button.YES) continue;
    }

    // Mark current row as Paid
    sheet.getRange(currentRow, 8).setValue("Paid");
    sheet.getRange(currentRow, 11).setValue(cashRef);
    sheet.getRange(currentRow, 12).setValue(now);
    sheet.getRange(currentRow, 13).setValue("Cash");
    updatedCount++;

    // If clearing backlog, mark all prior unpaid rows as Paid
    let totalCleared = currentAmount;
    if (clearBacklog && arrears.unpaidRows.length > 0) {
      arrears.unpaidRows.forEach(rowNum => {
        sheet.getRange(rowNum, 8).setValue("Paid");
        sheet.getRange(rowNum, 11).setValue(cashRef + "-BACKLOG");
        sheet.getRange(rowNum, 12).setValue(now);
        sheet.getRange(rowNum, 13).setValue("Cash (Cleared with " + monthStr + ")");
        updatedCount++;
      });
      totalCleared += arrears.totalArrears;
    }

    // Prompt for WhatsApp Receipt
    const askReceipt = ui.alert(
      "Send WhatsApp Receipt?",
      `Send WhatsApp payment receipt to ${custName} (${phone}) for ₹${totalCleared}?`,
      ui.ButtonSet.YES_NO
    );
    if (askReceipt === ui.Button.YES && phone) {
      sendWhatsAppPaymentReceipt(phone, custName, totalCleared, monthStr, cashRef, "Cash");
      Utilities.sleep(300);
    }
  }

  ui.alert(`✅ Success: ${updatedCount} invoice record(s) marked as PAID via Cash.`);
}

/**
 * Manually send WhatsApp bill reminder for the currently selected customer row in Billing_Ledger,
 * including previous arrears breakdown.
 */
function sendWhatsAppBillForSelectedRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  if (sheet.getName() !== CONFIG.SHEET_LEDGER) {
    ui.alert("⚠️ Please switch to the '" + CONFIG.SHEET_LEDGER + "' sheet and select a row.");
    return;
  }

  const currentRow = sheet.getActiveRange().getRow();
  if (currentRow === 1) {
    ui.alert("⚠️ Please select a customer row, not the header row.");
    return;
  }

  const invoiceId = sheet.getRange(currentRow, 1).getValue();
  const custId = String(sheet.getRange(currentRow, 2).getValue()).trim();
  const custName = sheet.getRange(currentRow, 3).getValue();
  let phone = String(sheet.getRange(currentRow, 4).getValue()).replace(/[^0-9]/g, "");
  const monthStr = sheet.getRange(currentRow, 5).getValue();
  const currentFee = Number(sheet.getRange(currentRow, 6).getValue()) || CONFIG.DEFAULT_MONTHLY_FEE;
  const dueDateRaw = sheet.getRange(currentRow, 7).getValue();
  const dueDateStr = dueDateRaw ? Utilities.formatDate(new Date(dueDateRaw), "Asia/Kolkata", "dd-MM-yyyy") : "Due Now";
  const status = sheet.getRange(currentRow, 8).getValue();
  let paymentUrl = sheet.getRange(currentRow, 10).getValue();

  if (status === "Paid") {
    ui.alert(`ℹ️ ${custName} is already marked as PAID for ${monthStr}. No reminder needed!`);
    return;
  }

  if (phone.length === 10) phone = "91" + phone;

  // Calculate previous arrears
  const arrears = getSubscriberPreviousArrears(sheet, custId, monthStr);
  const totalPayable = currentFee + arrears.totalArrears;

  // If no payment URL exists or need a fresh link for total amount
  if (!paymentUrl || arrears.totalArrears > 0) {
    const paymentLink = createRazorpayPaymentLink(invoiceId, custId, custName, phone, totalPayable * 100, monthStr, "General", arrears);
    if (paymentLink && paymentLink.short_url) {
      paymentUrl = paymentLink.short_url;
      sheet.getRange(currentRow, 9).setValue(paymentLink.id);
      sheet.getRange(currentRow, 10).setValue(paymentUrl);
    }
  }

  const confirm = ui.alert(
    "Send WhatsApp Reminder?",
    `Customer: ${custName} (${custId})\n` +
    `Phone: +${phone}\n` +
    `• Current Month (${monthStr}): ₹${currentFee}\n` +
    `• Previous Backlog (${arrears.unpaidMonths.join(', ') || 'None'}): ₹${arrears.totalArrears}\n` +
    `👉 Total Payable: ₹${totalPayable}\n\n` +
    `Payment Link: ${paymentUrl || 'Pending Razorpay link'}\n\n` +
    `Send WhatsApp message now?`,
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const result = sendWhatsAppDueReminder(phone, custName, totalPayable, monthStr, dueDateStr, paymentUrl, arrears);
  if (result) {
    sheet.getRange(currentRow, 14).setValue((Number(sheet.getRange(currentRow, 14).getValue()) || 0) + 1);
    sheet.getRange(currentRow, 15).setValue(new Date());
    ui.alert(`✅ WhatsApp reminder successfully sent to ${custName} for ₹${totalPayable}!`);
  } else {
    ui.alert(`⚠️ Note: Meta WhatsApp Cloud API request attempted. If API is offline, use the local dashboard to send via WhatsApp Web with 1 click.`);
  }
}

/**
 * Displays quick collections summary dialog.
 */
function showCollectionSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_LEDGER);
  const ui = SpreadsheetApp.getUi();

  if (!sheet) {
    ui.alert("Ledger sheet not found.");
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    ui.alert("No billing data found.");
    return;
  }

  let totalBilled = 0;
  let totalCollected = 0;
  let paidCount = 0;
  let unpaidCount = 0;
  let upiCount = 0;
  let cashCount = 0;

  for (let r = 1; r < data.length; r++) {
    const amount = Number(data[r][5]) || 0;
    const status = data[r][7];
    const method = data[r][12];

    totalBilled += amount;
    if (status === "Paid") {
      totalCollected += amount;
      paidCount++;
      if (String(method).toLowerCase().includes("cash")) {
        cashCount++;
      } else {
        upiCount++;
      }
    } else {
      unpaidCount++;
    }
  }

  const pendingAmount = totalBilled - totalCollected;
  const collectionRate = totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : 0;

  const summary = 
    `📊 COLLECTION SUMMARY\n` +
    `--------------------------------------\n` +
    `Total Billed: ₹${totalBilled.toLocaleString("en-IN")}\n` +
    `Total Collected: ₹${totalCollected.toLocaleString("en-IN")} (${collectionRate}%)\n` +
    `Pending Balance: ₹${pendingAmount.toLocaleString("en-IN")}\n\n` +
    `✅ Paid Subscribers: ${paidCount} (UPI: ${upiCount}, Cash: ${cashCount})\n` +
    `⏳ Unpaid Subscribers: ${unpaidCount}`;

  ui.alert(summary);
}

// ============================================================================
// 2. TIME-TRIGGERED AUTOMATIONS (1st OF MONTH & DUE DATE)
// ============================================================================

/**
 * TRIGGER: 1st of every month at 07:00 AM
 * Creates monthly invoices, checks previous arrears, generates dynamic Razorpay UPI links,
 * and sends WhatsApp Template A to all active subscribers.
 */
function runMonthlyBillingBatch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const subSheet = ss.getSheetByName(CONFIG.SHEET_SUBSCRIBERS);
  const ledgerSheet = ss.getSheetByName(CONFIG.SHEET_LEDGER);

  if (!subSheet || !ledgerSheet) {
    Logger.log("Missing Subscribers or Billing_Ledger sheet.");
    return;
  }

  const now = new Date();
  const yearMonth = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM");
  const monthName = Utilities.formatDate(now, "Asia/Kolkata", "MMMM yyyy");
  const dueDate = new Date(now.getFullYear(), now.getMonth(), CONFIG.DUE_DAY_OF_MONTH);
  const dueDateStr = Utilities.formatDate(dueDate, "Asia/Kolkata", "dd-MM-yyyy");

  const subData = subSheet.getDataRange().getValues();

  // Row 0 is header: Customer_ID, Full_Name, WhatsApp_Number, Delivery_Address, Route_Code, Newspapers, Monthly_Fee, Account_Status
  for (let i = 1; i < subData.length; i++) {
    const custId = String(subData[i][0]).trim();
    const name = subData[i][1];
    let phone = String(subData[i][2]).replace(/[^0-9]/g, ""); // Clean non-digits
    const address = subData[i][3];
    const route = subData[i][4];
    const fee = Number(subData[i][6]) || CONFIG.DEFAULT_MONTHLY_FEE;
    const status = subData[i][7];

    if (status !== "Active" || !custId) continue;

    // Ensure 91 country code prefix for India
    if (phone.length === 10) phone = "91" + phone;

    const invoiceId = `INV-${yearMonth}-${custId}`;

    // Prevent duplicate bill generation for same month
    if (isInvoiceAlreadyGenerated(ledgerSheet, invoiceId)) {
      Logger.log(`Skipping: Invoice ${invoiceId} already exists.`);
      continue;
    }

    // CHECK PREVIOUS ARREARS
    const arrears = getSubscriberPreviousArrears(ledgerSheet, custId, yearMonth);
    const totalPayable = fee + arrears.totalArrears;
    const amountInPaise = totalPayable * 100;

    // 1. Generate Razorpay Dynamic Payment Link (with totalPayable)
    const paymentLink = createRazorpayPaymentLink(invoiceId, custId, name, phone, amountInPaise, monthName, route, arrears);

    const paymentLinkId = paymentLink ? paymentLink.id : "";
    const paymentUrl = paymentLink ? paymentLink.short_url : "";

    const backlogBreakdown = arrears.totalArrears > 0 
      ? `Current: ₹${fee} + Arrears: ₹${arrears.totalArrears} (${arrears.unpaidMonths.join(', ')})`
      : "None";

    // 2. Append new row into Billing_Ledger
    ledgerSheet.appendRow([
      invoiceId,
      custId,
      name,
      phone,
      yearMonth,
      totalPayable,
      dueDateStr,
      "Unpaid",
      paymentLinkId,
      paymentUrl,
      "", // Payment_ID
      "", // Paid_At
      "", // Payment_Method
      0,  // Reminder_Count
      new Date(), // Last_Notified
      backlogBreakdown // Col 16: Breakdown notes
    ]);

    // 3. Send WhatsApp Invoice (Template A) with Arrears details
    if (paymentUrl) {
      sendWhatsAppInvoiceNotification(phone, name, monthName, custId, fee, arrears, dueDateStr, paymentUrl);
    }

    Utilities.sleep(300); // 300ms pause to ensure polite API request cadence
  }
}

/**
 * TRIGGER: 5th of every month at 09:00 AM (Due Date)
 * Queries all unpaid subscribers and sends WhatsApp reminder including backlog dues.
 */
function runDueReminderBatch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName(CONFIG.SHEET_LEDGER);
  const subSheet = ss.getSheetByName(CONFIG.SHEET_SUBSCRIBERS);
  if (!ledgerSheet) return;

  // Build active status cache from Subscribers sheet
  const activeStatusMap = {};
  if (subSheet) {
    const subData = subSheet.getDataRange().getValues();
    for (let i = 1; i < subData.length; i++) {
      const sId = String(subData[i][0]).trim();
      const sStatus = String(subData[i][7]).trim();
      activeStatusMap[sId] = (sStatus === "Active");
    }
  }

  const now = new Date();
  const yearMonth = Utilities.formatDate(now, "Asia/Kolkata", "yyyy-MM");
  const monthName = Utilities.formatDate(now, "Asia/Kolkata", "MMMM yyyy");
  const data = ledgerSheet.getDataRange().getValues();

  for (let r = 1; r < data.length; r++) {
    const custId = String(data[r][1]).trim();
    const rowMonth = data[r][4];
    const status = data[r][7];
    const reminderCount = Number(data[r][13]) || 0;

    // Skip inactive or stopped subscribers
    if (activeStatusMap[custId] === false) continue;

    // Check if bill is for current month, still unpaid, and received <= 1 reminder
    if (rowMonth === yearMonth && status === "Unpaid" && reminderCount < 2) {
      const custName = data[r][2];
      const phone = String(data[r][3]);
      const amount = Number(data[r][5]) || CONFIG.DEFAULT_MONTHLY_FEE;
      const dueDateRaw = data[r][6];
      const dueDateStr = dueDateRaw ? Utilities.formatDate(new Date(dueDateRaw), "Asia/Kolkata", "dd-MM-yyyy") : "Today";
      const paymentUrl = data[r][9];

      // Check arrears
      const arrears = getSubscriberPreviousArrears(ledgerSheet, custId, yearMonth);

      sendWhatsAppDueReminder(phone, custName, amount, monthName, dueDateStr, paymentUrl, arrears);

      // Increment reminder count and update timestamp
      ledgerSheet.getRange(r + 1, 14).setValue(reminderCount + 1);
      ledgerSheet.getRange(r + 1, 15).setValue(new Date());

      Utilities.sleep(300);
    }
  }
}

function isInvoiceAlreadyGenerated(ledgerSheet, invoiceId) {
  const data = ledgerSheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (data[r][0] === invoiceId) return true;
  }
  return false;
}

// ============================================================================
// 3. RAZORPAY PAYMENT LINK API GENERATOR
// ============================================================================

function createRazorpayPaymentLink(invoiceId, custId, name, phone, amountInPaise, monthName, route, arrears) {
  const url = "https://api.razorpay.com/v1/payment_links";
  const authHeader = "Basic " + Utilities.base64Encode(CONFIG.RAZORPAY_KEY_ID + ":" + CONFIG.RAZORPAY_KEY_SECRET);

  let desc = `Newspaper Subscription - ${monthName}`;
  if (arrears && arrears.totalArrears > 0) {
    desc += ` (incl. ₹${arrears.totalArrears} past balance for ${arrears.unpaidMonths.join(', ')})`;
  }

  const payload = {
    amount: amountInPaise,
    currency: "INR",
    accept_partial: false,
    reference_id: invoiceId,
    description: desc,
    customer: {
      name: name,
      contact: `+${phone}`
    },
    notify: {
      sms: false,
      email: false
    },
    reminder_enable: false,
    notes: {
      customer_id: custId,
      invoice_id: invoiceId,
      route_code: route || "General",
      has_arrears: arrears && arrears.totalArrears > 0 ? "YES" : "NO",
      arrears_amount: arrears ? String(arrears.totalArrears) : "0",
      arrears_months: arrears ? arrears.unpaidMonths.join(",") : ""
    }
  };

  const options = {
    method: "post",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() === 200 || res.getResponseCode() === 201) {
      return JSON.parse(res.getContentText());
    } else {
      Logger.log(`Razorpay Error [${invoiceId}]: ` + res.getContentText());
      return null;
    }
  } catch (err) {
    Logger.log(`Razorpay Request Exception [${invoiceId}]: ` + err.toString());
    return null;
  }
}

// ============================================================================
// 4. REAL-TIME WEBHOOK RECEIVER (POST HANDLER)
// ============================================================================

/**
 * Webhook endpoint for Razorpay 'payment_link.paid'.
 * Deployed as Google Apps Script Web App accessible to "Anyone".
 * Clears current invoice and automatically clears past unpaid arrears!
 */
function doPost(e) {
  try {
    const rawData = e.postData.contents;
    const body = JSON.parse(rawData);

    if (body.event === "payment_link.paid" || body.event === "payment.captured") {
      const plink = body.payload.payment_link ? body.payload.payment_link.entity : null;
      const payment = body.payload.payment ? body.payload.payment.entity : null;

      const invoiceId = (plink && plink.reference_id) ? plink.reference_id : (payment && payment.notes ? payment.notes.invoice_id : null);
      const paymentId = payment ? payment.id : "ONLINE";
      const method = payment && payment.method ? payment.method.toUpperCase() : "UPI";

      if (!invoiceId) {
        return ContentService.createTextOutput(JSON.stringify({ status: "ignored_no_invoice_id" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const ledgerSheet = ss.getSheetByName(CONFIG.SHEET_LEDGER);
      const data = ledgerSheet.getDataRange().getValues();

      let targetCustId = "";
      let targetMonth = "";
      let targetCustName = "";
      let targetPhone = "";
      let targetAmount = 0;

      for (let r = 1; r < data.length; r++) {
        if (data[r][0] === invoiceId) {
          // Columns (1-indexed): Status=8, PayId=11, PaidAt=12, Method=13
          ledgerSheet.getRange(r + 1, 8).setValue("Paid");
          ledgerSheet.getRange(r + 1, 11).setValue(paymentId);
          ledgerSheet.getRange(r + 1, 12).setValue(new Date());
          ledgerSheet.getRange(r + 1, 13).setValue(method);

          targetCustId = String(data[r][1]).trim();
          targetCustName = data[r][2];
          targetPhone = String(data[r][3]);
          targetMonth = data[r][4];
          targetAmount = data[r][5];
          break;
        }
      }

      // AUTO-RECONCILIATION OF PRIOR ARREARS:
      // If payment cleared arrears, also mark any prior unpaid invoices for this subscriber as Paid!
      if (targetCustId && targetMonth) {
        for (let r = 1; r < data.length; r++) {
          const rowCustId = String(data[r][1]).trim();
          const rowMonth = String(data[r][4]).trim();
          const rowStatus = String(data[r][7]).trim();

          if (rowCustId === targetCustId && rowStatus === "Unpaid" && rowMonth < targetMonth) {
            ledgerSheet.getRange(r + 1, 8).setValue("Paid");
            ledgerSheet.getRange(r + 1, 11).setValue(paymentId + "-BACKLOG");
            ledgerSheet.getRange(r + 1, 12).setValue(new Date());
            ledgerSheet.getRange(r + 1, 13).setValue(method + " (Cleared via " + invoiceId + ")");
          }
        }
      }

      // Send Instant Payment Receipt via WhatsApp
      if (targetPhone && targetCustName) {
        sendWhatsAppPaymentReceipt(targetPhone, targetCustName, targetAmount, targetMonth, paymentId, method);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log("Webhook Exception: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================================
// 5. OFFICIAL META WHATSAPP CLOUD API DISPATCHERS
// ============================================================================

function sendWhatsAppMessage(recipientPhone, templateName, components) {
  const url = `https://graph.facebook.com/v21.0/${CONFIG.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: recipientPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en_US" },
      components: components
    }
  };

  const options = {
    method: "post",
    headers: {
      "Authorization": `Bearer ${CONFIG.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    return JSON.parse(res.getContentText());
  } catch (err) {
    Logger.log(`WhatsApp Send Error to ${recipientPhone}: ` + err.toString());
    return null;
  }
}

/**
 * Dispatches Template A (Initial Invoice) with Arrears breakdown
 */
function sendWhatsAppInvoiceNotification(phone, name, monthName, custId, currentFee, arrears, dueDate, paymentUrl) {
  const urlSlug = paymentUrl.replace("https://rzp.io/i/", "").replace("https://rzp.io/l/", "");
  const totalPayable = currentFee + (arrears && arrears.totalArrears ? arrears.totalArrears : 0);

  let amountStr = String(totalPayable);
  if (arrears && arrears.totalArrears > 0) {
    amountStr = `${totalPayable} (Fee: ₹${currentFee} + Past Dues: ₹${arrears.totalArrears})`;
  }

  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: monthName },
        { type: "text", text: name },
        { type: "text", text: CONFIG.BUSINESS_NAME },
        { type: "text", text: custId },
        { type: "text", text: amountStr },
        { type: "text", text: dueDate }
      ]
    },
    {
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: urlSlug }]
    }
  ];
  return sendWhatsAppMessage(phone, CONFIG.TEMPLATE_INVOICE, components);
}

/**
 * Dispatches Template B (Due-Date Reminder) with Arrears breakdown
 */
function sendWhatsAppDueReminder(phone, name, totalAmount, monthName, dueDate, paymentUrl, arrears) {
  let amountStr = String(totalAmount);
  if (arrears && arrears.totalArrears > 0) {
    amountStr = `${totalAmount} (incl. ₹${arrears.totalArrears} past balance)`;
  }

  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: name },
        { type: "text", text: amountStr },
        { type: "text", text: monthName },
        { type: "text", text: dueDate },
        { type: "text", text: paymentUrl },
        { type: "text", text: CONFIG.BUSINESS_NAME }
      ]
    }
  ];
  return sendWhatsAppMessage(phone, CONFIG.TEMPLATE_REMINDER, components);
}

/**
 * Dispatches Template C (Payment Receipt / Confirmation)
 */
function sendWhatsAppPaymentReceipt(phone, name, amount, monthStr, txnId, method) {
  const formattedDate = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd-MMM-yyyy hh:mm a");
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: name },
        { type: "text", text: String(amount) },
        { type: "text", text: monthStr },
        { type: "text", text: txnId },
        { type: "text", text: method },
        { type: "text", text: formattedDate }
      ]
    }
  ];
  return sendWhatsAppMessage(phone, CONFIG.TEMPLATE_RECEIPT, components);
}
