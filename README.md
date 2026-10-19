# Newspaper Billing & WhatsApp Automation: Setup Guide

This guide walks you through deploying your 100% cloud-hosted billing system for 150 newspaper subscribers at ₹150/month.

---

## 1. Google Sheets Setup

1. Create a new Google Spreadsheet and name it: `Newspaper_Billing_2026`.
2. Rename the default sheet to **`Subscribers`** and create the following headers in Row 1:
   - `A1`: `Customer_ID`
   - `B1`: `Full_Name`
   - `C1`: `WhatsApp_Number` *(e.g. `919876543210`)*
   - `D1`: `Delivery_Address`
   - `E1`: `Route_Code` *(e.g. `Rewan`, `Kakwara`, `Garhwan`)*
   - `F1`: `Newspapers` *(e.g. `TOI + Navbharat Times`)*
   - `G1`: `Monthly_Fee` *(e.g. `150`)*
   - `H1`: `Account_Status` *(Must be `Active`)*
3. Create a second sheet tab named **`Billing_Ledger`** with these headers in Row 1:
   - `A1`: `Invoice_ID`
   - `B1`: `Customer_ID`
   - `C1`: `Customer_Name`
   - `D1`: `WhatsApp_Number`
   - `E1`: `Billing_Month`
   - `F1`: `Amount_Due`
   - `G1`: `Due_Date`
   - `H1`: `Payment_Status`
   - `I1`: `Payment_Link_ID`
   - `J1`: `Payment_URL`
   - `K1`: `Payment_ID`
   - `L1`: `Paid_At`
   - `M1`: `Payment_Method`
   - `N1`: `Reminder_Count`
   - `O1`: `Last_Notified`
   - `P1`: `Backlog_Breakdown` *(e.g. `Current: ₹150 + Arrears: ₹300 (2026-08, 2026-09)`)*

---

## 2. Deploy Google Apps Script

1. In your Google Sheet, click **Extensions** $\rightarrow$ **Apps Script**.
2. Delete any existing boilerplate code and paste the complete code from [`Code.gs`](./Code.gs).
3. Update the credentials in `CONFIG` at the top:
   - `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET`
   - `WHATSAPP_PHONE_NUMBER_ID` & `WHATSAPP_ACCESS_TOKEN`
4. Click **Save** (disk icon).
5. Click **Deploy $\rightarrow$ New Deployment**:
   - **Select type**: Web app (click gear icon).
   - **Description**: `Razorpay Webhook Listener v1`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` *(Crucial: Razorpay servers need access to deliver webhooks)*.
   - Click **Deploy** and authorize permissions.
6. Copy the **Web App URL** (e.g., `https://script.google.com/macros/s/AKfycb.../exec`).

---

## 3. Configure Razorpay Webhook

