// lib/resend.ts
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL =
  process.env.EMAIL_FROM || "Haven Vaults <transfer@havenvaults.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Create client only if key is present (dev safe)
const resend: Resend | null = RESEND_API_KEY
  ? new Resend(RESEND_API_KEY)
  : null;

type ResendSendResult = {
  data?: { id?: string } | null;
  error?: {
    name?: string;
    message: string;
    statusCode?: number;
    details?: unknown;
  } | null;
};

export async function sendClaimEmail(opts: {
  recipientEmail: string; // who receives the email
  amountUi: number; // e.g. 12.34
  senderEmail: string; // the sender’s email (reply-to)
  claimToken: string; // signed token that maps to the EmailClaim
  note?: string;
}): Promise<{ id?: string } | null> {
  const { recipientEmail, amountUi, senderEmail, claimToken, note } = opts;

  const claimUrl = `${APP_URL}/claim/${encodeURIComponent(claimToken)}`;
  const subject = `${senderEmail} sent you $${amountUi.toFixed(2)} via Haven`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transfer from ${escapeHtml(senderEmail)} - Haven Vaults</title>
  <style type="text/css">
    /* Resets */
    body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    a { color: rgb(182, 255, 62); text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { border: none; display: block; }
    table { border-collapse: collapse; width: 100%; max-width: 600px; }

    /* Responsive design */
    @media only screen and (max-width: 600px) {
      .container { padding: 16px !important; }
      .header h1 { font-size: 20px !important; }
      .content h2 { font-size: 18px !important; }
      .content p { font-size: 14px !important; line-height: 22px !important; }
      .cta-button a { padding: 10px 20px !important; font-size: 14px !important; }
      .footer p { font-size: 11px !important; }
    }
  </style>
</head>
<body style="background-color: #080A0C; color: #F5F5F5;">
  <table align="center" class="container" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td>
        <!-- Header -->
        <table class="header" style="text-align: center; padding: 20px 0;">
          <tr>
            <td>
              <div style="width: 48px; height: 48px; background: linear-gradient(135deg, rgb(182, 255, 62), rgb(146, 204, 50)); border-radius: 12px; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
                <span style="color: #000; font-weight: 700; font-size: 20px;">H</span>
              </div>
              <h1 style="font-size: 24px; font-weight: 600; color: #F5F5F5; margin: 12px 0 0;">Haven Vaults</h1>
              <p style="font-size: 14px; color: #A1A1AA; margin: 4px 0 0;">Secure Transfer Service</p>
            </td>
          </tr>
        </table>

        <!-- Main Content -->
        <table class="content" style="background: linear-gradient(135deg, rgba(182, 255, 62, 0.05), rgba(182, 255, 62, 0.02)); backdrop-filter: blur(10px); border: 1px solid rgba(182, 255, 62, 0.1); border-radius: 16px; padding: 32px;">
          <tr>
            <td>
              <h2 style="font-size: 22px; font-weight: 600; color: #F5F5F5; margin: 0 0 20px; text-align: center;">Money Transfer from ${escapeHtml(
                senderEmail
              )}</h2>
              
              <div style="background-color: rgba(182, 255, 62, 0.1); border: 1px solid rgba(182, 255, 62, 0.2); border-radius: 12px; padding: 20px; margin: 0 0 24px; text-align: center;">
                <p style="font-size: 14px; color: #A1A1AA; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px;">Amount Sent</p>
                <p style="font-size: 32px; font-weight: 700; color: rgb(182, 255, 62); margin: 0;">$${amountUi.toFixed(
                  2
                )} USD</p>
              </div>

              <p style="font-size: 16px; line-height: 24px; color: #F5F5F5; margin: 0 0 16px;">
                <strong>${escapeHtml(
                  senderEmail
                )}</strong> has sent you money through Haven's secure transfer system. This email was sent on their behalf to notify you of the transfer.
              </p>
              
              ${
                note
                  ? `<div style="background-color: rgba(255, 255, 255, 0.05); border-left: 3px solid rgb(182, 255, 62); padding: 16px; margin: 0 0 20px; border-radius: 0 8px 8px 0;">
                <p style="font-size: 14px; color: #A1A1AA; margin: 0 0 4px;">Personal message from ${escapeHtml(
                  senderEmail
                )}:</p>
                <p style="font-size: 16px; line-height: 24px; color: #F5F5F5; margin: 0; font-style: italic;">"${escapeHtml(
                  note
                )}"</p>
              </div>`
                  : ""
              }
              
              <p style="font-size: 16px; line-height: 24px; color: #F5F5F5; margin: 0 0 24px;">
                To access your funds, please verify this transfer using the secure link below. You can transfer to your existing bank account or open a Haven Bank account to manage your funds.
              </p>

              <!-- CTA Button -->
<table class="cta-button" style="text-align: center; margin: 24px 0;">
  <tr>
    <td>
      <a
        href="${claimUrl}"
        style="
          display: inline-block;
          background: linear-gradient(135deg, rgb(182, 255, 62), rgb(146, 204, 50));
          color: #00000;
          text-decoration: none;
          padding: 14px 32px;
          border-radius: 14px;
          font-size: 16px;
          font-weight: 600;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          box-shadow: 0 6px 14px rgba(182, 255, 62, 0.35);
          transition: all 0.2s ease-in-out;
        "
      >
        Claim Your Funds
      </a>
    </td>
  </tr>
</table>


              <!-- Security Notice -->
              <div style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="font-size: 14px; line-height: 20px; color: #A1A1AA; margin: 0;">
                  <strong style="color: #F5F5F5;">Security Notice:</strong> This transfer is secured with bank-level encryption. If you did not expect this transfer from ${escapeHtml(
                    senderEmail
                  )}, please contact our support team immediately. You can reply to this email to reach ${escapeHtml(
    senderEmail
  )} directly.
                </p>
              </div>

              <!-- Fallback Link -->
              <p style="font-size: 14px; line-height: 20px; color: #A1A1AA; margin: 0; text-align: center;">
                If the button above doesn't work, copy and paste this link into your browser:<br>
                <a href="${claimUrl}" style="color: rgb(182, 255, 62); text-decoration: underline; word-break: break-all; font-size: 12px;">${claimUrl}</a>
              </p>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table class="footer" style="text-align: center; padding: 24px 0; font-size: 12px; color: #A1A1AA;">
          <tr>
            <td>
              <p style="margin: 0 0 8px;">Haven Vaults - Secure Transfer Service</p>
              <p style="margin: 0 0 12px;">This email was sent by Haven on behalf of ${escapeHtml(
                senderEmail
              )}. Reply to this email to contact the sender directly.</p>
              <p style="margin: 0;">
                <a href="${APP_URL}/privacy" style="color: rgb(182, 255, 62);">Privacy Policy</a> | 
                <a href="${APP_URL}/terms" style="color: rgb(182, 255, 62);">Terms of Service</a> | 
                <a href="${APP_URL}/support" style="color: rgb(182, 255, 62);">Support</a>
              </p>
              <p style="margin: 12px 0 0; font-size: 11px;">© ${new Date().getFullYear()} Haven Vaults. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `
Money Transfer from ${senderEmail}

${senderEmail} has sent you $${amountUi.toFixed(2)} through Haven Vaults.

${note ? `Note from ${senderEmail}: "${note}"` : ""}

To access your transfer, visit: ${claimUrl}

You can transfer the funds to your existing bank account or open a Haven account to manage your money.

Security Notice: This transfer is secured with bank-level encryption. If you did not expect this transfer from ${senderEmail}, please contact ${senderEmail} directly.

---

Haven Vaults - Secure digital finances
This email was sent by Haven Vaults on behalf of ${senderEmail}.
Support: ${APP_URL}/support
Privacy Policy: ${APP_URL}/privacy
Terms of Service: ${APP_URL}/terms

© ${new Date().getFullYear()} Haven Vaults. All rights reserved.
`;

  if (!resend) {
    // Dev mode: don't hard fail if no API key set
    console.log("[mailer] (dev) would send:", {
      to: recipientEmail,
      subject,
      claimUrl,
      note,
    });
    return { id: "dev-mail" };
  }

  const result = await resend.emails.send({
    from: FROM_EMAIL, // must be a verified sender/domain in Resend
    to: recipientEmail,
    subject,
    html,
    text,
    replyTo: senderEmail, // ✅ This ensures replies go to the actual sender
  });

  const r = result as unknown as ResendSendResult;
  if (r.error) {
    const err = r.error;
    console.error(
      "[mailer] Resend error:",
      JSON.stringify(
        {
          name: err?.name,
          message: err?.message,
          statusCode: err?.statusCode,
          details: err?.details,
        },
        null,
        2
      )
    );
    throw new Error(err?.message || "Email send failed");
  }

  return r.data ?? null;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        ch
      ] as string)
  );
}
