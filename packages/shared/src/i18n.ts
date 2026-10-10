/**
 * @file packages/shared/src/i18n.ts
 * Enterprise Internationalization (i18n) Engine for SOVRA Protocol.
 *
 * Implements:
 * 1. Strongly typed translation schemas and regional locale packs (English, Hindi, Spanish, Arabic).
 * 2. Dynamic parameter interpolation ({name}, {count}, etc.).
 * 3. Text direction detection (LTR vs RTL for Arabic).
 * 4. Runtime locale bundle export for Web PWA, Android Native, and iOS clients.
 */

export type SupportedLocale = 'en' | 'hi' | 'es' | 'ar';

export interface LocaleMetadata {
  readonly code: SupportedLocale;
  readonly name: string;
  readonly nativeName: string;
  readonly direction: 'ltr' | 'rtl';
}

export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleMetadata> = {
  en: { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr' },
  hi: { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', direction: 'ltr' },
  es: { code: 'es', name: 'Spanish', nativeName: 'Español', direction: 'ltr' },
  ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
};

export const TRANSLATIONS: Record<SupportedLocale, Record<string, string>> = {
  en: {
    'app.title': 'SOVRA Network',
    'app.tagline': 'Sovereign Decentralized Spatial Platform',
    'nav.home': 'Home',
    'nav.feed': 'Feed',
    'nav.reels': 'Reels',
    'nav.calls': 'Calls',
    'nav.studio': 'Creator Studio',
    'nav.settings': 'Settings',
    'nav.admin': 'Admin Console',
    'auth.welcome': 'Welcome to Sovereign Freedom',
    'auth.enter_handle': 'Enter your sovereign handle',
    'auth.pin_label': 'Security PIN',
    'auth.register_button': 'Create Sovereign Identity',
    'auth.recovering_identity': 'Restoring Identity from Seed...',
    'auth.pow_verifying': 'Verifying Sybil Defense Proof-of-Work...',
    'call.start_voice': 'Start Voice Call',
    'call.start_video': 'Start Video Call',
    'call.connecting': 'Connecting via WebRTC ICE...',
    'call.connected': 'Secured with End-to-End Encryption',
    'call.ended': 'Call Terminated',
    'feed.create_post': 'Create Post',
    'feed.whats_on_mind': "What's on your mind?",
    'feed.views_count': '{count} views',
    'feed.tip_creator': 'Tip Creator',
    'mesh.status_online': 'Relay Connected',
    'mesh.status_offline': 'Offline Mesh Active (BLE / Wi-Fi Direct)',
    'compliance.privacy_policy': 'Privacy Policy',
    'compliance.terms_of_service': 'Terms of Service',
    'compliance.zero_knowledge': 'Zero-Knowledge Cryptographic Architecture',
  },
  hi: {
    'app.title': 'सोवरा नेटवर्क',
    'app.tagline': 'संप्रभु विकेंद्रीकृत स्थानिक मंच',
    'nav.home': 'होम',
    'nav.feed': 'फ़ीड',
    'nav.reels': 'रील्स',
    'nav.calls': 'कॉल्स',
    'nav.studio': 'क्रिएटर स्टूडियो',
    'nav.settings': 'सेटिंग्स',
    'nav.admin': 'प्रशासन कंसोल',
    'auth.welcome': 'संप्रभु स्वतंत्रता में आपका स्वागत है',
    'auth.enter_handle': 'अपना संप्रभु हैंडल दर्ज करें',
    'auth.pin_label': 'सुरक्षा पिन',
    'auth.register_button': 'संप्रभु पहचान बनाएं',
    'auth.recovering_identity': 'सीड से पहचान पुनर्प्राप्त की जा रही है...',
    'auth.pow_verifying': 'सिबिल रक्षा कार्य-प्रमाण सत्यापित किया जा रहा है...',
    'call.start_voice': 'वॉयस कॉल शुरू करें',
    'call.start_video': 'वीडियो कॉल शुरू करें',
    'call.connecting': 'WebRTC ICE के माध्यम से कनेक्ट हो रहा है...',
    'call.connected': 'एंड-टू-एंड एन्क्रिप्शन से सुरक्षित',
    'call.ended': 'कॉल समाप्त',
    'feed.create_post': 'पोस्ट बनाएं',
    'feed.whats_on_mind': 'आप क्या सोच रहे हैं?',
    'feed.views_count': '{count} बार देखा गया',
    'feed.tip_creator': 'क्रिएटर को टिप दें',
    'mesh.status_online': 'रिले कनेक्टेड',
    'mesh.status_offline': 'ऑफ़लाइन मेश सक्रिय (BLE / Wi-Fi Direct)',
    'compliance.privacy_policy': 'गोपनीयता नीति',
    'compliance.terms_of_service': 'सेवा की शर्तें',
    'compliance.zero_knowledge': 'शून्य-ज्ञान क्रिप्टोग्राफ़िक वास्तुकला',
  },
  es: {
    'app.title': 'Red SOVRA',
    'app.tagline': 'Plataforma Espacial Descentralizada Soberana',
    'nav.home': 'Inicio',
    'nav.feed': 'Noticias',
    'nav.reels': 'Reels',
    'nav.calls': 'Llamadas',
    'nav.studio': 'Estudio de Creadores',
    'nav.settings': 'Configuración',
    'nav.admin': 'Consola de Administración',
    'auth.welcome': 'Bienvenido a la Libertad Soberana',
    'auth.enter_handle': 'Ingrese su usuario soberano',
    'auth.pin_label': 'PIN de Seguridad',
    'auth.register_button': 'Crear Identidad Soberana',
    'auth.recovering_identity': 'Restaurando identidad desde semilla...',
    'auth.pow_verifying': 'Verificando prueba de trabajo anti-bot...',
    'call.start_voice': 'Iniciar Llamada de Voz',
    'call.start_video': 'Iniciar Videollamada',
    'call.connecting': 'Conectando mediante WebRTC ICE...',
    'call.connected': 'Protegido con Cifrado de Extremo a Extremo',
    'call.ended': 'Llamada Finalizada',
    'feed.create_post': 'Crear Publicación',
    'feed.whats_on_mind': '¿Qué estás pensando?',
    'feed.views_count': '{count} visualizaciones',
    'feed.tip_creator': 'Dar Propina al Creador',
    'mesh.status_online': 'Retransmisión Conectada',
    'mesh.status_offline': 'Malla Fuera de Línea Activa (BLE / Wi-Fi Direct)',
    'compliance.privacy_policy': 'Política de Privacidad',
    'compliance.terms_of_service': 'Términos de Servicio',
    'compliance.zero_knowledge': 'Arquitectura Criptográfica de Conocimiento Cero',
  },
  ar: {
    'app.title': 'شبكة سوفرا',
    'app.tagline': 'منصة مكانية لا مركزية سيادية',
    'nav.home': 'الرئيسية',
    'nav.feed': 'المنشورات',
    'nav.reels': 'مقاطع الفيديو',
    'nav.calls': 'المكالمات',
    'nav.studio': 'استوديو المبدعين',
    'nav.settings': 'الإعدادات',
    'nav.admin': 'لوحة الإدارة',
    'auth.welcome': 'مرحبًا بك في الحرية السيادية',
    'auth.enter_handle': 'أدخل اسم المستخدم السيادي الخاص بك',
    'auth.pin_label': 'رمز الأمان (PIN)',
    'auth.register_button': 'إنشاء هوية سيادية',
    'auth.recovering_identity': 'جارٍ استعادة الهوية من بذرة المفتاح...',
    'auth.pow_verifying': 'جارٍ التحقق من إثبات العمل لمكافحة الهجمات...',
    'call.start_voice': 'بدء مكالمة صوتية',
    'call.start_video': 'بدء مكالمة فيديو',
    'call.connecting': 'جارٍ الاتصال عبر WebRTC ICE...',
    'call.connected': 'محمي بتشفير شامل من طرف إلى طرف',
    'call.ended': 'انتهت المكالمة',
    'feed.create_post': 'إنشاء منشور',
    'feed.whats_on_mind': 'بماذا تفكر؟',
    'feed.views_count': '{count} مشاهدة',
    'feed.tip_creator': 'إكرامية لصانع المحتوى',
    'mesh.status_online': 'المرحّل متصل',
    'mesh.status_offline': 'الشبكة غير المتصلة نشطة (BLE / Wi-Fi Direct)',
    'compliance.privacy_policy': 'سياسة الخصوصية',
    'compliance.terms_of_service': 'شروط الخدمة',
    'compliance.zero_knowledge': 'بنية تشفير المعرفة الصفرية',
  },
};

/**
 * Returns localized text with optional template interpolation.
 */
export function translate(
  locale: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  const normLocale: SupportedLocale = (locale in TRANSLATIONS ? locale : 'en') as SupportedLocale;
  let text = TRANSLATIONS[normLocale]?.[key] || TRANSLATIONS.en[key] || key;

  if (params) {
    for (const [paramKey, paramVal] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
    }
  }

  return text;
}

/**
 * Retrieves the complete translation dictionary for a given locale.
 */
export function getLocaleBundle(locale: string): {
  metadata: LocaleMetadata;
  strings: Record<string, string>;
} {
  const normLocale: SupportedLocale = (locale in TRANSLATIONS ? locale : 'en') as SupportedLocale;
  return {
    metadata: SUPPORTED_LOCALES[normLocale],
    strings: { ...TRANSLATIONS[normLocale] },
  };
}

/**
 * Checks if a locale is right-to-left.
 */
export function isRTL(locale: string): boolean {
  const normLocale: SupportedLocale = (locale in TRANSLATIONS ? locale : 'en') as SupportedLocale;
  return SUPPORTED_LOCALES[normLocale].direction === 'rtl';
}
