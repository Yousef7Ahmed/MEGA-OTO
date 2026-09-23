/**
 * إشعارات واتساب عن طريق WaFinal — نفس نظام واتساب اللي بيشغّل
 * بوت المبيعات على منصّة Mega Ai، بدل WhatsApp Cloud API (ميتا).
 *
 * ليه التغيير: ميتا محتاجة حساب Facebook Developer موثّق + قالب رسالة
 * معتمد، وحساب العميل واقف عليه تحقّق أمان من جوجل. WaFinal شغّال
 * فعلياً على المنصّة دلوقتي (نفس الرقم اللي بيرد بيه البوت)، مفيهوش
 * قيود القوالب، ومحتاج بس 3 قيم من لوحة تحكم Mega Ai:
 *
 *   php artisan whatsapp:wafinal-creds --slug=hujj
 *
 * ده بيطبعلك WAFINAL_BASE_URL / WAFINAL_API_TOKEN / WAFINAL_INSTANCE_ID
 * تحطهم في .env بتاع المشروع ده.
 *
 * ملحوظة: WaFinal بيبعت نص حر بس (مفيش تمييز قالب/نص حر ولا نافذة
 * الـ24 ساعة بتاعة ميتا) — فالـ templateName/templateParams بقيت
 * غير مستخدمة، وسايبينها في التوقيع بس عشان shipmentNotifier.js
 * ما يتغيّرش.
 */

const axios = require('axios');
const config = require('../config');

function isConfigured() {
  return Boolean(
    config.whatsapp.wafinalBaseUrl &&
    config.whatsapp.wafinalApiToken &&
    config.whatsapp.wafinalInstanceId,
  );
}

/**
 * تنظيف رقم الموبايل لصيغة دولية بالأرقام بس (بدون + أو رموز).
 *   05xxxxxxxx  -> 9665xxxxxxxx
 *   5xxxxxxxx   -> 9665xxxxxxxx
 *   +9665xxxxx  -> 9665xxxxx
 */
function normalizePhone(raw, defaultCountryCode = config.whatsapp.defaultCountryCode) {
  if (!raw) return null;

  let n = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!n) return null;

  // 00966... -> 966...
  if (n.startsWith('00')) n = n.slice(2);

  // بيبدأ بكود الدولة أصلاً
  if (n.startsWith(defaultCountryCode)) return n;

  // 05xxxxxxxx محلي
  if (n.startsWith('0')) return defaultCountryCode + n.slice(1);

  // 5xxxxxxxx من غير صفر
  if (n.length <= 9) return defaultCountryCode + n;

  return n;
}

/**
 * إرسال نص حر عن طريق WaFinal.
 */
async function sendText(to, message) {
  const phone = normalizePhone(to);
  if (!phone) throw new Error('رقم موبايل غير صالح');

  const url = `${config.whatsapp.wafinalBaseUrl.replace(/\/+$/, '')}/api/v1/send-text`;

  const { data } = await axios.get(url, {
    params: {
      token: config.whatsapp.wafinalApiToken,
      instance_id: config.whatsapp.wafinalInstanceId,
      jid: `${phone}@s.whatsapp.net`,
      msg: message,
    },
    timeout: 10000,
  });

  return data;
}

/**
 * الإرسال — بيرجّع { ok, mode, error } وما بيرميش استثناء، عشان فشل
 * الإشعار ما يكسرش استقبال الويب هوك من أوتو.
 */
async function notify({ to, text }) {
  if (!isConfigured()) {
    return { ok: false, skipped: true, error: 'WaFinal مش متظبط في .env (WAFINAL_BASE_URL / WAFINAL_API_TOKEN / WAFINAL_INSTANCE_ID)' };
  }

  try {
    await sendText(to, text);
    return { ok: true, mode: 'text' };
  } catch (err) {
    const details = err.response?.data?.error || err.response?.data?.message || err.message;
    return { ok: false, error: details };
  }
}

module.exports = { isConfigured, normalizePhone, sendText, notify };
