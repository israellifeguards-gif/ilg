import { NextRequest, NextResponse } from 'next/server';

function welcomeEmailHtml(name: string, verifyUrl: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ברוך הבא ל-ILG</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#000000;padding:28px 32px;text-align:center;">
              <span style="font-size:32px;font-weight:900;color:#ffffff;letter-spacing:-1px;font-family:Arial,sans-serif;">
                ILG <span style="color:#FF0000;">●</span>
              </span>
              <div style="color:#9ca3af;font-size:12px;margin-top:4px;font-weight:600;letter-spacing:2px;">
                ISRAEL LIFEGUARDS
              </div>
            </td>
          </tr>

          <!-- Red accent bar -->
          <tr>
            <td style="background:#FF0000;height:4px;"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 32px 32px;text-align:right;">
              <p style="font-size:24px;font-weight:900;color:#000000;margin:0 0 16px;font-family:Arial,sans-serif;line-height:1.4;">
                ברוכ/ה הבא/ה, ${name}!
              </p>
              <p style="font-size:15px;color:#374151;margin:0 0 8px;line-height:1.8;">
                הצטרפת לבית החדש של המצילים ואנשי המים בישראל.
              </p>
              <p style="font-size:15px;color:#374151;margin:0 0 8px;line-height:1.8;">
                כמעט סיימנו - לחץ על הכפתור למטה כדי לאמת את כתובת המייל שלך.
              </p>
              <p style="font-size:15px;color:#374151;margin:0 0 28px;line-height:1.8;">
                התעודה שלך כבר בבדיקה ובקרוב תוכל להתחיל ולהינות מ-ILG יא כריש/ה!
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr>
                  <td style="background:#FF0000;border-radius:4px;">
                    <a href="${verifyUrl}"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-weight:900;font-size:16px;text-decoration:none;letter-spacing:0.5px;">
                      אימות כתובת המייל
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size:13px;color:#9ca3af;margin:0 0 6px;">
                הכפתור לא עובד? העתק את הקישור:
              </p>
              <p style="font-size:12px;color:#3b82f6;margin:0;word-break:break-all;direction:ltr;text-align:left;">
                ${verifyUrl}
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <div style="border-top:1px solid #e5e7eb;"></div>
            </td>
          </tr>

          <!-- Features -->
          <tr>
            <td style="padding:28px 32px;text-align:right;">
              <p style="font-size:20px;font-weight:900;color:#000000;margin:0 0 16px;font-family:Arial,sans-serif;">
                מה מחכה לך ב- ILG
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <span style="color:#FF0000;font-weight:900;margin-left:8px;">●</span> תחזית גלים מקצועית בזמן אמת לכל חופי ישראל
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <span style="color:#FF0000;font-weight:900;margin-left:8px;">●</span> מזג האוויר וחדשות רלוונטיות לתחום ההצלה והמים
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <span style="color:#FF0000;font-weight:900;margin-left:8px;">●</span> קורסים והשתלמויות
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <span style="color:#FF0000;font-weight:900;margin-left:8px;">●</span> משרות עבודה קבועות ומשרות SOS יומיות
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#000000;padding:20px 32px;text-align:center;">
              <p style="color:#6b7280;font-size:12px;margin:0;">
                © 2025 ILG – Israel Lifeguards Group
              </p>
              <p style="color:#4b5563;font-size:11px;margin:6px 0 0;">
                קיבלת מייל זה כי נרשמת ל-ILG. אם לא נרשמת, תוכל להתעלם ממנו.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export async function POST(req: NextRequest) {
  const { name, email, verifyUrl } = await req.json();

  if (!name || !email || !verifyUrl) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'No API key' }, { status: 500 });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'ILG <onboarding@resend.dev>',
      to: email,
      subject: `ברוך הבא ל-ILG, ${name}!`,
      html: welcomeEmailHtml(name, verifyUrl),
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
