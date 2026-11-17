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
  // A-15 remainder: the account e-mails that had no entry (Mon Parcours reminder, delegation invitation, e-mail change, restriction lift, recovery)
  'parcours_reminder', 'delegation_invitation', 'email_change_confirm', 'email_change_notice', 'restriction_lift', 'account_recovery', 'account_recovery_notice',
]);

/** @typedef {{ subject: string, heading: string, intro: string, cta: string }} MailText */
/** @typedef {Record<string, MailText>} MailTexts */

/** @type {Readonly<Record<string, MailTexts>>} */
const CATALOGUE = Object.freeze({
  fr: {
    account_verification: { subject: 'Bienvenue sur Accès Direct Aide — Vérifiez votre email', heading: 'Vérifiez votre adresse e-mail', intro: 'Pour activer votre compte, confirmez votre adresse e-mail avec le lien ci-dessous.', cta: 'Vérifier mon adresse email' },
    password_reset: { subject: 'Réinitialisation de votre mot de passe — Accès Direct Aide', heading: 'Réinitialisation du mot de passe', intro: 'Vous avez demandé à choisir un nouveau mot de passe. Si ce n’est pas vous, ignorez ce message.', cta: 'Réinitialiser mon mot de passe' },
    appointment_request: { subject: 'Votre demande de rendez-vous - Accès Direct Aide', heading: 'Demande de rendez-vous reçue', intro: 'Votre demande a bien été transmise. Vous recevrez un autre message quand elle aura une réponse.', cta: 'Ouvrir mon espace' },
    appointment_confirmation: { subject: 'Confirmation de votre rendez-vous - Accès Direct Aide', heading: 'Rendez-vous confirmé', intro: 'Votre rendez-vous est confirmé. Les détails sont dans votre espace et ci-dessous.', cta: 'Ouvrir mon espace' },
    appointment_refusal: { subject: 'Réponse à votre demande de rendez-vous - Accès Direct Aide', heading: 'Réponse à votre demande', intro: 'Votre demande de rendez-vous a reçu une réponse. Connectez-vous à votre espace pour la lire.', cta: 'Ouvrir mon espace' },
    appointment_cancellation: { subject: 'Votre rendez-vous a été annulé - Accès Direct Aide', heading: 'Rendez-vous annulé', intro: 'Un de vos rendez-vous a été annulé. Vous pouvez en demander un autre depuis votre espace.', cta: 'Ouvrir mon espace' },
    appointment_rescheduled: { subject: 'Votre rendez-vous est déplacé - Accès Direct Aide', heading: 'Rendez-vous déplacé', intro: 'L’horaire d’un de vos rendez-vous a changé. Le nouvel horaire est dans votre espace.', cta: 'Ouvrir mon espace' },
    appointment_reminder: { subject: 'Rappel de votre rendez-vous - Accès Direct Aide', heading: 'Rappel de rendez-vous', intro: 'Ceci est un rappel : vous avez un rendez-vous prochainement.', cta: 'Ouvrir mon espace' },
    pro_invitation: { subject: 'Invitation à rejoindre une équipe sur Accès Direct Aide', heading: 'Invitation', intro: 'Vous êtes invité à rejoindre une équipe professionnelle. Le lien ci-dessous vous permet d’accepter.', cta: 'Accepter l’invitation' },
    appointment_video: { subject: 'Votre rendez-vous en visio - Accès Direct Aide', heading: 'Rendez-vous en visio', intro: 'L’accès en visio d’un de vos rendez-vous a changé. Les détails sont dans votre espace.', cta: 'Ouvrir mon espace' },
    appointment_message: { subject: 'Nouveau message concernant votre rendez-vous - Accès Direct Aide', heading: 'Nouveau message', intro: 'Vous avez reçu un nouveau message. Connectez-vous à votre espace pour le lire.', cta: 'Ouvrir mon espace' },
    // A-15 remainder: the account e-mails (French subjects = the ones the handlers already send)
    parcours_reminder: { subject: 'Rappel : une étape de Mon Parcours arrive à échéance', heading: 'Rappel Mon Parcours', intro: 'Une étape de votre parcours arrive bientôt à échéance. Connectez-vous à Mon Espace (Mon Parcours) pour la voir.', cta: 'Ouvrir Mon Parcours' },
    delegation_invitation: { subject: 'Invitation : personne de confiance sur AccesDirectAide', heading: 'Invitation : personne de confiance', intro: 'Une personne vous propose de consulter une partie de son espace, en lecture seule et pour une durée limitée. Pour accepter ou refuser, connectez-vous avec cette adresse e-mail puis ouvrez le lien ci-dessous. Si vous ne connaissez pas cette personne, ignorez ce message.', cta: 'Voir l’invitation' },
    email_change_confirm: { subject: 'Confirmez votre nouvelle adresse — Accès Direct Aide', heading: 'Nouvelle adresse e-mail', intro: 'Vous avez demandé que cette adresse devienne celle de votre compte. Pour confirmer, utilisez le bouton ci-dessous. Si vous n’avez pas fait cette demande, ignorez ce message : rien ne changera.', cta: 'Confirmer cette adresse' },
    email_change_notice: { subject: 'Demande de changement d’adresse — Accès Direct Aide', heading: 'Changement d’adresse demandé', intro: 'Une demande de changement de l’adresse e-mail de votre compte vient d’être faite. Si ce n’est pas vous, connectez-vous et changez votre mot de passe : tant que la nouvelle adresse n’est pas confirmée, rien ne change.', cta: 'Ouvrir mon espace' },
    restriction_lift: { subject: 'Fin de la limitation du traitement de vos données', heading: 'Fin de la limitation du traitement', intro: 'L’équipe va lever la limitation du traitement de vos données que vous aviez demandée. La raison est indiquée ci-dessous. Vous pouvez en demander une nouvelle à tout moment depuis votre compte.', cta: 'Ouvrir mon espace' },
    account_recovery: { subject: 'Récupération de votre compte Accès Direct Aide', heading: 'Récupération de votre compte', intro: 'Notre équipe a rattaché votre compte à cette adresse après vérification de votre identité. Confirmez l’adresse et choisissez votre mot de passe avec le lien ci-dessous. Si vous n’êtes pas à l’origine de cette demande, contactez-nous.', cta: 'Confirmer mon adresse' },
    account_recovery_notice: { subject: 'L’adresse de votre compte a été changée', heading: 'Adresse du compte changée', intro: 'L’adresse e-mail de votre compte a été remplacée à la suite d’une demande de récupération vérifiée par notre équipe. Si ce n’est pas vous, contactez-nous sans attendre.', cta: 'Nous contacter' },
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
    // A-15 remainder: the account e-mails (French subjects = the ones the handlers already send)
    parcours_reminder: { subject: 'Reminder: a step of My Journey is due soon - Accès Direct Aide', heading: 'My Journey reminder', intro: 'A step of your journey is due soon. Sign in to My Space (My Journey) to see it.', cta: 'Open My Journey' },
    delegation_invitation: { subject: 'Invitation: trusted person on Accès Direct Aide', heading: 'Invitation: trusted person', intro: 'Someone invites you to view part of their account, read-only and for a limited time. To accept or decline, sign in with this email address and open the link below. If you do not know this person, ignore this message.', cta: 'See the invitation' },
    email_change_confirm: { subject: 'Confirm your new address — Accès Direct Aide', heading: 'New email address', intro: 'You asked for this address to become the address of your account. To confirm, use the button below. If you did not make this request, ignore this message: nothing will change.', cta: 'Confirm this address' },
    email_change_notice: { subject: 'Address change requested — Accès Direct Aide', heading: 'Address change requested', intro: 'A request to change the email address of your account has just been made. If this was not you, sign in and change your password: as long as the new address is not confirmed, nothing changes.', cta: 'Open my account' },
    restriction_lift: { subject: 'End of the restriction of processing of your data - Accès Direct Aide', heading: 'End of the restriction of processing', intro: 'The team is going to lift the restriction of processing of your data that you had requested. The reason is given below (in French). You can request a new restriction at any time from your account.', cta: 'Open my account' },
    account_recovery: { subject: 'Recovery of your Accès Direct Aide account', heading: 'Recovery of your account', intro: 'Our team has linked your account to this address after checking your identity. Confirm the address and choose your password with the link below. If you did not make this request, contact us.', cta: 'Confirm my address' },
    account_recovery_notice: { subject: 'The address of your account has been changed - Accès Direct Aide', heading: 'Account address changed', intro: 'The email address of your account has been replaced following a recovery request checked by our team. If this was not you, contact us without delay.', cta: 'Contact us' },
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
    // A-15 remainder: the account e-mails (French subjects = the ones the handlers already send)
    parcours_reminder: { subject: 'Hatırlatma: Sürecim’deki bir adımın son tarihi yaklaşıyor - Accès Direct Aide', heading: 'Sürecim hatırlatması', intro: 'Sürecinizdeki bir adımın son tarihi yaklaşıyor. Görmek için Alanım’a (Sürecim) giriş yapın.', cta: 'Sürecim’i aç' },
    delegation_invitation: { subject: 'Davet: Accès Direct Aide’da güvenilir kişi', heading: 'Davet: güvenilir kişi', intro: 'Bir kişi, hesabının bir bölümünü salt okunur olarak ve sınırlı bir süre için görüntülemenizi öneriyor. Kabul etmek veya reddetmek için bu e-posta adresiyle giriş yapın ve aşağıdaki bağlantıyı açın. Bu kişiyi tanımıyorsanız bu mesajı dikkate almayın.', cta: 'Daveti görüntüle' },
    email_change_confirm: { subject: 'Yeni adresinizi onaylayın — Accès Direct Aide', heading: 'Yeni e-posta adresi', intro: 'Bu adresin hesabınızın adresi olmasını istediniz. Onaylamak için aşağıdaki düğmeyi kullanın. Bu talebi siz yapmadıysanız bu mesajı dikkate almayın: hiçbir şey değişmeyecek.', cta: 'Bu adresi onayla' },
    email_change_notice: { subject: 'Adres değişikliği talebi — Accès Direct Aide', heading: 'Adres değişikliği istendi', intro: 'Hesabınızın e-posta adresini değiştirmek için az önce bir talep yapıldı. Bu siz değilseniz giriş yapın ve şifrenizi değiştirin: yeni adres onaylanmadığı sürece hiçbir şey değişmez.', cta: 'Hesabımı aç' },
    restriction_lift: { subject: 'Verilerinizin işlenmesine ilişkin kısıtlamanın sona ermesi - Accès Direct Aide', heading: 'İşleme kısıtlamasının sona ermesi', intro: 'Ekip, talep ettiğiniz veri işleme kısıtlamasını kaldırmak üzere. Gerekçe aşağıda (Fransızca) yer alıyor. Hesabınızdan istediğiniz zaman yeni bir kısıtlama talep edebilirsiniz.', cta: 'Hesabımı aç' },
    account_recovery: { subject: 'Accès Direct Aide hesabınızın kurtarılması', heading: 'Hesabınızın kurtarılması', intro: 'Ekibimiz kimliğinizi doğruladıktan sonra hesabınızı bu adrese bağladı. Aşağıdaki bağlantıyla adresi onaylayın ve şifrenizi seçin. Bu talebi siz yapmadıysanız bizimle iletişime geçin.', cta: 'Adresimi onayla' },
    account_recovery_notice: { subject: 'Hesabınızın adresi değiştirildi - Accès Direct Aide', heading: 'Hesap adresi değişti', intro: 'Hesabınızın e-posta adresi, ekibimizin doğruladığı bir kurtarma talebi üzerine değiştirildi. Bu siz değilseniz hemen bizimle iletişime geçin.', cta: 'Bize ulaşın' },
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
    // A-15 remainder: the account e-mails (French subjects = the ones the handlers already send)
    parcours_reminder: { subject: 'تذكير: يقترب الموعد النهائي لخطوة في مساري - Accès Direct Aide', heading: 'تذكير مساري', intro: 'يقترب الموعد النهائي لإحدى خطوات مسارك. سجّل الدخول إلى مساحتي (مساري) للاطلاع عليها.', cta: 'فتح مساري' },
    delegation_invitation: { subject: 'دعوة: شخص موثوق على Accès Direct Aide', heading: 'دعوة: شخص موثوق', intro: 'يقترح عليك شخص الاطلاع على جزء من حسابه، للقراءة فقط ولمدة محدودة. للقبول أو الرفض، سجّل الدخول بعنوان البريد الإلكتروني هذا ثم افتح الرابط أدناه. إذا كنت لا تعرف هذا الشخص، فتجاهل هذه الرسالة.', cta: 'عرض الدعوة' },
    email_change_confirm: { subject: 'أكّد عنوانك الجديد — Accès Direct Aide', heading: 'عنوان بريد إلكتروني جديد', intro: 'طلبت أن يصبح هذا العنوان عنوان حسابك. للتأكيد، استخدم الزر أدناه. إذا لم تقدّم هذا الطلب، فتجاهل هذه الرسالة: لن يتغير شيء.', cta: 'تأكيد هذا العنوان' },
    email_change_notice: { subject: 'طلب تغيير العنوان — Accès Direct Aide', heading: 'تم طلب تغيير العنوان', intro: 'تم للتو تقديم طلب لتغيير عنوان البريد الإلكتروني لحسابك. إذا لم تكن أنت، فسجّل الدخول وغيّر كلمة المرور: ما دام العنوان الجديد غير مؤكَّد، لا يتغير شيء.', cta: 'فتح حسابي' },
    restriction_lift: { subject: 'انتهاء تقييد معالجة بياناتك - Accès Direct Aide', heading: 'انتهاء تقييد المعالجة', intro: 'سيرفع الفريق تقييد معالجة بياناتك الذي كنت قد طلبته. السبب مذكور أدناه (بالفرنسية). يمكنك طلب تقييد جديد في أي وقت من حسابك.', cta: 'فتح حسابي' },
    account_recovery: { subject: 'استعادة حسابك على Accès Direct Aide', heading: 'استعادة حسابك', intro: 'ربط فريقنا حسابك بهذا العنوان بعد التحقق من هويتك. أكّد العنوان واختر كلمة المرور عبر الرابط أدناه. إذا لم تكن أنت من قدّم هذا الطلب، فاتصل بنا.', cta: 'تأكيد عنواني' },
    account_recovery_notice: { subject: 'تم تغيير عنوان حسابك - Accès Direct Aide', heading: 'تم تغيير عنوان الحساب', intro: 'تم استبدال عنوان البريد الإلكتروني لحسابك إثر طلب استعادة تحقّق منه فريقنا. إذا لم تكن أنت، فاتصل بنا دون تأخير.', cta: 'اتصل بنا' },
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
    // A-15 remainder: the account e-mails (French subjects = the ones the handlers already send)
    parcours_reminder: { subject: 'Erinnerung: Ein Schritt in Mein Weg wird bald fällig - Accès Direct Aide', heading: 'Erinnerung Mein Weg', intro: 'Ein Schritt Ihres Weges wird bald fällig. Melden Sie sich in Mein Bereich (Mein Weg) an, um ihn zu sehen.', cta: 'Mein Weg öffnen' },
    delegation_invitation: { subject: 'Einladung: Vertrauensperson bei Accès Direct Aide', heading: 'Einladung: Vertrauensperson', intro: 'Eine Person schlägt Ihnen vor, einen Teil ihres Kontos einzusehen – nur lesend und für begrenzte Zeit. Um anzunehmen oder abzulehnen, melden Sie sich mit dieser E-Mail-Adresse an und öffnen Sie den Link unten. Wenn Sie diese Person nicht kennen, ignorieren Sie diese Nachricht.', cta: 'Einladung ansehen' },
    email_change_confirm: { subject: 'Bestätigen Sie Ihre neue Adresse — Accès Direct Aide', heading: 'Neue E-Mail-Adresse', intro: 'Sie möchten, dass diese Adresse die Adresse Ihres Kontos wird. Bestätigen Sie mit der Schaltfläche unten. Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese Nachricht: Es ändert sich nichts.', cta: 'Diese Adresse bestätigen' },
    email_change_notice: { subject: 'Adressänderung angefragt — Accès Direct Aide', heading: 'Adressänderung angefragt', intro: 'Soeben wurde eine Änderung der E-Mail-Adresse Ihres Kontos angefragt. Wenn Sie das nicht waren, melden Sie sich an und ändern Sie Ihr Passwort: Solange die neue Adresse nicht bestätigt ist, ändert sich nichts.', cta: 'Mein Konto öffnen' },
    restriction_lift: { subject: 'Ende der Einschränkung der Verarbeitung Ihrer Daten - Accès Direct Aide', heading: 'Ende der Einschränkung der Verarbeitung', intro: 'Das Team wird die von Ihnen beantragte Einschränkung der Verarbeitung Ihrer Daten aufheben. Der Grund steht unten (auf Französisch). Sie können jederzeit über Ihr Konto eine neue Einschränkung beantragen.', cta: 'Mein Konto öffnen' },
    account_recovery: { subject: 'Wiederherstellung Ihres Kontos bei Accès Direct Aide', heading: 'Wiederherstellung Ihres Kontos', intro: 'Unser Team hat Ihr Konto nach Prüfung Ihrer Identität mit dieser Adresse verknüpft. Bestätigen Sie die Adresse und wählen Sie Ihr Passwort über den Link unten. Wenn Sie diese Anfrage nicht gestellt haben, kontaktieren Sie uns.', cta: 'Meine Adresse bestätigen' },
    account_recovery_notice: { subject: 'Die Adresse Ihres Kontos wurde geändert - Accès Direct Aide', heading: 'Kontoadresse geändert', intro: 'Die E-Mail-Adresse Ihres Kontos wurde nach einer von unserem Team geprüften Wiederherstellungsanfrage ersetzt. Wenn Sie das nicht waren, kontaktieren Sie uns umgehend.', cta: 'Kontakt aufnehmen' },
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
    // A-15 remainder: the account e-mails (French subjects = the ones the handlers already send)
    parcours_reminder: { subject: 'Нагадування: незабаром настає строк кроку в «Мій шлях» - Accès Direct Aide', heading: 'Нагадування «Мій шлях»', intro: 'Незабаром настає строк одного з кроків вашого шляху. Увійдіть у «Мій простір» («Мій шлях»), щоб його переглянути.', cta: 'Відкрити «Мій шлях»' },
    delegation_invitation: { subject: 'Запрошення: довірена особа на Accès Direct Aide', heading: 'Запрошення: довірена особа', intro: 'Людина пропонує вам переглядати частину її облікового запису — лише для читання й упродовж обмеженого часу. Щоб прийняти або відхилити, увійдіть з цією адресою електронної пошти та відкрийте посилання нижче. Якщо ви не знаєте цієї людини, проігноруйте це повідомлення.', cta: 'Переглянути запрошення' },
    email_change_confirm: { subject: 'Підтвердьте нову адресу — Accès Direct Aide', heading: 'Нова адреса електронної пошти', intro: 'Ви попросили, щоб ця адреса стала адресою вашого облікового запису. Щоб підтвердити, скористайтеся кнопкою нижче. Якщо ви не робили цього запиту, проігноруйте це повідомлення: нічого не зміниться.', cta: 'Підтвердити цю адресу' },
    email_change_notice: { subject: 'Запит на зміну адреси — Accès Direct Aide', heading: 'Запитано зміну адреси', intro: 'Щойно надійшов запит на зміну адреси електронної пошти вашого облікового запису. Якщо це були не ви, увійдіть і змініть пароль: доки нову адресу не підтверджено, нічого не змінюється.', cta: 'Відкрити мій обліковий запис' },
    restriction_lift: { subject: 'Завершення обмеження обробки ваших даних - Accès Direct Aide', heading: 'Завершення обмеження обробки', intro: 'Команда збирається зняти обмеження обробки ваших даних, про яке ви просили. Причину наведено нижче (французькою). Ви можете будь-коли попросити нове обмеження у своєму обліковому записі.', cta: 'Відкрити мій обліковий запис' },
    account_recovery: { subject: 'Відновлення вашого облікового запису Accès Direct Aide', heading: 'Відновлення облікового запису', intro: 'Наша команда прив’язала ваш обліковий запис до цієї адреси після перевірки вашої особи. Підтвердьте адресу й оберіть пароль за посиланням нижче. Якщо ви не робили цього запиту, зв’яжіться з нами.', cta: 'Підтвердити мою адресу' },
    account_recovery_notice: { subject: 'Адресу вашого облікового запису змінено - Accès Direct Aide', heading: 'Адресу облікового запису змінено', intro: 'Адресу електронної пошти вашого облікового запису замінено після запиту на відновлення, перевіреного нашою командою. Якщо це були не ви, негайно зв’яжіться з нами.', cta: 'Зв’язатися з нами' },
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

/**
 * R44 (booking) — the sentence of a refused request's reason in the reader's language (the API's fixed codes, api/_services/rdv-requests.js REFUSAL_REASONS;
 * French = the source sentence). A body line only, never a subject (non-disclosure rule above). The codes are a proposal awaiting the owner (R43 D-5).
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const REFUSAL_REASON_TEXTS = Object.freeze({
  NOT_SUITABLE: Object.freeze({ fr: 'La structure indique que cette demande ne relève pas de ses services. Vous pouvez chercher une autre structure dans l’annuaire.', en: 'The organisation says this request is not within its services. You can look for another organisation in the directory.', tr: 'Kurum, bu talebin kendi hizmet alanına girmediğini belirtiyor. Rehberde başka bir kurum arayabilirsiniz.', ar: 'تشير الجهة إلى أن هذا الطلب لا يدخل ضمن خدماتها. يمكنك البحث عن جهة أخرى في الدليل.', de: 'Die Einrichtung teilt mit, dass diese Anfrage nicht zu ihren Leistungen gehört. Sie können im Verzeichnis eine andere Einrichtung suchen.', uk: 'Організація повідомляє, що цей запит не належить до її послуг. Ви можете знайти іншу організацію в довіднику.' }),
  NO_CAPACITY: Object.freeze({ fr: 'La structure ne peut pas recevoir cette demande à ce créneau. Vous pouvez demander un autre créneau.', en: 'The organisation cannot take this request at this time slot. You can ask for another time slot.', tr: 'Kurum bu talebi bu saatte karşılayamıyor. Başka bir saat talep edebilirsiniz.', ar: 'لا تستطيع الجهة استقبال هذا الطلب في هذا الموعد. يمكنك طلب موعد آخر.', de: 'Die Einrichtung kann diese Anfrage zu diesem Termin nicht annehmen. Sie können einen anderen Termin anfragen.', uk: 'Організація не може прийняти цей запит у цей час. Ви можете попросити інший час.' }),
  OTHER: Object.freeze({ fr: 'La structure ne peut pas donner suite à cette demande. Vous pouvez la contacter pour en savoir plus.', en: 'The organisation cannot follow up on this request. You can contact it to find out more.', tr: 'Kurum bu talebe yanıt veremiyor. Daha fazla bilgi için kurumla iletişime geçebilirsiniz.', ar: 'لا تستطيع الجهة متابعة هذا الطلب. يمكنك التواصل معها لمعرفة المزيد.', de: 'Die Einrichtung kann dieser Anfrage nicht nachkommen. Sie können sie kontaktieren, um mehr zu erfahren.', uk: 'Організація не може задовольнити цей запит. Ви можете звернутися до неї, щоб дізнатися більше.' }),
});

/** the reason sentence of a code (unknown → OTHER) in a supported language (unknown → French) @param {unknown} code @param {unknown} lang @returns {string} */
export function refusalReasonMail(code, lang) {
  const entry = REFUSAL_REASON_TEXTS[typeof code === 'string' && code in REFUSAL_REASON_TEXTS ? code : 'OTHER'];
  return entry[mailLanguage(lang)] || entry[SOURCE_LANGUAGE];
}
