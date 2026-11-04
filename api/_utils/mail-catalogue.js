/**
 * R43-MAIL — the subject line and the neutral opening of every transactional e-mail a person receives, in the six interface languages
 * (src/i18n/languages.js; French is the source, the five others are comprehension aids drafted by AI and not yet reviewed by native speakers).
 *
 * Non-disclosure rule (data minimisation; a subject is shown on a locked phone and in a shared inbox): a subject names the KIND of message and the site,
 * never a structure, a service, a reason, a person, a date or the text of a message. The refusal says « réponse à votre demande », not « refusée ». Bodies
 * built by the handlers may add the date and the place; these openings do not. Placeholders: none (tests/unit/r43-mail-catalogue.test.js enforces both).
 *
 * French subjects are the ones the handlers already send (unchanged wording), so adopting the catalogue changes nothing for a French reader.
 */
import { LANGUAGE_CODES, SOURCE_LANGUAGE, languageOf, matchLanguage } from '../../src/i18n/languages.js';

export const MAIL_KINDS = Object.freeze([
  'account_verification', 'password_reset', 'appointment_request', 'appointment_confirmation', 'appointment_refusal',
  'appointment_cancellation', 'appointment_rescheduled', 'appointment_reminder', 'pro_invitation',
  // R43 follow-up: the video-access change and the new-message alert (no message text, no structure in any of them)
  'appointment_video', 'appointment_message',
]);

/** @typedef {{ subject: string, heading: string, intro: string, cta: string }} MailText */
/** @typedef {Record<string, MailText>} MailTexts */

