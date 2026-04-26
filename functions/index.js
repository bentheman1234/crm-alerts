const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const https = require("https");

initializeApp();

const BREVO_API_KEY = "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";
const FROM_EMAIL = "benbenami17@gmail.com";
const FROM_NAME = "מסחר אלגוריתמי";

exports.sendWithdrawalAlerts = onSchedule("0 6 * * *", async (event) => {
  const db = getFirestore();
  const auth = getAuth();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const alertsByOwner = {};
  const customersSnap = await db.collection("customers").get();
  for (const custDoc of customersSnap.docs) {
    const cust = custDoc.data();
    const ownerId = cust.ownerId;
    if (!ownerId) continue;
    const incomeSnap = await db.collection("customers").doc(custDoc.id).collection("income").get();
    for (const incDoc of incomeSnap.docs) {
      const inc = incDoc.data();
      if (inc.status === "חולקה" || inc.status === "נדחתה") continue;
      const lastAlert = inc.lastAlertDate ? new Date(inc.lastAlertDate) : inc.date ? new Date(inc.date + "T00:00:00") : null;
      if (!lastAlert) continue;
      const daysDiff = Math.floor((now - lastAlert) / (1000 * 60 * 60 * 24));
      if (daysDiff >= 3) {
        if (!alertsByOwner[ownerId]) alertsByOwner[ownerId] = [];
        alertsByOwner[ownerId].push({
          customerName: cust.name || "לקוח לא ידוע",
          firm: inc.firm || "—",
          amount: inc.amount || 0,
          status: inc.status || "הוגשה",
          date: inc.date || "—",
          daysSince: daysDiff,
        });
        await incDoc.ref.update({ lastAlertDate: now.toISOString().slice(0, 10) });
      }
    }
  }
  for (const [ownerId, alerts] of Object.entries(alertsByOwner)) {
    try {
      const userRecord = await auth.getUser(ownerId);
      const ownerEmail = userRecord.email;
      if (!ownerEmail) continue;
      await sendEmail(ownerEmail, alerts);
    } catch (err) {
      console.error("שגיאה:", err);
    }
  }
});

function sendEmail(toEmail, alerts) {
  return new Promise((resolve, reject) => {
    const rows = alerts.map((a) => `<tr><td style="padding:10px 12px;font-weight:600;">${a.customerName}</td><td style="padding:10px 12px;">${a.firm}</td><td style="padding:10px 12px;">$${Number(a.amount).toLocaleString()}</td><td style="padding:10px 12px;">${a.status}</td><td style="padding:10px 12px;color:#a8261b;font-weight:600;">${a.daysSince} ימים</td></tr>`).join("");
    const html = `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Arial,sans-serif;background:#faf9f6;padding:20px;"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;"><div style="background:#0f5132;padding:24px 28px;"><h1 style="color:white;margin:0;font-size:20px;">⏰ תזכורת משיכות ממתינות</h1><p style="color:#a7d9bb;margin:6px 0 0;">${new Date().toLocaleDateString("he-IL")}</p></div><div style="padding:24px 28px;"><p>יש לך <strong>${alerts.length}</strong> משיכות שממתינות לטיפול:</p><table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr style="background:#f5f3ee;"><th style="padding:10px 12px;text-align:right;">לקוח</th><th style="padding:10px 12px;text-align:right;">חברה</th><th style="padding:10px 12px;text-align:right;">סכום</th><th style="padding:10px 12px;text-align:right;">סטטוס</th><th style="padding:10px 12px;text-align:right;">ממתין</th></tr></thead><tbody>${rows}</tbody></table></div></div></body></html>`;
    const payload = JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: toEmail }],
      subject: `⏰ ${alerts.length} משיכות ממתינות לטיפול`,
      htmlContent: html,
    });
    const options = {
      hostname: "api.brevo.com",
      path: "/v3/smtp/email",
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY, "Content-Length": Buffer.byteLength(payload) },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(new Error(`${res.statusCode}: ${data}`)));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
