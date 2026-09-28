import { useCallback } from 'react';

export type Lang = 'ar' | 'en';

export const dict = {
  ar: {
    appName: 'Bagback Download',
    brandName: 'Bagback',
    brandSuffix: 'Download',
    tagline: 'مدير التحميل المفتوح والمجاني لمحتوى الويب والفيديو والصوت',
    subtagline: 'صنع بحب للمستخدمين بدون أرباح، من شركة Bagback Digital Solutions بيد المطور محمد أسامة.',
    inputPlaceholder: 'الصق رابط الفيديو أو الصوت هنا...',
    analyze: 'تحليل',
    analyzing: 'جارٍ التحليل...',
    pasteClipboard: '📋 لصق من الحافظة',
    supportedSites: 'يوتيوب · تيك توك · إنستغرام · تويتر · فيسبوك · وآلاف المواقع الأخرى',
    videoTab: '🎬 فيديو',
    audioTab: '🎵 صوت فقط (MP3)',
    selectQuality: 'اختر الجودة',
    bestQuality: 'أفضل جودة',
    startDownload: 'ابدأ التحميل',
    addingDownload: 'جارٍ الإضافة...',
    downloading: 'جارٍ التحميل',
    history: 'سجل التحميلات',
    clearAll: 'مسح الكل',
    emptyQueue: 'الصق رابطاً وابدأ التحميل',
    statusQueued: 'في الانتظار',
    statusRunning: 'جارٍ التحميل',
    statusCompleted: 'اكتمل التحميل',
    statusFailed: 'فشل التحميل',
    openFile: 'تحميل الملف',
    deleteItem: 'حذف',
    legalNotice: 'استخدم التطبيق فقط مع المحتوى المسموح لك بحفظه طبقاً للقوانين.',
    localHistoryTitle: 'سجل التحميلات المحلي',
    localHistoryEmpty: 'لا يوجد سجل سابق.',
    loadHistoryUrl: 'استرجاع الرابط',
    clearLocalHistory: 'مسح السجل المحلي',
    saveToDropbox: 'حفظ في Dropbox',
    langSwitch: 'English',
    
    // Nav & Footer
    termsBtn: 'شروط الاستخدام',
    privacyBtn: 'سياسة الخصوصية',
    cleanRoomBtn: 'عن المشروع',
    bagbackTech: 'BagbackTech',
    portfolio: 'محمد أسامة',
    github: 'GitHub',
    
    // Modals
    termsTitle: 'شروط الاستخدام والخدمة',
    termsBody: `Bagback Download هو تطبيق وإطارية عمل مفتوحة المصدر (MIT License) مخصصة لإدارة وتحميل الوسائط الرقمية والملفات التي يمتلك المستخدم الحق القانوني في حفظها أو الوصول إليها.
- يقر المستخدم بمسؤوليته الكاملة عن أي محتوى يقوم بتحميله أو معالجته عبر التطبيق.
- يُحظر استخدام الخدمة في أي أنشطة تنتهك حقوق الملكية الفكرية أو القوانين المحلية والدولية.
- يتم تقديم البرمجية كما هي (As-Is) دون أي ضمانات صريحة أو ضمنية.`,
    
    privacyTitle: 'سياسة الخصوصية وأمان البيانات',
    privacyBody: `تولي Bagback Digital Solutions أهمية قصوى لخصوصية وسريّة بيانات المستخدمين:
- لا يتم حفظ أي سجلات تتبع (No Tracking) أو تقنيات ملفات تعريف ارتباط (Cookies) خارجية.
- جميع عمليات التحميل تتم مباشرة دون مشاركة بياناتك الشخصية مع أي طرف ثالث.
- يتم حذف الملفات المؤقتة من السيرفر فور اكتمال عملية التحميل أو حسب إعدادات التنفيذ.`,

    cleanRoomTitle: 'بيان المشروع والتطوير المستقل (Clean-Room Policy)',
    cleanRoomBody: `تم بناء Bagback Download بالكامل من الصفر بواسطة المهندس محمد أسامة وشركة Bagback Digital Solutions كمنتج أصلي مفتوح المصدر:
- التزام تام بسياسة Clean-Room Development دون نسخ أي كود أو واجهات من تطبيقات أخرى.
- ترخيص البرمجية: MIT License متاح للعامة على ريبوزيتوري GitHub.
- رؤية المنتجات: جزء من منظومة Bagback التقنية للحلول الرقمية المتطورة.`,

    closeModal: 'إغلاق',
    playlistTab: 'قائمة التشغيل بالكامل',
    singleVideoTab: 'الفيديو الحالي فقط',
    playlistBadge: 'قائمة تشغيل',
    playlistItemsLabel: 'عناصر قائمة التشغيل',
    selectAllItems: 'تحديد الكل',
    deselectAllItems: 'إلغاء تحديد الكل',
    startPlaylistVideo: 'تحميل القائمة كفيديو (MP4)',
    startPlaylistAudio: 'تحميل القائمة كصوت (MP3)',
    installApp: 'تثبيت التطبيق',
    installBannerTitle: 'ثبّت Bagback Download كتطبيق على هاتفك',
    installBannerDesc: 'وصول فوري من الشاشة الرئيسية وتجربة تحميل أسرع كأنه تطبيق أصلي تماماً.',
    installNowBtn: 'تثبيت الآن',
    dismissInstall: 'إغلاق شريط التثبيت',
    installIosTitle: 'تثبيت التطبيق على الهاتف',
    installIosBody: `لتثبيت Bagback Download كتطبيق مستقل على شاشتك الرئيسية:
- على آيفون (Safari): اضغط على زر المشاركة (Share) في شريط المتصفح، ثم اختر "إضافة إلى الشاشة الرئيسية" (Add to Home Screen) واضغط "إضافة".
- على أندرويد (Chrome): اضغط على قائمة المتصفح (النقاط الثلاث أعلى الشاشة) ثم اختر "تثبيت التطبيق" (Install app) أو "الإضافة إلى الشاشة الرئيسية".`,
  },
  en: {
    appName: 'Bagback Download',
    brandName: 'Bagback',
    brandSuffix: 'Download',
    tagline: 'Free, Open-Source Universal Media & File Download Manager',
    subtagline: 'Built with love for users without profit, by Bagback Digital Solutions & lead developer Mohamed Osama.',
    inputPlaceholder: 'Paste video or media link here...',
    analyze: 'Analyze',
    analyzing: 'Analyzing...',
    pasteClipboard: '📋 Paste from Clipboard',
    supportedSites: 'YouTube · TikTok · Instagram · Twitter · Facebook · & Thousands More',
    videoTab: '🎬 Video',
    audioTab: '🎵 Audio Only (MP3)',
    selectQuality: 'Select Quality',
    bestQuality: 'Best Quality',
    startDownload: 'Start Download',
    addingDownload: 'Adding...',
    downloading: 'Downloading',
    history: 'Download History',
    clearAll: 'Clear All',
    emptyQueue: 'Paste a link above to start downloading',
    statusQueued: 'Queued',
    statusRunning: 'Downloading',
    statusCompleted: 'Completed',
    statusFailed: 'Failed',
    openFile: 'Download File',
    deleteItem: 'Delete',
    legalNotice: 'Use this app only with media you have permission to download.',
    localHistoryTitle: 'Local Download History',
    localHistoryEmpty: 'No previous history.',
    loadHistoryUrl: 'Load Link',
    clearLocalHistory: 'Clear Local History',
    saveToDropbox: 'Save to Dropbox',
    langSwitch: 'عربي',
    
    // Nav & Footer
    termsBtn: 'Terms of Service',
    privacyBtn: 'Privacy Policy',
    cleanRoomBtn: 'About Project',
    bagbackTech: 'BagbackTech',
    portfolio: 'Mohamed Osama',
    github: 'GitHub',
    
    // Modals
    termsTitle: 'Terms of Service & Usage',
    termsBody: `Bagback Download is an open-source utility (MIT License) built for managing and downloading digital media and files that users have explicit legal rights to access.
- Users assume full responsibility for all content processed through the application.
- Infringing upon intellectual property or copyright laws is strictly prohibited.
- Software is provided "As-Is" without warranties of any kind.`,
    
    privacyTitle: 'Privacy Policy & Data Security',
    privacyBody: `Bagback Digital Solutions strictly prioritizes user privacy and security:
- Zero user tracking, zero third-party telemetry, zero commercial trackers.
- Downloads are processed directly without storing personal information.
- Temporary download files are automatically purged from server buffers upon completion.`,

    cleanRoomTitle: 'Clean-Room Engineering Statement',
    cleanRoomBody: `Bagback Download was engineered completely from scratch by Mohamed Osama and Bagback Digital Solutions as an original open-source product:
- Strict compliance with Clean-Room Development standards — zero copied source code or UI assets.
- License: MIT License publicly available on GitHub.
- Ecosystem: Proud component of the Bagback Digital Solutions technology suit.`,

    closeModal: 'Close',
    playlistTab: 'Entire Playlist',
    singleVideoTab: 'Current Video Only',
    playlistBadge: 'Playlist',
    playlistItemsLabel: 'Playlist Items',
    selectAllItems: 'Select All',
    deselectAllItems: 'Deselect All',
    startPlaylistVideo: 'Download Playlist as Video (MP4)',
    startPlaylistAudio: 'Download Playlist as Audio (MP3)',
    installApp: 'Install App',
    installBannerTitle: 'Install Bagback Download on Your Phone',
    installBannerDesc: 'Instant home screen access and faster full-screen downloads just like a native app.',
    installNowBtn: 'Install Now',
    dismissInstall: 'Dismiss install banner',
    installIosTitle: 'Install App on Your Phone',
    installIosBody: `To install Bagback Download as a standalone app on your home screen:
- On iPhone / iPad (Safari): Tap the Share button in Safari, scroll down and select "Add to Home Screen", then tap "Add".
- On Android (Chrome): Tap the browser menu (three dots at the top right) and select "Install app" or "Add to Home screen".`,
  }
} as const;

export type DictKeys = keyof typeof dict['ar'];

export function useTranslation(lang: Lang) {
  const t = useCallback((key: DictKeys): string => {
    return dict[lang][key] || dict.ar[key] || '';
  }, [lang]);
  
  return t;
}
export type TFunction = ReturnType<typeof useTranslation>;
