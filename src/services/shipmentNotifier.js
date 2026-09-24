/**
 * إشعارات تتبّع الشحنة على واتساب — للمشتري والبائع.
 *
 * بيتنده من ويب هوك حالة أوتو. بيمنع تكرار نفس الحالة لنفس الطلب،
 * وما بيرميش أي استثناء — فشل الإشعار ما يأثرش على استقبال الويب هوك.
 */

const whatsapp = require('./whatsappClient');
const orderStore = require('../store/orderStore');
const config = require('../config');

/* ============================================================
 |  توحيد حالات أوتو
 * ============================================================ */

const STATUS_MAP = [
  { match: ['delivered', 'complete'],                    key: 'delivered' },
  { match: ['out_for_delivery', 'outfordelivery', 'ofd'], key: 'out_for_delivery' },
  { match: ['transit', 'shipped', 'in_transit', 'ship'],  key: 'shipped' },
  { match: ['pick', 'collected', 'received_by'],          key: 'picked' },
  { match: ['return'],                                    key: 'returned' },
  { match: ['cancel'],                                    key: 'cancelled' },
  { match: ['fail', 'undeliver'],                         key: 'failed' },
  { match: ['created', 'new', 'pending', 'confirm'],      key: 'created' },
];

function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase().replace(/[\s-]/g, '_');
  if (!s) return null;

  for (const entry of STATUS_MAP) {
    if (entry.match.some((m) => s.includes(m))) return entry.key;
  }
  return null;
}

/* ============================================================
 |  نصوص الرسائل
 * ============================================================ */

const BUYER_TEXT = {
  created: (c) => `مرحباً ${c.name} 👋
تم تجهيز شحنة طلبك رقم *${c.orderId}* من ${c.storeName}.
هنبلّغك أول ما المندوب يستلمها.`,

  picked: (c) => `تم استلام شحنة طلبك *${c.orderId}* من البائع 📦
شركة الشحن: ${c.carrier}
رقم التتبّع: ${c.tracking}
${c.trackingUrl ? `تابع شحنتك: ${c.trackingUrl}` : ''}`,

  shipped: (c) => `شحنتك في الطريق 🚚
الطلب: *${c.orderId}*
شركة الشحن: ${c.carrier}
رقم التتبّع: ${c.tracking}
${c.trackingUrl ? `تابع شحنتك: ${c.trackingUrl}` : ''}`,

  out_for_delivery: (c) => `المندوب في طريقه إليك اليوم 🏍️
الطلب: *${c.orderId}*
${c.driverName ? `المندوب: ${c.driverName}` : ''}
${c.driverPhone ? `للتواصل: ${c.driverPhone}` : ''}
برجاء التأكد من توفّر رقمك للتواصل.`,

  delivered: (c) => `تم تسليم طلبك *${c.orderId}* بنجاح ✅
شكراً لثقتك في ${c.storeName} 🌹
لو في أي ملاحظة، إحنا في خدمتك.`,

  failed: (c) => `تعذّر تسليم طلبك *${c.orderId}* ⚠️
هنحاول مرة تانية. برجاء التأكد من رقمك وعنوانك.
${c.driverPhone ? `للتواصل مع المندوب: ${c.driverPhone}` : ''}`,

  returned: (c) => `تم إرجاع شحنة طلبك *${c.orderId}* ↩️
لو ده مش المفروض يحصل، تواصل معانا في ${c.storeName}.`,

  cancelled: (c) => `تم إلغاء شحنة طلبك *${c.orderId}* ❌
لو عندك أي استفسار، تواصل معانا في ${c.storeName}.`,
};

const VENDOR_TEXT = {
  created: (c) => `طلب جديد للشحن 📦
رقم الطلب: *${c.orderId}*
العميل: ${c.buyerName}
المدينة: ${c.city}
جهّز الطلب، والمندوب هيمرّ يستلمه.`,

  picked: (c) => `تم استلام طلب *${c.orderId}* منك ✅
شركة الشحن: ${c.carrier}
رقم التتبّع: ${c.tracking}`,

  shipped: (c) => `طلب *${c.orderId}* في الطريق للعميل 🚚
رقم التتبّع: ${c.tracking}`,

  out_for_delivery: (c) => `طلب *${c.orderId}* خرج للتسليم للعميل اليوم 🏍️`,

  delivered: (c) => `تم تسليم طلب *${c.orderId}* للعميل بنجاح ✅`,

  failed: (c) => `تعذّر تسليم طلب *${c.orderId}* ⚠️
شركة الشحن هتحاول تاني.`,

  returned: (c) => `طلب *${c.orderId}* راجع لك ↩️
استعد لاستلام الشحنة.`,

  cancelled: (c) => `تم إلغاء شحنة طلب *${c.orderId}* ❌`,
};

const STATUS_LABEL_AR = {
  created: 'تم التجهيز',
  picked: 'تم الاستلام من البائع',
  shipped: 'في الطريق',
  out_for_delivery: 'خرج للتسليم',
  delivered: 'تم التسليم',
  failed: 'تعذّر التسليم',
  returned: 'مرتجع',
  cancelled: 'ملغي',
};

/* ============================================================
 |  استخراج جهات الاتصال من الطلب المحفوظ
 * ============================================================ */