/** @type {Readonly<Record<string, MailTexts>>} */
const CATALOGUE = Object.freeze({
  fr: {
    account_verification: { subject: 'Bienvenue sur Accès Direct Aide — Vérifiez votre email', heading: 'Vérifiez votre adresse e-mail', intro: 'Pour activer votre compte, confirmez votre adresse e-mail avec le lien ci-dessous.', cta: 'Vérifier mon adresse email' },
    password_reset: { subject: 'Réinitialisation de votre mot de passe — Accès Direct Aide', heading: 'Réinitialisation du mot de passe', intro: 'Vous avez demandé à choisir un nouveau mot de passe. Si ce n’est pas vous, ignorez ce message.', cta: 'Réinitialiser mon mot de passe' },
    appointment_request: { subject: 'Votre demande de rendez-vous - Accès Direct Aide', heading: 'Demande de rendez-vous reçue', intro: 'Votre demande a bien été transmise. Vous recevrez un autre message quand elle aura une réponse.', cta: 'Ouvrir mon espace' },
    appointment_confirmation: { subject: 'Votre rendez-vous est confirmé - Accès Direct Aide', heading: 'Rendez-vous confirmé', intro: 'Votre rendez-vous est confirmé. Les détails sont dans votre espace et ci-dessous.', cta: 'Ouvrir mon espace' },
    appointment_refusal: { subject: 'Réponse à votre demande de rendez-vous - Accès Direct Aide', heading: 'Réponse à votre demande', intro: 'Votre demande de rendez-vous a reçu une réponse. Connectez-vous à votre espace pour la lire.', cta: 'Ouvrir mon espace' },
    appointment_cancellation: { subject: 'Votre rendez-vous a été annulé - Accès Direct Aide', heading: 'Rendez-vous annulé', intro: 'Un de vos rendez-vous a été annulé. Vous pouvez en demander un autre depuis votre espace.', cta: 'Ouvrir mon espace' },
    appointment_rescheduled: { subject: 'Votre rendez-vous est déplacé - Accès Direct Aide', heading: 'Rendez-vous déplacé', intro: 'L’horaire d’un de vos rendez-vous a changé. Le nouvel horaire est dans votre espace.', cta: 'Ouvrir mon espace' },
    appointment_reminder: { subject: 'Rappel de votre rendez-vous - Accès Direct Aide', heading: 'Rappel de rendez-vous', intro: 'Ceci est un rappel : vous avez un rendez-vous prochainement.', cta: 'Ouvrir mon espace' },
    pro_invitation: { subject: 'Invitation à rejoindre une équipe sur Accès Direct Aide', heading: 'Invitation', intro: 'Vous êtes invité à rejoindre une équipe professionnelle. Le lien ci-dessous vous permet d’accepter.', cta: 'Accepter l’invitation' },
    appointment_video: { subject: 'Votre rendez-vous en visio - Accès Direct Aide', heading: 'Rendez-vous en visio', intro: 'L’accès en visio d’un de vos rendez-vous a changé. Les détails sont dans votre espace.', cta: 'Ouvrir mon espace' },
    appointment_message: { subject: 'Nouveau message concernant votre rendez-vous - Accès Direct Aide', heading: 'Nouveau message', intro: 'Vous avez reçu un nouveau message. Connectez-vous à votre espace pour le lire.', cta: 'Ouvrir mon espace' },
  },
  en: {
    account_verification: { subject: 'Welcome to Accès Direct Aide — Verify your email', heading: 'Verify your email address', intro: 'To activate your account, confirm your email address with the link below.', cta: 'Verify my email address' },
    password_reset: { subject: 'Reset your password — Accès Direct Aide', heading: 'Password reset', intro: 'You asked to choose a new password. If this was not you, ignore this message.', cta: 'Reset my password' },
    appointment_request: { subject: 'Your appointment request - Accès Direct Aide', heading: 'Appointment request received', intro: 'Your request has been sent. You will receive another message when it has been answered.', cta: 'Open my account' },
    appointment_confirmation: { subject: 'Your appointment is confirmed - Accès Direct Aide', heading: 'Appointment confirmed', intro: 'Your appointment is confirmed. The details are in your account and below.', cta: 'Open my account' },
    appointment_refusal: { subject: 'Reply to your appointment request - Accès Direct Aide', heading: 'Reply to your request', intro: 'Your appointment request has received a reply. Sign in to your account to read it.', cta: 'Open my account' },
    appointment_cancellation: { subject: 'Your appointment has been cancelled - Accès Direct Aide', heading: 'Appointment cancelled', intro: 'One of your appointments has been cancelled. You can request another one from your account.', cta: 'Open my account' },
    appointment_rescheduled: { subject: 'Your appointment has been moved - Accès Direct Aide', heading: 'Appointment moved', intro: 'The time of one of your appointments has changed. The new time is in your account.', cta: 'Open my account' },
    appointment_reminder: { subject: 'Reminder of your appointment - Accès Direct Aide', heading: 'Appointment reminder', intro: 'This is a reminder: you have an appointment soon.', cta: 'Open my account' },
    pro_invitation: { subject: 'Invitation to join a team on Accès Direct Aide', heading: 'Invitation', intro: 'You are invited to join a professional team. The link below lets you accept.', cta: 'Accept the invitation' },
    appointment_video: { subject: 'Your video appointment - Accès Direct Aide', heading: 'Video appointment', intro: 'The video access of one of your appointments has changed. The details are in your account.', cta: 'Open my account' },
    appointment_message: { subject: 'New message about your appointment - Accès Direct Aide', heading: 'New message', intro: 'You have received a new message. Sign in to your account to read it.', cta: 'Open my account' },
  },
  tr: {
    account_verification: { subject: 'Accès Direct Aide’a hoş geldiniz — E-postanızı doğrulayın', heading: 'E-posta adresinizi doğrulayın', intro: 'Hesabınızı etkinleştirmek için aşağıdaki bağlantıyla e-posta adresinizi onaylayın.', cta: 'E-posta adresimi doğrula' },
    password_reset: { subject: 'Şifrenizi sıfırlayın — Accès Direct Aide', heading: 'Şifre sıfırlama', intro: 'Yeni bir şifre seçmek istediniz. Bu talebi siz yapmadıysanız bu mesajı dikkate almayın.', cta: 'Şifremi sıfırla' },
    appointment_request: { subject: 'Randevu talebiniz - Accès Direct Aide', heading: 'Randevu talebi alındı', intro: 'Talebiniz iletildi. Yanıtlandığında başka bir mesaj alacaksınız.', cta: 'Hesabımı aç' },
    appointment_confirmation: { subject: 'Randevunuz onaylandı - Accès Direct Aide', heading: 'Randevu onaylandı', intro: 'Randevunuz onaylandı. Ayrıntılar hesabınızda ve aşağıda yer alıyor.', cta: 'Hesabımı aç' },
    appointment_refusal: { subject: 'Randevu talebinize yanıt - Accès Direct Aide', heading: 'Talebinize yanıt', intro: 'Randevu talebiniz yanıtlandı. Okumak için hesabınıza giriş yapın.', cta: 'Hesabımı aç' },
    appointment_cancellation: { subject: 'Randevunuz iptal edildi - Accès Direct Aide', heading: 'Randevu iptal edildi', intro: 'Randevularınızdan biri iptal edildi. Hesabınızdan yeni bir randevu talep edebilirsiniz.', cta: 'Hesabımı aç' },
    appointment_rescheduled: { subject: 'Randevunuzun saati değişti - Accès Direct Aide', heading: 'Randevu saati değişti', intro: 'Randevularınızdan birinin saati değişti. Yeni saat hesabınızda yer alıyor.', cta: 'Hesabımı aç' },
    appointment_reminder: { subject: 'Randevu hatırlatması - Accès Direct Aide', heading: 'Randevu hatırlatması', intro: 'Bu bir hatırlatmadır: yakında bir randevunuz var.', cta: 'Hesabımı aç' },
    pro_invitation: { subject: 'Accès Direct Aide’da bir ekibe katılma daveti', heading: 'Davet', intro: 'Profesyonel bir ekibe katılmaya davet edildiniz. Kabul etmek için aşağıdaki bağlantıyı kullanın.', cta: 'Daveti kabul et' },
    appointment_video: { subject: 'Görüntülü randevunuz - Accès Direct Aide', heading: 'Görüntülü randevu', intro: 'Randevularınızdan birinin görüntülü erişimi değişti. Ayrıntılar hesabınızda yer alıyor.', cta: 'Hesabımı aç' },
    appointment_message: { subject: 'Randevunuzla ilgili yeni mesaj - Accès Direct Aide', heading: 'Yeni mesaj', intro: 'Yeni bir mesaj aldınız. Okumak için hesabınıza giriş yapın.', cta: 'Hesabımı aç' },
  },
  ar: {
    account_verification: { subject: 'مرحبًا بك في Accès Direct Aide — تحقق من بريدك الإلكتروني', heading: 'تحقق من عنوان بريدك الإلكتروني', intro: 'لتفعيل حسابك، أكّد عنوان بريدك الإلكتروني عبر الرابط أدناه.', cta: 'تحقق من بريدي الإلكتروني' },
    password_reset: { subject: 'إعادة تعيين كلمة المرور — Accès Direct Aide', heading: 'إعادة تعيين كلمة المرور', intro: 'لقد طلبت اختيار كلمة مرور جديدة. إذا لم تكن أنت من طلب ذلك، فتجاهل هذه الرسالة.', cta: 'إعادة تعيين كلمة المرور' },
    appointment_request: { subject: 'طلب موعدك - Accès Direct Aide', heading: 'تم استلام طلب الموعد', intro: 'تم إرسال طلبك. ستصلك رسالة أخرى عند الرد عليه.', cta: 'فتح حسابي' },
    appointment_confirmation: { subject: 'تم تأكيد موعدك - Accès Direct Aide', heading: 'تم تأكيد الموعد', intro: 'تم تأكيد موعدك. التفاصيل موجودة في حسابك وأدناه.', cta: 'فتح حسابي' },
    appointment_refusal: { subject: 'رد على طلب موعدك - Accès Direct Aide', heading: 'رد على طلبك', intro: 'تلقّى طلب موعدك ردًا. سجّل الدخول إلى حسابك لقراءته.', cta: 'فتح حسابي' },
    appointment_cancellation: { subject: 'تم إلغاء موعدك - Accès Direct Aide', heading: 'تم إلغاء الموعد', intro: 'تم إلغاء أحد مواعيدك. يمكنك طلب موعد آخر من حسابك.', cta: 'فتح حسابي' },
    appointment_rescheduled: { subject: 'تم تغيير موعدك - Accès Direct Aide', heading: 'تم تغيير الموعد', intro: 'تغيّر وقت أحد مواعيدك. الوقت الجديد موجود في حسابك.', cta: 'فتح حسابي' },
    appointment_reminder: { subject: 'تذكير بموعدك - Accès Direct Aide', heading: 'تذكير بالموعد', intro: 'هذا تذكير: لديك موعد قريبًا.', cta: 'فتح حسابي' },
    pro_invitation: { subject: 'دعوة للانضمام إلى فريق على Accès Direct Aide', heading: 'دعوة', intro: 'أنت مدعو للانضمام إلى فريق مهني. يتيح لك الرابط أدناه القبول.', cta: 'قبول الدعوة' },
    appointment_video: { subject: 'موعدك عبر الفيديو - Accès Direct Aide', heading: 'موعد عبر الفيديو', intro: 'تغيّر الوصول عبر الفيديو لأحد مواعيدك. التفاصيل موجودة في حسابك.', cta: 'فتح حسابي' },
    appointment_message: { subject: 'رسالة جديدة بخصوص موعدك - Accès Direct Aide', heading: 'رسالة جديدة', intro: 'وصلتك رسالة جديدة. سجّل الدخول إلى حسابك لقراءتها.', cta: 'فتح حسابي' },
  },
  de: {
    account_verification: { subject: 'Willkommen bei Accès Direct Aide — Bestätigen Sie Ihre E-Mail', heading: 'Bestätigen Sie Ihre E-Mail-Adresse', intro: 'Um Ihr Konto zu aktivieren, bestätigen Sie Ihre E-Mail-Adresse über den Link unten.', cta: 'Meine E-Mail-Adresse bestätigen' },
    password_reset: { subject: 'Passwort zurücksetzen — Accès Direct Aide', heading: 'Passwort zurücksetzen', intro: 'Sie möchten ein neues Passwort wählen. Wenn Sie das nicht waren, ignorieren Sie diese Nachricht.', cta: 'Mein Passwort zurücksetzen' },
    appointment_request: { subject: 'Ihre Terminanfrage - Accès Direct Aide', heading: 'Terminanfrage erhalten', intro: 'Ihre Anfrage wurde übermittelt. Sie erhalten eine weitere Nachricht, sobald sie beantwortet wurde.', cta: 'Mein Konto öffnen' },
    appointment_confirmation: { subject: 'Ihr Termin ist bestätigt - Accès Direct Aide', heading: 'Termin bestätigt', intro: 'Ihr Termin ist bestätigt. Die Einzelheiten finden Sie in Ihrem Konto und unten.', cta: 'Mein Konto öffnen' },
    appointment_refusal: { subject: 'Antwort auf Ihre Terminanfrage - Accès Direct Aide', heading: 'Antwort auf Ihre Anfrage', intro: 'Ihre Terminanfrage wurde beantwortet. Melden Sie sich in Ihrem Konto an, um die Antwort zu lesen.', cta: 'Mein Konto öffnen' },
    appointment_cancellation: { subject: 'Ihr Termin wurde abgesagt - Accès Direct Aide', heading: 'Termin abgesagt', intro: 'Einer Ihrer Termine wurde abgesagt. Sie können in Ihrem Konto einen neuen anfragen.', cta: 'Mein Konto öffnen' },
    appointment_rescheduled: { subject: 'Ihr Termin wurde verschoben - Accès Direct Aide', heading: 'Termin verschoben', intro: 'Die Uhrzeit eines Ihrer Termine hat sich geändert. Die neue Uhrzeit steht in Ihrem Konto.', cta: 'Mein Konto öffnen' },
    appointment_reminder: { subject: 'Erinnerung an Ihren Termin - Accès Direct Aide', heading: 'Terminerinnerung', intro: 'Dies ist eine Erinnerung: Sie haben bald einen Termin.', cta: 'Mein Konto öffnen' },
    pro_invitation: { subject: 'Einladung in ein Team auf Accès Direct Aide', heading: 'Einladung', intro: 'Sie sind eingeladen, einem professionellen Team beizutreten. Über den Link unten können Sie annehmen.', cta: 'Einladung annehmen' },
    appointment_video: { subject: 'Ihr Video-Termin - Accès Direct Aide', heading: 'Video-Termin', intro: 'Der Videozugang eines Ihrer Termine hat sich geändert. Die Einzelheiten stehen in Ihrem Konto.', cta: 'Mein Konto öffnen' },
    appointment_message: { subject: 'Neue Nachricht zu Ihrem Termin - Accès Direct Aide', heading: 'Neue Nachricht', intro: 'Sie haben eine neue Nachricht erhalten. Melden Sie sich in Ihrem Konto an, um sie zu lesen.', cta: 'Mein Konto öffnen' },
  },
  uk: {
    account_verification: { subject: 'Ласкаво просимо до Accès Direct Aide — Підтвердьте електронну пошту', heading: 'Підтвердьте адресу електронної пошти', intro: 'Щоб активувати обліковий запис, підтвердьте адресу електронної пошти за посиланням нижче.', cta: 'Підтвердити мою електронну пошту' },
    password_reset: { subject: 'Скидання пароля — Accès Direct Aide', heading: 'Скидання пароля', intro: 'Ви попросили вибрати новий пароль. Якщо це були не ви, проігноруйте це повідомлення.', cta: 'Скинути мій пароль' },
    appointment_request: { subject: 'Ваш запит на зустріч - Accès Direct Aide', heading: 'Запит на зустріч отримано', intro: 'Ваш запит передано. Ви отримаєте ще одне повідомлення, коли на нього відповідять.', cta: 'Відкрити мій обліковий запис' },
    appointment_confirmation: { subject: 'Вашу зустріч підтверджено - Accès Direct Aide', heading: 'Зустріч підтверджено', intro: 'Вашу зустріч підтверджено. Подробиці — у вашому обліковому записі та нижче.', cta: 'Відкрити мій обліковий запис' },
    appointment_refusal: { subject: 'Відповідь на ваш запит на зустріч - Accès Direct Aide', heading: 'Відповідь на ваш запит', intro: 'На ваш запит на зустріч надійшла відповідь. Увійдіть до облікового запису, щоб її прочитати.', cta: 'Відкрити мій обліковий запис' },
    appointment_cancellation: { subject: 'Вашу зустріч скасовано - Accès Direct Aide', heading: 'Зустріч скасовано', intro: 'Одну з ваших зустрічей скасовано. Ви можете попросити іншу у своєму обліковому записі.', cta: 'Відкрити мій обліковий запис' },
    appointment_rescheduled: { subject: 'Вашу зустріч перенесено - Accès Direct Aide', heading: 'Зустріч перенесено', intro: 'Час однієї з ваших зустрічей змінився. Новий час — у вашому обліковому записі.', cta: 'Відкрити мій обліковий запис' },
    appointment_reminder: { subject: 'Нагадування про вашу зустріч - Accès Direct Aide', heading: 'Нагадування про зустріч', intro: 'Це нагадування: незабаром у вас зустріч.', cta: 'Відкрити мій обліковий запис' },
    pro_invitation: { subject: 'Запрошення приєднатися до команди на Accès Direct Aide', heading: 'Запрошення', intro: 'Вас запрошено приєднатися до професійної команди. Посилання нижче дає змогу прийняти запрошення.', cta: 'Прийняти запрошення' },
    appointment_video: { subject: 'Ваша відеозустріч - Accès Direct Aide', heading: 'Відеозустріч', intro: 'Доступ до відеозустрічі однієї з ваших зустрічей змінився. Подробиці — у вашому обліковому записі.', cta: 'Відкрити мій обліковий запис' },
    appointment_message: { subject: 'Нове повідомлення щодо вашої зустрічі - Accès Direct Aide', heading: 'Нове повідомлення', intro: 'Ви отримали нове повідомлення. Увійдіть до облікового запису, щоб його прочитати.', cta: 'Відкрити мій обліковий запис' },
  },
});

