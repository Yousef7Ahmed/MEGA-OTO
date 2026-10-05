const otoClient = require("./otoClient");

/**
 * بيختار شركة الشحن لكل شحنة: أرخص خيار توصيل للبيت بيغطي المسار.
 *
 * التحكم من Render (اختياري):
 *   OTO_DELIVERY_OPTION_ID=5442            ← شركة ثابتة لكل الطلبات
 *   OTO_EXCLUDE_OPTIONS=pudo,redbox,cold   ← كلمات في اسم الخيار نستبعدها (ده الافتراضي)
 */

function excludedWords() {
  const raw = process.env.OTO_EXCLUDE_OPTIONS;
  // نقاط الاستلام (PUDO / Redbox) العميل بيروح يستلم منها بنفسه، والـ Cold للمبرّدات
  return String(raw === undefined ? "pudo,redbox,cold,locker" : raw)
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function rank(options, { isCod }) {
  const words = excludedWords();
  return (Array.isArray(options) ? options : [])
    .filter((o) => o && o.deliveryOptionId)
    .filter((o) => {
      const label = `${o.deliveryCompanyName || ""} ${o.deliveryOptionName || ""}`.toLowerCase();
      return !words.some((w) => label.includes(w));
    })
    .map((o) => ({
      id: o.deliveryOptionId,
      company: o.deliveryCompanyName,
      name: o.deliveryOptionName,
      total: (Number(o.price) || 0) + (isCod ? Number(o.codCharge) || 0 : 0),
    }))
    .sort((a, b) => a.total - b.total);
}

/**
 * @returns {Promise<{id:number|string, label:string, total:number|null}|null>}
 */
async function pickDeliveryOption({ originCity, destinationCity, weight, isCod }) {
  const fixed = String(process.env.OTO_DELIVERY_OPTION_ID || "").trim();
  if (fixed) {
    return { id: fixed, label: `fixed #${fixed}`, total: null };
  }

  const response = await otoClient.checkDeliveryFee({ originCity, destinationCity, weight: weight || 1 });
  const ranked = rank(response?.deliveryCompany, { isCod });
  if (ranked.length === 0) return null;

  const best = ranked[0];
  return { id: best.id, label: `${best.company} - ${best.name}`, total: best.total };
}

module.exports = { pickDeliveryOption, rank };
