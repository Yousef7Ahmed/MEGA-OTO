const config = require("../config");
const otoClient = require("./otoClient");

/**
 * مكان الاستلام عند أوتو = عنوان متجر البائع نفسه (من "بيانات المتجر" في لوحته).
 * كل بائع له Pickup Location بكود ثابت: V{رقم البائع}.
 * بيتعمل أول مرة يجيله طلب، وبيتحدّث لو البائع غيّر عنوانه.
 */

const FALLBACK_CITY_BY_STATE = { 2849: "Riyadh", 2850: "Jeddah", 2851: "Madinah", 2852: "Tabuk", 2853: "Abha", 2854: "Arar", 2855: "Hail", 2856: "Dammam", 2857: "Sakaka", 2858: "Jizan", 2859: "Al Bahah", 2860: "Najran", 2861: "Buraidah", 3162: "Qurayyat" };

const synced = new Map(); // code -> signature (آخر بيانات اتبعتت لأوتو)

function pickupCodeFor(vendorId) {
  return `V${vendorId}`;
}

// 05XXXXXXXX / 9665XXXXXXXX / +9665XXXXXXXX → 5XXXXXXXX (الشكل اللي في أمثلة أوتو)
function localMobile(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  const cc = String(config.whatsapp.defaultCountryCode || "966");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith(cc)) d = d.slice(cc.length);
  d = d.replace(/^0+/, "");
  return d;
}

function vendorCity(vendor) {
  return (
    String(vendor.city_name || "").trim() ||
    FALLBACK_CITY_BY_STATE[String(vendor.state_id)] ||
    ""
  );
}

function buildPayload(vendor, cityOverride) {
  const city = cityOverride || vendorCity(vendor);
  const address = [vendor.address, vendor.area, vendor.location].map((x) => String(x || "").trim()).filter(Boolean).join("، ");
  const lat = Number(vendor.lat);
  const lon = Number(vendor.lng);
  return {
    type: "warehouse",
    code: pickupCodeFor(vendor.id),
    name: String(vendor.name || `Vendor ${vendor.id}`).slice(0, 90),
    mobile: localMobile(vendor.phone),
    address: (address || city).slice(0, 250),
    contactName: String(vendor.contact_name || vendor.name || `Vendor ${vendor.id}`).slice(0, 90),
    contactEmail: String(vendor.email || "").includes("@") ? vendor.email : `vendor${vendor.id}@${config.mega.emailDomain}`,
    city,
    country: "SA",
    ...(vendor.area ? { district: String(vendor.area).slice(0, 90) } : {}),
    ...(Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0) ? { lat: String(lat), lon: String(lon) } : {}),
    brandName: String(vendor.name || "").slice(0, 90) || undefined,
    status: "active",
  };
}

/** اللي ناقص في بيانات البائع عشان نقدر نعمله مكان استلام */
function missingFields(vendor) {
  const missing = [];
  if (!localMobile(vendor.phone)) missing.push("رقم الجوال");
  if (!vendorCity(vendor)) missing.push("المدينة");
  if (!String(vendor.address || vendor.area || vendor.location || "").trim()) missing.push("العنوان");
  return missing;
}

function errText(err) {
  const d = err.response?.data;
  const m = (d && (d.otoErrorMessage || d.errorMsg || d.message || d.error)) || err.message;
  return String(typeof m === "object" ? JSON.stringify(m) : m).slice(0, 250);
}

async function upsert(payload) {
  try {
    await otoClient.createPickupLocation(payload);
    return { ok: true, action: "created" };
  } catch (createErr) {
    try {
      await otoClient.updatePickupLocation(payload);
      return { ok: true, action: "updated" };
    } catch (updateErr) {
      return { ok: false, error: `create: ${errText(createErr)} | update: ${errText(updateErr)}` };
    }
  }
}

/**
 * @returns {Promise<{ok:true, code:string, city:string} | {ok:false, code:string, error:string, missing?:string[]}>}
 */
async function ensureVendorPickup(vendor) {
  const code = pickupCodeFor(vendor.id);
  const missing = missingFields(vendor);
  if (missing.length) {
    return { ok: false, code, missing, error: `بيانات متجر البائع ناقصة: ${missing.join("، ")}` };
  }

  let payload = buildPayload(vendor);
  const signature = JSON.stringify(payload);
  if (synced.get(code) === signature) {
    return { ok: true, code, city: payload.city };
  }

  let result = await upsert(payload);

  // أوتو ما عرفش اسم المدينة؟ جرّب مدينة المنطقة المعروفة عنده
  const fallbackCity = FALLBACK_CITY_BY_STATE[String(vendor.state_id)];
  if (!result.ok && fallbackCity && fallbackCity !== payload.city) {
    console.warn(`[pickup] ${code}: المدينة "${payload.city}" اترفضت — بنجرّب "${fallbackCity}".`);
    payload = buildPayload(vendor, fallbackCity);
    result = await upsert(payload);
  }

  if (!result.ok) {
    console.error(`[pickup] ${code}: فشل تسجيل مكان الاستلام عند أوتو — ${result.error}`);
    return { ok: false, code, error: result.error };
  }

  synced.set(code, signature);
  console.log(`[pickup] ${code} (${payload.name}) ${result.action} — ${payload.city}`);
  return { ok: true, code, city: payload.city };
}

module.exports = { ensureVendorPickup, pickupCodeFor, localMobile, buildPayload, missingFields, _synced: synced };