1. Log in to your [Razorpay Dashboard](https://dashboard.razorpay.com).
2. Go to **Settings $\rightarrow$ Webhooks $\rightarrow$ Add New Webhook**.
3. **Webhook URL**: Paste your Google Apps Script Web App URL from Step 2.
4. **Secret**: Enter any secret phrase you prefer.
5. **Active Events**: Check:
   - `payment_link.paid`
   - `payment.captured`
6. Click **Save**.

---

## 4. Setup Meta WhatsApp Cloud API (Free Tier)

1. Go to [developers.facebook.com](https://developers.facebook.com) and create a developer account.
2. Create an App $\rightarrow$ Select type **Other $\rightarrow$ Business**.
3. In App Dashboard, add the **WhatsApp** product.
4. From the API Setup page, note your **Phone Number ID** and generate an Access Token (create a System User token under Business Settings for a permanent token).
5. In **WhatsApp Manager $\rightarrow$ Message Templates**, create the 3 templates under **Category: Utility**:
   - `monthly_newspaper_bill` (Includes a dynamic URL button for the payment link)
   - `newspaper_bill_reminder`
   - `newspaper_payment_receipt`

---

## 5. Automated Schedules (Triggers)

In your Apps Script editor, click the **Triggers (clock icon)** on the left:
1. **Add Trigger 1 (1st of Month Billing)**:
   - Function: `runMonthlyBillingBatch`
   - Event source: `Time-driven`
   - Type: `Month timer`
   - Day: `1st`
   - Time: `7am to 8am`
2. **Add Trigger 2 (5th of Month Due Reminder)**:
   - Function: `runDueReminderBatch`
   - Event source: `Time-driven`
   - Type: `Month timer`
   - Day: `5th`
   - Time: `9am to 10am`

---

## 6. How to Mark Cash Payments (Self-Collection)

Whenever a customer pays in cash:
1. Open the Google Sheet and go to the **`Billing_Ledger`** tab.
2. Select the customer's row (or multiple rows if multiple people paid).
3. Click the custom top menu: **`📰 Newspaper Billing` $\rightarrow$ `💵 Mark Selected as Paid (Cash)`**.
4. A popup will ask:
   - *Confirm Cash Payment?* $\rightarrow$ Click **Yes**.
   - *Send WhatsApp Receipt?* $\rightarrow$ Click **Yes** (to send an instant confirmation) or **No** (if they don't want a message).
5. The status immediately flips to **Paid**, sets Method to **Cash**, and timestamp is recorded!

---

## 7. How Previous Outstanding Balance (Arrears) Works

Both the **Local Web Dashboard** (`website/index.html`) and the **Google Cloud Backend** (`Code.gs`) automatically detect and calculate previous unpaid months:

1. **Automatic Detection**:
   - The engine scans prior months for each subscriber.
   - If August and September are unpaid and you are in October, the system detects **₹300 backlog**.
2. **Dynamic Razorpay Link / UPI QR**:
   - Instead of billing only ₹150, the bill total is automatically generated for **₹450** (`₹150 current + ₹300 past`).
   - The dynamic UPI QR code on your dashboard also auto-adjusts to ₹450 with 1 click.
3. **WhatsApp Reminder with Clear Breakdown**:
   The customer receives a transparent itemized message:
   ```text
   Namaste Rahul Sharma ji, aapka newspaper subscription bill pending hai:
   • Current Month (Oct): ₹150
   • Pichla Bakaya (Aug, Sep): ₹300
   👉 Kul Rashi (Total Due): ₹450
   Pay via UPI: https://rzp.io/i/...
   - Deepak News Agency, Rewan
   ```
4. **Auto-Reconciliation on Payment**:
   - When the customer pays the ₹450 bill online or in cash, the system automatically marks the current month **and all previous unpaid months as PAID**.

---

## 8. Transaction History & Audit Ledger (`website/index.html`)

The owner dashboard features a dedicated **Transaction History** tab for complete payment tracking:

1. **Transaction Switcher Tab**:
   - Easily switch between **`Subscribers & Delivery Roster`** and **`Transaction History`**.
   - Displays a live badge with the total number of recorded payment transactions.

2. **Full Audit Columns**:
   - **Date & Time**: Exact timestamp of collection (e.g. `19-Oct 2026, 09:15 AM`).
   - **Customer Details**: Name, Customer ID (`NP-101`), Phone number, Delivery Route.
   - **Billing Month**: Associated subscription period (e.g. `September 2026`).
   - **Amount Paid**: Highlighted payment sum (`₹150`, `₹300`, `₹450`, etc.).
   - **Mode of Payment**: Categorized badges for `Cash`, `UPI (GPay)`, `UPI (PhonePe)`, `UPI (Paytm)`, and `Online Webhook`.
   - **Transaction ID / Reference**: Full transaction hash (e.g. `pay_O7rS29t0Uvwxyz`, `CASH-20261003-0845`) with a 1-click clipboard copy button.
   - **WhatsApp Receipt**: 1-click dispatch of official formatted payment receipts with agency branding.

3. **Filtering & Accounting Exports**:
   - Filter transactions instantly by payment mode (`UPI Only` vs. `Cash Only`).
   - Filter by specific billing month or search by Transaction ID, customer name, phone, or route.
   - **Export CSV**: 1-click download of the complete transaction ledger for Excel or accounting software.
   - **Print Ledger**: Clean print format for physical filing.