function extractContacts(orderRecord) {
  // الأولوية لرد الـ API، وبعدين الويب هوك الأصلي
  const full = {
    ...(orderRecord?.megaWebhookPayload || {}),
    ...(orderRecord?.megaFullOrder || {}),
  };

  // الشكل الجديد من ميجا (ship_to / buyer / vendors)
  const shipTo  = full.ship_to || full.delivery_address || {};
  const buyer   = full.buyer || {};

  // البائعين: من vendors[] (ويب هوك الطلب الجديد) أو من items[].vendor (رد الـ API
  // وويب هوك "Status Change") — مع منع تكرار نفس الرقم.
  const vendorList = [
    ...(Array.isArray(full.vendors) ? full.vendors : []),
    ...(Array.isArray(full.items) ? full.items : [])
      .map((item) => item && item.vendor)
      .filter(Boolean)
      .map((v) => ({ phone: v.phone, store_name: v.name })),
  ];
  const seenPhones = new Set();
  const vendors = vendorList.filter((v) => {
    const key = whatsapp.normalizePhone(v && v.phone);
    if (!key || seenPhones.has(key)) return false;
    seenPhones.add(key);
    return true;
  });

  const buyerPhone =
    buyer.phone ||
    shipTo.phone ||
    full.customer_phone ||
    null;

  const buyerName =
    buyer.name ||
    shipTo.full_name ||
    `${shipTo.first_name ?? ''} ${shipTo.last_name ?? ''}`.trim() ||
    'عميلنا العزيز';

  return {
    buyerPhone,
    buyerName,
    city: shipTo.city_name || shipTo.city || '-',
    storeName: full.store?.name || config.whatsapp.storeName,
    vendors: vendors
      .filter((v) => v && v.phone)
      .map((v) => ({ phone: v.phone, name: v.store_name || 'البائع' })),
  };
}

function buildContext(orderId, contacts, payload) {
  return {
    orderId,
    name: contacts.buyerName,
    buyerName: contacts.buyerName,   // مستقل — عشان رسالة البائع ما تستبدلهوش
    city: contacts.city,
    storeName: contacts.storeName,
    carrier: payload.deliveryCompany || 'شركة الشحن',
    tracking: payload.trackingNumber || '-',
    trackingUrl: payload.trackingUrl || '',
    driverName: payload.driverName || '',
    driverPhone: payload.driverPhone || '',
  };
}

function clean(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/* ============================================================
 |  الإرسال
 * ============================================================ */

/**
 * بيتنده بعد كل تحديث حالة من أوتو.
 * ما بيرميش أبداً — بيرجّع ملخّص لوج بس.
 */
async function notifyStatusChange(orderId, payload) {
  const statusKey = normalizeStatus(payload.status || payload.dcStatus);

  if (!statusKey) {
    console.log(`[whatsapp] حالة غير معروفة "${payload.status}" — مفيش إشعار.`);
    return { skipped: 'unknown_status' };
  }

  if (!config.whatsapp.enabled) {
    console.log('[whatsapp] الإشعارات متوقفة (WHATSAPP_ENABLED=false).');
    return { skipped: 'disabled' };
  }

  const record = orderStore.getOrder(String(orderId)) || {};

  // منع التكرار — نفس الحالة اتبعتت قبل كده
  const notified = record.notifiedStatuses || [];
  if (notified.includes(statusKey)) {
    console.log(`[whatsapp] الحالة "${statusKey}" للطلب ${orderId} اتبعتت قبل كده — تخطّي.`);
    return { skipped: 'duplicate' };
  }

  const contacts = extractContacts(record);
  const ctx = buildContext(orderId, contacts, payload);
  const results = { buyer: null, vendors: [] };

  /* --- المشتري --- */
  if (contacts.buyerPhone && BUYER_TEXT[statusKey]) {
    results.buyer = await whatsapp.notify({
      to: contacts.buyerPhone,
      text: clean(BUYER_TEXT[statusKey](ctx)),
      templateName: config.whatsapp.buyerTemplate,
      templateParams: [ctx.name, ctx.orderId, STATUS_LABEL_AR[statusKey], ctx.tracking],
    });

    console.log(
      `[whatsapp] المشتري ${contacts.buyerPhone} (${statusKey}):`,
      results.buyer.ok ? 'اتبعت ✅' : `فشل ❌ ${results.buyer.error}`,
    );
  } else if (!contacts.buyerPhone) {
    console.warn(`[whatsapp] الطلب ${orderId} — مفيش رقم موبايل للمشتري.`);
  }

  /* --- البائعين --- */
  if (config.whatsapp.notifyVendor && VENDOR_TEXT[statusKey]) {
    for (const vendor of contacts.vendors) {
      const r = await whatsapp.notify({
        to: vendor.phone,
        text: clean(VENDOR_TEXT[statusKey]({ ...ctx, name: vendor.name })),
        templateName: config.whatsapp.vendorTemplate,
        templateParams: [vendor.name, ctx.orderId, STATUS_LABEL_AR[statusKey], ctx.tracking],
      });

      results.vendors.push({ phone: vendor.phone, ...r });
      console.log(
        `[whatsapp] البائع ${vendor.phone} (${statusKey}):`,
        r.ok ? 'اتبعت ✅' : `فشل ❌ ${r.error}`,
      );
    }

    if (contacts.vendors.length === 0) {
      console.log(`[whatsapp] الطلب ${orderId} — مفيش بائعين بأرقام (منتجات المتجر الرئيسي).`);
    }
  }

  // سجّل الحالة عشان ما تتبعتش تاني
  orderStore.saveOrder(String(orderId), {
    notifiedStatuses: [...notified, statusKey],
    lastNotifiedAt: new Date().toISOString(),
    lastNotifiedStatus: statusKey,
  });

  return results;
}

module.exports = { notifyStatusChange, normalizeStatus, STATUS_LABEL_AR };
