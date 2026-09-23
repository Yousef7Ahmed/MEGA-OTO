/**
 * اختبار إشعارات واتساب من غير ما نستنى شحنة حقيقية.
 *
 *   npm run test-whatsapp -- 966512345678
 *   npm run test-whatsapp -- 966512345678 delivered
 */

const config = require('../config');
const whatsapp = require('../services/whatsappClient');
const notifier = require('../services/shipmentNotifier');
const orderStore = require('../store/orderStore');

const phone = process.argv[2];
const status = process.argv[3] || 'shipped';

(async () => {
  console.log('\n=== إعدادات واتساب (WaFinal) ===');
  console.log('  WAFINAL_BASE_URL    :', config.whatsapp.wafinalBaseUrl ? '✅ متظبط' : '❌ فاضي');
  console.log('  WAFINAL_API_TOKEN   :', config.whatsapp.wafinalApiToken ? '✅ متظبط' : '❌ فاضي');
  console.log('  WAFINAL_INSTANCE_ID :', config.whatsapp.wafinalInstanceId ? '✅ متظبط' : '❌ فاضي');
  console.log('  إشعار البائع        :', config.whatsapp.notifyVendor ? 'مفعّل' : 'متوقف');

  if (!whatsapp.isConfigured()) {
    console.error('\n❌ واتساب مش متظبط. طلّع القيم بالأمر: php artisan whatsapp:wafinal-creds --slug=hujj');
    console.error('   وحطهم في .env: WAFINAL_BASE_URL / WAFINAL_API_TOKEN / WAFINAL_INSTANCE_ID');
    process.exit(1);
  }

  if (!phone) {
    console.error('\n❌ اكتب رقم للتجربة:  npm run test-whatsapp -- 966512345678');
    process.exit(1);
  }

  console.log('\n=== تنظيف الرقم ===');
  console.log(`  ${phone}  ->  ${whatsapp.normalizePhone(phone)}`);

  // طلب وهمي في الذاكرة بنفس شكل البيانات الجديدة من ميجا
  const orderId = 'TEST-' + Date.now();

  orderStore.saveOrder(orderId, {
    megaFullOrder: {
      store: { id: 45, name: config.whatsapp.storeName },
      buyer: { name: 'عميل تجريبي', phone },
      ship_to: { city_name: 'القريات', full_name: 'عميل تجريبي', phone },
      vendors: config.whatsapp.notifyVendor
        ? [{ vendor_id: 1, store_name: 'متجر تجريبي', phone }]
        : [],
    },
  });

  console.log(`\n=== إرسال حالة "${status}" للطلب ${orderId} ===`);

  const result = await notifier.notifyStatusChange(orderId, {
    status,
    trackingNumber: 'TRK123456789',
    trackingUrl: 'https://tryoto.com/track/TRK123456789',
    deliveryCompany: 'أرامكس',
    driverName: 'أحمد',
    driverPhone: '0555555555',
  });

  console.log('\n=== النتيجة ===');
  console.log(JSON.stringify(result, null, 2));

  if (result?.buyer?.ok) {
    console.log('\n✅ اتبعت. شوف الواتساب بتاعك.');
  } else if (result?.buyer?.error) {
    console.log('\n❌ فشل:', result.buyer.error);
    console.log('\nأسباب شائعة:');
    console.log('  • الـ instance مقفول/مش متصل من لوحة WaFinal');
    console.log('  • التوكن أو رقم الـ instance غلط — أعد التوليد بالأمر whatsapp:wafinal-creds');
    console.log('  • رقم العميل مش صح بعد التنظيف (شوف "تنظيف الرقم" فوق)');
  }
})();