/** the supported language of a person (« ar-MA » → ar), French otherwise @param {unknown} lang @returns {string} */
export function mailLanguage(lang) {
  const code = typeof lang === 'string' ? (matchLanguage(lang) || '') : '';
  return LANGUAGE_CODES.includes(code) ? code : SOURCE_LANGUAGE;
}

/**
 * The subject, heading, opening line and button label of one kind of e-mail, with the text direction of its language.
 * @param {string} kind one of MAIL_KINDS @param {unknown} [lang]
 * @returns {MailText & { lang: string, dir: 'ltr' | 'rtl' }}
 */
export function mailText(kind, lang) {
  if (!MAIL_KINDS.includes(kind)) throw new Error(`unknown mail kind: ${kind}`);
  const code = mailLanguage(lang);
  const entry = CATALOGUE[code]?.[kind] || CATALOGUE[SOURCE_LANGUAGE][kind];
  return { ...entry, lang: code, dir: languageOf(code)?.dir || 'ltr' };
}

/**
 * The notice kinds of api/_services/appointment-notices.js → their e-mail kind (GUEST_CODE keeps its own subject: it carries a code, not a notice).
 * @type {Readonly<Record<string, string>>}
 */
export const NOTICE_MAIL_KINDS = Object.freeze({
  REQUEST_RECEIVED: 'appointment_request', REQUEST_ACCEPTED: 'appointment_confirmation', BOOKED_BY_STRUCTURE: 'appointment_confirmation',
  BOOKED_BY_CITIZEN: 'appointment_confirmation', BOOKED_BY_GUEST: 'appointment_confirmation', REQUEST_REFUSED: 'appointment_refusal',
  REQUEST_EXPIRED: 'appointment_refusal', CANCELLED_BY_CITIZEN: 'appointment_cancellation', CANCELLED_BY_STRUCTURE: 'appointment_cancellation',
  RESCHEDULED: 'appointment_rescheduled', REMINDER_J1: 'appointment_reminder', VISIO_APPROVED: 'appointment_video', VISIO_REVOKED: 'appointment_video',
});

/**
 * A plain-text e-mail in the reader's language: the neutral subject of its kind; for another language than French, the heading and opening line in
 * that language first, then the French text (the source wording, with the date and details) unchanged.
 * @param {string} kind one of MAIL_KINDS @param {unknown} lang @param {string} frenchText @returns {{ subject: string, text: string, lang: string }}
 */
export function localizedMail(kind, lang, frenchText) {
  const t = mailText(kind, lang);
  return { subject: t.subject, text: t.lang === 'fr' ? frenchText : `${t.heading}\n${t.intro}\n\n---\n\n${frenchText}`, lang: t.lang };
}

/** the whole catalogue (tests, coverage report) @returns {Readonly<Record<string, MailTexts>>} */
export function mailCatalogue() {
  return CATALOGUE;
}
