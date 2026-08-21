import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || 'mail.elitk.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || 'download@bagbacktech.com';
const SMTP_PASS = process.env.SMTP_PASS || 'Bagback2026@Admin';
const FROM_EMAIL = process.env.SMTP_FROM || 'download@bagbacktech.com';

export interface SendDownloadReceiptEmailOpts {
  to: string;
  mediaTitle: string;
  downloadUrl: string;
  fileSizeFormatted?: string;
}

export async function sendDownloadReceiptEmail(opts: SendDownloadReceiptEmailOpts): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0d1117;color:#c9d1d9;font-family:sans-serif;">
  <div style="max-width:600px;margin:20px auto;background:#161b22;border:1px solid #30363d;border-radius:16px;padding:24px;">
    <h2 style="color:#58a6ff;margin-top:0;">Bagback Download — مكتمل</h2>
    <p style="color:#8b949e;">تم تجهيز وتنسيق رابط التنزيل الخاص بك بنجاح:</p>
    <div style="background:#0d1117;padding:16px;border-radius:12px;margin:16px 0;border:1px solid #30363d;">
      <p style="margin:0 0 8px;font-weight:bold;color:#f0f6fc;">${opts.mediaTitle}</p>
      ${opts.fileSizeFormatted ? `<p style="margin:0;font-size:12px;color:#8b949e;">الحجم: ${opts.fileSizeFormatted}</p>` : ''}
    </div>
    <a href="${opts.downloadUrl}" style="display:inline-block;padding:12px 24px;background:#238636;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:bold;">تحميل الملف الآن</a>
    <hr style="border:0;border-top:1px solid #30363d;margin:24px 0 16px;" />
    <p style="font-size:11px;color:#484f58;text-align:center;">Bagback Download — download.bagbacktech.com</p>
  </div>
</body>
</html>`;

    await transporter.sendMail({
      from: `Bagback Download <${FROM_EMAIL}>`,
      to: opts.to,
      subject: `رابط التنزيل جاهز: ${opts.mediaTitle}`,
      html,
    });

    console.log(`[download-email] Receipt sent to ${opts.to}`);
    return true;
  } catch (err: any) {
    console.error('[download-email] Failed to send download receipt:', err?.message);
    return false;
  }
}
