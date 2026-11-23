#!/usr/bin/env python3
"""
G14-RG — builds « Ma situation » from ONE reviewed source of definitions (this file), so the data, the explicit label module and the six
interface languages never drift apart:
  data/reference/life-situations.v1.json        situations → needs / subdomains / rights / démarches / structure types / numbers (ids only)
  src/lib/situationLabels.js                     explicit t('situation:item.<id>', '<French>') calls (scripts/i18n-check.mjs checks them)
  src/i18n/locales/<lang>/situation.json         the item.* and family.* keys of the five translated languages
Every id is resolved and tested by tests/unit/g14-rg-situation.test.jsx: a link that does not lead to a sourced record fails the test (fail closed).
No right, amount, condition or deadline is written here — only ids of records that already carry their official source and date.

  python3 scripts/life-situations-build.py
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ['fr', 'en', 'de', 'tr', 'ar', 'uk']

# structure types (exact type_structure values of the directory: catalogue, « Où s'adresser » of the fiches, Mon Parcours kinds)
CAF = "Caf (Caisse d'allocations familiales)"; MDS = 'Maison des solidarités (Espace Solidarités)'; CCAS = "CCAS (centre communal d'action sociale)"
EFS = 'Espace France Services'; MAIRIE = 'Mairie'; FT = 'France Travail'; ML = 'Mission locale (jeunes de 16 à 25 ans)'; PJ = 'Point-justice (accès au droit)'
MJD = 'Maison de justice et du droit'; CIDFF = 'CIDFF (droits des femmes et des familles)'; BAV = "Bureau d'aide aux victimes"
CPAM = "CPAM (caisse primaire d'assurance maladie)"; MDPH = 'MDPH (maison des personnes handicapées)'; OFII = "OFII (Office français de l'immigration et de l'intégration)"
PREF = 'Préfecture'; SPREF = 'Sous-préfecture'; SIP = 'Service des impôts des particuliers'; CIO = "CIO (centre d'information et d'orientation)"; IJ = 'Information jeunesse'
CA = 'Centre d’accueil'; CHRS = 'Centre d’hébergement et de réinsertion sociale (CHRS)'; MR = 'Maison relais – pension de famille'; RS = 'Résidence sociale'
PMI = 'Protection maternelle et infantile (PMI)'; INFO = 'Point d’information pour les personnes âgées'; SAD = 'Service autonomie à domicile (aide)'
SSIAD = 'Service de soins infirmiers à domicile (SSIAD)'; EHPAD = 'Établissement d’hébergement pour personnes âgées dépendantes (EHPAD)'; RA = 'Résidence autonomie'
CMP = 'Centre médico-psychologique (CMP)'; CMPP = 'Centre médico-psycho-pédagogique (CMPP)'; BAPU = 'Bureau d’aide psychologique universitaire (BAPU)'
CSAPA = 'Centre de soins, d’accompagnement et de prévention en addictologie (CSAPA)'; CAARUD = 'Centre d’accueil et d’accompagnement à la réduction des risques pour usagers de drogues (CAARUD)'
CS = 'Centre de santé'; MS = 'Maison de santé'; CSS = 'Centre de santé sexuelle'; CEGIDD = 'Centre gratuit d’information, de dépistage et de diagnostic (CeGIDD)'
EVARS = 'Espace de vie affective, relationnelle et sexuelle (EVARS)'; IME = 'Institut médico-éducatif (IME)'; SESSAD = 'Service d’éducation spéciale et de soins à domicile (SESSAD)'
CAMSP = 'Centre d’action médico-sociale précoce (CAMSP)'; ITEP = 'Institut thérapeutique, éducatif et pédagogique (ITEP)'
FH = 'Foyer d’hébergement pour adultes handicapés'; FV = 'Foyer de vie pour adultes handicapés'; FAM = 'Foyer d’accueil médicalisé pour adultes handicapés (FAM)'
MAS = 'Maison d’accueil spécialisée (MAS)'; SAVS = 'Service d’accompagnement à la vie sociale (SAVS)'; SAMSAH = 'Service d’accompagnement médico-social pour adultes handicapés (SAMSAH)'
ESAT = 'Établissement et service d’aide par le travail (ESAT)'; MJPM = 'Service mandataire judiciaire à la protection des majeurs'

FAMILIES = [
    ('logement', {'fr': 'Logement', 'en': 'Housing', 'de': 'Wohnen', 'tr': 'Konut', 'ar': 'السكن', 'uk': 'Житло'}),
    ('argent-emploi', {'fr': 'Travail et revenus', 'en': 'Work and income', 'de': 'Arbeit und Einkommen', 'tr': 'İş ve gelir', 'ar': 'العمل والدخل', 'uk': 'Робота і доходи'}),
    ('budget', {'fr': 'Budget, dettes, banque, impôts', 'en': 'Budget, debts, bank, taxes', 'de': 'Budget, Schulden, Bank, Steuern', 'tr': 'Bütçe, borçlar, banka, vergiler', 'ar': 'الميزانية والديون والبنك والضرائب', 'uk': 'Бюджет, борги, банк, податки'}),
    ('famille', {'fr': 'Famille', 'en': 'Family', 'de': 'Familie', 'tr': 'Aile', 'ar': 'الأسرة', 'uk': 'Сім’я'}),
    ('jeunes', {'fr': 'Enfants et jeunes', 'en': 'Children and young people', 'de': 'Kinder und Jugendliche', 'tr': 'Çocuklar ve gençler', 'ar': 'الأطفال والشباب', 'uk': 'Діти та молодь'}),
    ('sante', {'fr': 'Santé et handicap', 'en': 'Health and disability', 'de': 'Gesundheit und Behinderung', 'tr': 'Sağlık ve engellilik', 'ar': 'الصحة والإعاقة', 'uk': 'Здоров’я та інвалідність'}),
    ('seniors', {'fr': 'Personnes âgées', 'en': 'Older people', 'de': 'Ältere Menschen', 'tr': 'Yaşlılar', 'ar': 'كبار السن', 'uk': 'Літні люди'}),
    ('violences', {'fr': 'Violences et sécurité', 'en': 'Violence and safety', 'de': 'Gewalt und Sicherheit', 'tr': 'Şiddet ve güvenlik', 'ar': 'العنف والأمان', 'uk': 'Насильство і безпека'}),
    ('etrangers', {'fr': 'Arriver en France, étrangers', 'en': 'Arriving in France, foreign nationals', 'de': 'Ankunft in Frankreich, Ausländer', 'tr': 'Fransa’ya geliş, yabancılar', 'ar': 'الوصول إلى فرنسا، الأجانب', 'uk': 'Приїзд до Франції, іноземці'}),
    ('justice', {'fr': 'Justice et droits', 'en': 'Justice and rights', 'de': 'Justiz und Rechte', 'tr': 'Adalet ve haklar', 'ar': 'العدالة والحقوق', 'uk': 'Правосуддя і права'}),
    ('quotidien', {'fr': 'Vie quotidienne : papiers, internet, transports', 'en': 'Daily life: papers, internet, transport', 'de': 'Alltag: Papiere, Internet, Verkehr', 'tr': 'Günlük yaşam: evrak, internet, ulaşım', 'ar': 'الحياة اليومية: الأوراق والإنترنت والنقل', 'uk': 'Повсякдення: документи, інтернет, транспорт'}),
]

S = []
def sit(id, family, sub, L, K, needs=(), rights=(), steps=(), st=(), em=()):
    S.append({'id': id, 'family': family, 'danger': bool(em), 'emergency': list(em), 'subdomains': list(sub), 'needs': list(needs), 'rights': list(rights),
              'steps': [({'stepType': x} if re.match(r'^[A-Z][A-Z0-9_]+$', x) and not re.match(r'^[FN]\d+$', x) else {'fiche': x}) for x in steps],
              'structures': list(st), 'labels': L, 'keywords': K})

def L(fr, en, de, tr, ar, uk): return {'fr': fr, 'en': en, 'de': de, 'tr': tr, 'ar': ar, 'uk': uk}

# ── Logement ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('loyer-impaye', 'logement', ['logement/expulsion-impayes', 'logement/aides-logement'],
    L('Je n’arrive plus à payer mon loyer', 'I can no longer pay my rent', 'Ich kann meine Miete nicht mehr bezahlen', 'Kiramı artık ödeyemiyorum', 'لم أعد أستطيع دفع الإيجار', 'Я більше не можу платити за оренду'),
    {'fr': ['loyer', 'loyers', 'payer mon loyer', 'impaye', 'retard de loyer', 'dette de loyer', 'proprietaire', 'bailleur', 'apl', 'aide au logement', 'fsl'],
     'en': ['rent', 'pay my rent', 'rent arrears', 'unpaid rent', 'landlord', 'housing benefit', 'apl'],
     'de': ['miete', 'mietschulden', 'miete nicht', 'miete zahlen', 'vermieter', 'wohngeld', 'apl'],
     'tr': ['kira', 'kirami', 'kira borcu', 'kirayi odeyemiyorum', 'ev sahibi', 'konut yardimi', 'apl'],
     'ar': ['ايجار', 'الايجار', 'اجرة السكن', 'المالك', 'دفع الايجار', 'مساعدة السكن'],
     'uk': ['оренд', 'квартплат', 'борг за оренду', 'орендодав', 'житлова допомога', 'apl']},
    needs=['expulsion-impayes', 'aides-logement'], rights=['F1334', 'F12006', 'F1280', 'F13132', 'F32037'], steps=['FSL_DEMANDE', 'AIDE_LOGEMENT_DEMANDE', 'F31272', 'F34736'], st=[CAF, MDS, CCAS, EFS])
sit('expulsion', 'logement', ['logement/expulsion-impayes', 'justice/acces-au-droit'],
    L('Je risque de perdre mon logement (expulsion)', 'I may lose my home (eviction)', 'Ich könnte meine Wohnung verlieren (Räumung)', 'Evimi kaybedebilirim (tahliye)', 'قد أفقد مسكني (طرد)', 'Я можу втратити житло (виселення)'),
    {'fr': ['expulsion', 'expulse', 'expulser', 'commandement de quitter', 'quitter les lieux', 'huissier', 'commissaire de justice', 'treve hivernale', 'perdre mon logement', 'mis dehors'],
     'en': ['eviction', 'evicted', 'evict', 'bailiff', 'lose my home', 'lose my flat', 'thrown out', 'winter truce'],
     'de': ['räumung', 'zwangsräumung', 'kündigung der wohnung', 'gerichtsvollzieher', 'wohnung verlieren', 'rausgeworfen'],
     'tr': ['tahliye', 'evden cikarma', 'evden atilma', 'icra', 'evimi kaybediyorum'],
     'ar': ['طرد', 'الطرد', 'اخلاء', 'الاخلاء', 'المحضر', 'افقد سكني'],
     'uk': ['висел', 'виселення', 'виселяют', 'судовий виконавець', 'втратити житло']},
    needs=['expulsion-impayes', 'hebergement-urgence'], rights=['F1334', 'F32037'], steps=['F31272', 'F34736', 'FSL_DEMANDE', 'LOGEMENT_SOCIAL_DEMANDE'], st=[MDS, CCAS, PJ, MJD])
sit('sans-logement', 'logement', ['logement/hebergement-urgence', 'precarite/urgence-sociale', 'precarite/accueil-de-jour'],
    L('Je n’ai pas d’endroit où dormir', 'I have nowhere to sleep', 'Ich habe keinen Schlafplatz', 'Uyuyacak yerim yok', 'ليس لدي مكان أنام فيه', 'Мені ніде спати'),
    {'fr': ['dormir dehors', 'dors dehors', 'a la rue', 'sans abri', 'sans domicile', 'sdf', 'pas de logement', 'nulle part ou dormir', 'hebergement d urgence', '115', 'dormir ce soir'],
     'en': ['homeless', 'sleep outside', 'sleeping rough', 'on the street', 'nowhere to sleep', 'no home', 'shelter', '115'],
     'de': ['obdachlos', 'draußen schlafen', 'auf der straße', 'keine wohnung', 'notunterkunft', 'schlafplatz', '115'],
     'tr': ['evsiz', 'sokakta', 'disarida yatiyorum', 'kalacak yer', 'barinak', 'acil konaklama', '115'],
     'ar': ['بلا مأوى', 'مشرد', 'انام في الشارع', 'في الشارع', 'لا مكان للنوم', 'مأوى', '115'],
     'uk': ['бездомн', 'ночувати на вулиці', 'на вулиці', 'немає житла', 'притулок', '115']},
    needs=['hebergement-urgence'], steps=['F2003', 'F17317'], st=[CCAS, CA, MAIRIE], em=['115', '112'])
sit('factures-impayees', 'logement', ['precarite/energie'],
    L('Je n’arrive plus à payer l’électricité, le gaz ou l’eau', 'I can no longer pay for electricity, gas or water', 'Ich kann Strom, Gas oder Wasser nicht mehr bezahlen', 'Elektrik, gaz veya su faturamı artık ödeyemiyorum', 'لم أعد أستطيع دفع الكهرباء أو الغاز أو الماء', 'Я більше не можу платити за електрику, газ чи воду'),
    {'fr': ['facture', 'factures', 'electricite', 'gaz', 'eau', 'energie', 'coupure', 'cheque energie', 'chauffage', 'edf'],
     'en': ['bill', 'bills', 'electricity', 'gas bill', 'water bill', 'energy', 'cut off', 'heating'],
     'de': ['rechnung', 'stromrechnung', 'strom', 'gasrechnung', 'wasserrechnung', 'energie', 'sperre', 'heizung'],
     'tr': ['fatura', 'elektrik', 'dogalgaz', 'su faturasi', 'enerji', 'kesinti', 'isinma'],
     'ar': ['فاتورة', 'فواتير', 'الكهرباء', 'الغاز', 'الماء', 'الطاقة', 'قطع', 'التدفئة'],
     'uk': ['рахун', 'електроенерг', 'світло', 'газ', 'вода', 'енергі', 'відключ', 'опален']},
    needs=['energie'], rights=['F38589', 'F33667', 'F1334'], steps=['F20055', 'CHEQUE_ENERGIE_UTILISER', 'FSL_DEMANDE'], st=[CCAS, MDS, EFS])
sit('logement-insalubre', 'logement', ['logement/habitat-indigne'],
    L('Mon logement est en mauvais état, humide ou dangereux', 'My home is in bad condition, damp or unsafe', 'Meine Wohnung ist in schlechtem Zustand, feucht oder gefährlich', 'Evim kötü durumda, nemli veya tehlikeli', 'مسكني في حالة سيئة أو رطب أو خطير', 'Моє житло в поганому стані, вологе або небезпечне'),
    {'fr': ['insalubre', 'insalubrite', 'humidite', 'moisissure', 'moisi', 'logement indigne', 'nuisibles', 'punaises de lit', 'cafards', 'rats', 'logement dangereux', 'travaux pas faits'],
     'en': ['damp', 'mould', 'mold', 'unsafe housing', 'unfit housing', 'pests', 'bedbugs', 'cockroaches', 'rats', 'repairs not done'],
     'de': ['schimmel', 'feucht', 'feuchtigkeit', 'ungeziefer', 'bettwanzen', 'kakerlaken', 'ratten', 'baufällig', 'mängel'],
     'tr': ['rutubet', 'kuf', 'nem', 'hasere', 'tahtakurusu', 'hamamboceği', 'fare', 'saglıksız ev', 'oturulamaz'],
     'ar': ['رطوبة', 'عفن', 'حشرات', 'بق الفراش', 'صراصير', 'فئران', 'مسكن غير صحي', 'مسكن خطير'],
     'uk': ['пліснява', 'вологість', 'сирість', 'шкідники', 'клопи', 'таргани', 'щури', 'аварійне житло']},
    st=[MAIRIE, EFS, PJ])
sit('recherche-hlm', 'logement', ['logement/logement-social', 'logement/dalo'],
    L('Je cherche un logement social (HLM)', 'I am looking for social housing (HLM)', 'Ich suche eine Sozialwohnung (HLM)', 'Sosyal konut (HLM) arıyorum', 'أبحث عن سكن اجتماعي (HLM)', 'Я шукаю соціальне житло (HLM)'),
    {'fr': ['hlm', 'logement social', 'demande de logement', 'numero unique', 'dalo', 'bailleur social', 'cherche un logement', 'chercher un appartement'],
     'en': ['social housing', 'council housing', 'hlm', 'housing application', 'looking for a flat', 'looking for housing', 'dalo'],
     'de': ['sozialwohnung', 'hlm', 'wohnungsantrag', 'wohnung suchen', 'suche eine wohnung', 'dalo'],
     'tr': ['sosyal konut', 'hlm', 'ev ariyorum', 'konut basvurusu', 'daire ariyorum', 'dalo'],
     'ar': ['سكن اجتماعي', 'hlm', 'طلب سكن', 'ابحث عن شقة', 'ابحث عن سكن'],
     'uk': ['соціальне житло', 'hlm', 'заява на житло', 'шукаю квартиру', 'шукаю житло']},
    steps=['LOGEMENT_SOCIAL_DEMANDE', 'LOGEMENT_SOCIAL_RENOUVELLEMENT'], st=[MAIRIE, CCAS, MDS, EFS])
sit('heberge-chez-tiers', 'logement', ['logement/logement-accompagne', 'logement/chrs-insertion'],
    L('Je suis hébergé chez quelqu’un ou dans un foyer', 'I am staying with someone or in a hostel', 'Ich wohne bei jemandem oder in einem Wohnheim', 'Birinin yanında veya bir yurtta kalıyorum', 'أقيم عند شخص ما أو في مأوى', 'Я живу в когось або в гуртожитку'),
    {'fr': ['heberge', 'hebergee', 'chez un ami', 'chez une amie', 'chez des amis', 'chez ma famille', 'chez mes parents', 'canape', 'residence sociale', 'pension de famille', 'chrs', 'domiciliation', 'adresse postale'],
     'en': ['staying with a friend', 'staying with family', 'sofa surfing', 'couch surfing', 'hostel', 'no fixed address', 'postal address'],
     'de': ['bei freunden', 'bei einem freund', 'bei meiner familie', 'auf dem sofa', 'wohnheim', 'keine feste adresse', 'postadresse'],
     'tr': ['arkadasimda kaliyorum', 'akrabamda kaliyorum', 'kanepede', 'yurtta', 'sabit adresim yok', 'posta adresi'],
     'ar': ['اقيم عند صديق', 'اقيم عند عائلتي', 'على الاريكة', 'مأوى جماعي', 'بدون عنوان ثابت', 'عنوان بريدي'],
     'uk': ['живу у друзів', 'живу у родичів', 'на дивані', 'гуртожиток', 'без постійної адреси', 'поштова адреса']},
    steps=['F17317', 'LOGEMENT_SOCIAL_DEMANDE'], st=[RS, MR, CHRS, MDS])
sit('logement-jeune', 'logement', ['logement/logement-jeunes'],
    L('Je suis jeune et je cherche un logement ou une colocation', 'I am young and looking for housing or a flatshare', 'Ich bin jung und suche eine Wohnung oder WG', 'Gencim, ev veya ev arkadaşlığı arıyorum', 'أنا شاب وأبحث عن سكن أو سكن مشترك', 'Я молодий(-а) і шукаю житло або спільну квартиру'),
    {'fr': ['colocation', 'coloc', 'studio', 'premier logement', 'foyer de jeunes travailleurs', 'fjt', 'visale', 'garant', 'caution', 'logement etudiant'],
     'en': ['flatshare', 'flat share', 'roommate', 'first flat', 'guarantor', 'deposit', 'youth hostel', 'student housing', 'visale'],
     'de': ['wg', 'wohngemeinschaft', 'erste wohnung', 'bürge', 'kaution', 'jugendwohnheim', 'studentenwohnung', 'visale'],
     'tr': ['ev arkadasi', 'ilk evim', 'kefil', 'depozito', 'genc isci yurdu', 'ogrenci evi', 'visale'],
     'ar': ['سكن مشترك', 'اول سكن', 'كفيل', 'تأمين الايجار', 'سكن الطلاب', 'visale'],
     'uk': ['спільна квартира', 'співмешкан', 'перше житло', 'поручител', 'застава', 'студентське житло', 'visale']},
    needs=['aides-logement'], rights=['F12006', 'F33453'], steps=['F2018', 'VISALE_DEMANDE', 'AIDE_LOGEMENT_DEMANDE'], st=[IJ, ML])
sit('adapter-logement', 'logement', ['logement/adaptation-logement'],
    L('Mon logement n’est plus adapté (âge, handicap)', 'My home is no longer suitable (age, disability)', 'Meine Wohnung passt nicht mehr (Alter, Behinderung)', 'Evim artık uygun değil (yaş, engellilik)', 'مسكني لم يعد مناسبًا (السن، الإعاقة)', 'Моє житло більше не підходить (вік, інвалідність)'),
    {'fr': ['adapter mon logement', 'adaptation du logement', 'douche', 'baignoire', 'monte escalier', 'rampe', 'maprimeadapt', 'travaux d adaptation', 'escaliers'],
     'en': ['adapt my home', 'home adaptation', 'walk-in shower', 'stairlift', 'ramp', 'grab rails', 'stairs'],
     'de': ['wohnung anpassen', 'barrierefrei umbauen', 'dusche', 'treppenlift', 'rampe', 'treppen'],
     'tr': ['evimi uyarlamak', 'ev uyarlama', 'dus', 'merdiven asansoru', 'rampa', 'merdivenler'],
     'ar': ['تكييف المسكن', 'دش', 'مصعد الدرج', 'منحدر', 'الدرج'],
     'uk': ['пристосувати житло', 'душ', 'підйомник', 'пандус', 'сходи']},
    needs=['adaptation-logement'], rights=['F37501', 'F14202'], st=[MAIRIE, MDPH])

# ── Travail et revenus ────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('perte-emploi', 'argent-emploi', ['emploi/recherche-emploi', 'precarite/minima-sociaux'],
    L('J’ai perdu mon emploi', 'I lost my job', 'Ich habe meine Arbeit verloren', 'İşimi kaybettim', 'فقدت عملي', 'Я втратив(-ла) роботу'),
    {'fr': ['perdu mon emploi', 'perdu mon travail', 'perte d emploi', 'chomage', 'licencie', 'licenciement', 'fin de contrat', 'france travail', 'pole emploi', 'sans emploi', 'rupture conventionnelle'],
     'en': ['lost my job', 'job loss', 'unemployed', 'unemployment', 'laid off', 'fired', 'dismissed', 'end of contract', 'redundancy'],
     'de': ['arbeit verloren', 'job verloren', 'arbeitslos', 'arbeitslosigkeit', 'gekündigt', 'kündigung', 'vertragsende', 'entlassen'],
     'tr': ['isimi kaybettim', 'issiz', 'issizlik', 'isten cikarildim', 'kovuldum', 'sozlesme bitti', 'is kaybi'],
     'ar': ['فقدت عملي', 'فقدت وظيفتي', 'عاطل', 'البطالة', 'بطالة', 'طردت من العمل', 'نهاية العقد'],
     'uk': ['втратив роботу', 'втратила роботу', 'безробіт', 'звільн', 'кінець контракту', 'без роботи']},
    needs=['recherche-emploi', 'minima-sociaux', 'aides-logement'], rights=['F38881', 'F19778', 'F12006'], steps=['FRANCE_TRAVAIL_INSCRIPTION', 'ATTESTATION_EMPLOYEUR', 'FRANCE_TRAVAIL_ACTUALISATION', 'F827'], st=[FT, EFS, ML, CAF])
sit('fin-de-droits', 'argent-emploi', ['precarite/minima-sociaux', 'emploi/recherche-emploi'],
    L('Mon allocation chômage s’arrête', 'My unemployment benefit is ending', 'Mein Arbeitslosengeld läuft aus', 'İşsizlik ödeneğim bitiyor', 'إعانة البطالة الخاصة بي ستنتهي', 'Моя допомога по безробіттю закінчується'),
    {'fr': ['fin de droits', 'fin d indemnisation', 'plus d allocation chomage', 'allocation chomage s arrete', 'fin de l are', 'droits epuises'],
     'en': ['benefit ending', 'end of unemployment benefit', 'benefits run out', 'no more unemployment benefit'],
     'de': ['arbeitslosengeld endet', 'arbeitslosengeld läuft aus', 'kein arbeitslosengeld mehr', 'anspruch erschöpft'],
     'tr': ['issizlik odenegi bitiyor', 'odenek bitti', 'issizlik maasi bitti'],
     'ar': ['انتهاء اعانة البطالة', 'توقف اعانة البطالة', 'لم تعد لدي اعانة'],
     'uk': ['закінчується допомога', 'допомога по безробіттю закінчилася', 'більше немає допомоги']},
    needs=['minima-sociaux', 'recherche-emploi'], rights=['F19778'], steps=['RSA_DEMANDE', 'FRANCE_TRAVAIL_ACTUALISATION'], st=[CAF, MDS, FT, EFS])
sit('faibles-revenus', 'argent-emploi', ['precarite/minima-sociaux', 'precarite/acces-aux-droits'],
    L('Je travaille mais je gagne peu (temps partiel, petit salaire)', 'I work but earn little (part-time, low pay)', 'Ich arbeite, verdiene aber wenig (Teilzeit, geringer Lohn)', 'Çalışıyorum ama az kazanıyorum (yarı zamanlı, düşük maaş)', 'أعمل لكن دخلي قليل (دوام جزئي، راتب ضعيف)', 'Я працюю, але заробляю мало (неповний день, мала зарплата)'),
    {'fr': ['temps partiel', 'petit salaire', 'salaire faible', 'smic', 'gagne peu', 'prime d activite', 'travailleur pauvre', 'mi temps'],
     'en': ['part-time', 'part time', 'low pay', 'low wage', 'minimum wage', 'earn little', 'working poor'],
     'de': ['teilzeit', 'geringer lohn', 'niedriglohn', 'mindestlohn', 'verdiene wenig', 'minijob'],
     'tr': ['yari zamanli', 'dusuk maas', 'asgari ucret', 'az kazaniyorum', 'part time'],
     'ar': ['دوام جزئي', 'راتب ضعيف', 'الحد الادنى للاجور', 'دخلي قليل', 'اجر منخفض'],
     'uk': ['неповний робочий день', 'мала зарплата', 'низька зарплата', 'мінімальна зарплата', 'заробляю мало']},
    needs=['minima-sociaux', 'aides-logement'], rights=['F2882', 'F286', 'F12006'], steps=['PRIME_ACTIVITE_DEMANDE', 'DECLARATION_TRIMESTRIELLE_RESSOURCES'], st=[CAF, EFS])
sit('sans-ressources', 'argent-emploi', ['precarite/minima-sociaux', 'precarite/acces-aux-droits'],
    L('Je n’ai pas ou presque pas d’argent pour vivre', 'I have no or almost no money to live on', 'Ich habe kein oder fast kein Geld zum Leben', 'Geçinmek için hiç ya da neredeyse hiç param yok', 'ليس لدي مال أو لدي القليل جدًا للعيش', 'У мене немає або майже немає грошей на життя'),
    {'fr': ['pas d argent', 'plus d argent', 'pas de revenu', 'sans revenu', 'aucun revenu', 'rsa', 'fin de mois', 'ressources', 'pauvre'],
     'en': ['no money', 'no income', 'low income', 'can t afford', 'cannot afford', 'rsa', 'poor'],
     'de': ['kein geld', 'kein einkommen', 'wenig geld', 'geringes einkommen', 'rsa', 'arm'],
     'tr': ['param yok', 'gelirim yok', 'dusuk gelir', 'geçinemiyorum', 'rsa', 'yoksul'],
     'ar': ['لا مال', 'ليس لدي مال', 'بدون دخل', 'لا دخل', 'دخل منخفض', 'فقير'],
     'uk': ['немає грошей', 'без доходу', 'немає доходу', 'низький дохід', 'rsa', 'бідний', 'бідна']},
    needs=['minima-sociaux', 'acces-aux-droits'], rights=['F19778', 'N19775'], steps=['RSA_DEMANDE', 'DECLARATION_TRIMESTRIELLE_RESSOURCES'], st=[CAF, MDS, CCAS, EFS])
sit('retour-emploi', 'argent-emploi', ['emploi/freins-emploi', 'emploi/iae'],
    L('Je veux retravailler mais des difficultés me bloquent', 'I want to work again but problems hold me back', 'Ich will wieder arbeiten, aber Schwierigkeiten halten mich auf', 'Yeniden çalışmak istiyorum ama zorluklar engel oluyor', 'أريد العودة إلى العمل لكن صعوبات تعيقني', 'Я хочу знову працювати, але труднощі заважають'),
    {'fr': ['retrouver un travail', 'reprendre un travail', 'retour a l emploi', 'insertion', 'chantier d insertion', 'iae', 'freins', 'longtemps sans travail', 'chomeur de longue duree'],
     'en': ['get back to work', 'return to work', 'back into work', 'long-term unemployed', 'job integration', 'barriers to work'],
     'de': ['wieder arbeiten', 'wiedereinstieg', 'langzeitarbeitslos', 'eingliederung', 'arbeitsintegration'],
     'tr': ['yeniden calismak', 'ise donmek', 'uzun suredir issiz', 'ise entegrasyon'],
     'ar': ['العودة الى العمل', 'عاطل منذ مدة طويلة', 'الادماج المهني'],
     'uk': ['повернутися до роботи', 'знову працювати', 'довго без роботи', 'працевлаштування']},
    needs=['recherche-emploi'], steps=['FRANCE_TRAVAIL_RENDEZ_VOUS', 'FRANCE_TRAVAIL_INSCRIPTION'], st=[FT, ML, MDS])
sit('formation-reconversion', 'argent-emploi', ['emploi/formation'],
    L('Je veux me former ou changer de métier', 'I want to train or change careers', 'Ich will mich weiterbilden oder den Beruf wechseln', 'Eğitim almak veya meslek değiştirmek istiyorum', 'أريد التدريب أو تغيير مهنتي', 'Я хочу навчатися або змінити професію'),
    {'fr': ['formation', 'me former', 'reconversion', 'changer de metier', 'apprentissage', 'cpf', 'diplome', 'qualification'],
     'en': ['training', 'retrain', 'career change', 'change careers', 'apprenticeship', 'qualification', 'course'],
     'de': ['weiterbildung', 'umschulung', 'ausbildung', 'beruf wechseln', 'qualifikation', 'lehre'],
     'tr': ['egitim', 'meslek degistirmek', 'kurs', 'cirak', 'yeniden egitim', 'sertifika'],
     'ar': ['تدريب', 'تكوين', 'تغيير المهنة', 'تمهين', 'شهادة'],
     'uk': ['навчання', 'перекваліфікац', 'змінити професію', 'курси', 'кваліфікац']},
    steps=['FRANCE_TRAVAIL_RENDEZ_VOUS'], st=[FT, ML, EFS])

# ── Budget ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('dettes', 'budget', ['budget/surendettement'],
    L('J’ai trop de dettes', 'I have too many debts', 'Ich habe zu viele Schulden', 'Çok fazla borcum var', 'لدي ديون كثيرة', 'У мене забагато боргів'),
    {'fr': ['dette', 'dettes', 'surendettement', 'endette', 'credit', 'credits', 'rembourser', 'banque de france'],
     'en': ['debt', 'debts', 'over-indebted', 'overindebted', 'loan', 'loans', 'repay', 'credit'],
     'de': ['schulden', 'verschuldet', 'überschuldung', 'kredit', 'kredite', 'zurückzahlen'],
     'tr': ['borc', 'borclar', 'borcum', 'kredi', 'geri odeme', 'asiri borc'],
     'ar': ['ديون', 'دين علي', 'مديون', 'قرض', 'قروض', 'سداد'],
     'uk': ['борг', 'борги', 'боргів', 'заборгован', 'кредит', 'позик', 'повернути гроші']},
    needs=['surendettement'], rights=['F38589'], steps=['SURENDETTEMENT_DOSSIER'], st=[EFS, MDS, CCAS])
sit('budget-difficile', 'budget', ['budget/conseil-budget'],
    L('J’ai du mal à gérer mon budget', 'I struggle to manage my budget', 'Ich komme mit meinem Geld nicht zurecht', 'Bütçemi yönetmekte zorlanıyorum', 'أجد صعوبة في إدارة ميزانيتي', 'Мені важко керувати бюджетом'),
    {'fr': ['budget', 'gerer mon argent', 'fin de mois difficile', 'boucler le mois', 'point conseil budget', 'microcredit', 'decouvert'],
     'en': ['budget', 'manage my money', 'end of the month', 'make ends meet', 'overdraft', 'microcredit'],
     'de': ['budget', 'haushaltsgeld', 'mit dem geld auskommen', 'monatsende', 'dispo', 'überziehung', 'mikrokredit'],
     'tr': ['butce', 'paramı yonetmek', 'ay sonu', 'ay sonunu getiremiyorum', 'eksi hesap', 'mikrokredi'],
     'ar': ['الميزانية', 'ادارة المال', 'نهاية الشهر', 'سحب على المكشوف', 'قرض صغير'],
     'uk': ['бюджет', 'керувати грошима', 'кінець місяця', 'овердрафт', 'мікрокредит']},
    rights=['F38589', 'F21375'], steps=['MICROCREDIT_DEMANDE'], st=[CCAS, MDS, EFS])
sit('compte-bancaire', 'budget', ['budget/inclusion-bancaire'],
    L('La banque refuse de m’ouvrir un compte ou bloque mon compte', 'The bank refuses to open an account or blocks my account', 'Die Bank verweigert mir ein Konto oder sperrt mein Konto', 'Banka hesap açmayı reddediyor veya hesabımı bloke ediyor', 'البنك يرفض فتح حساب لي أو يجمد حسابي', 'Банк відмовляє відкрити рахунок або блокує мій рахунок'),
    {'fr': ['compte bancaire', 'ouvrir un compte', 'banque refuse', 'compte bloque', 'droit au compte', 'interdit bancaire', 'fichage banque de france', 'carte bancaire'],
     'en': ['bank account', 'open an account', 'bank refused', 'account blocked', 'bank card'],
     'de': ['bankkonto', 'konto eröffnen', 'bank verweigert', 'konto gesperrt', 'bankkarte'],
     'tr': ['banka hesabi', 'hesap acmak', 'banka reddetti', 'hesabim bloke', 'banka karti'],
     'ar': ['حساب بنكي', 'فتح حساب', 'البنك رفض', 'حساب مجمد', 'بطاقة بنكية'],
     'uk': ['банківський рахунок', 'відкрити рахунок', 'банк відмовив', 'рахунок заблоковано', 'банківська картка']},
    st=[EFS, CCAS, MDS])
sit('impots', 'budget', ['budget/impots'],
    L('J’ai une question ou un problème avec mes impôts', 'I have a question or problem with my taxes', 'Ich habe eine Frage oder ein Problem mit meinen Steuern', 'Vergilerimle ilgili bir sorum veya sorunum var', 'لدي سؤال أو مشكلة بشأن ضرائبي', 'У мене питання чи проблема з податками'),
    {'fr': ['impot', 'impots', 'declaration de revenus', 'taxe', 'avis d imposition', 'tresor public', 'remise gracieuse'],
     'en': ['tax', 'taxes', 'tax return', 'income tax', 'tax notice'],
     'de': ['steuer', 'steuern', 'steuererklärung', 'einkommensteuer', 'steuerbescheid'],
     'tr': ['vergi', 'vergiler', 'vergi beyannamesi', 'gelir vergisi'],
     'ar': ['ضريبة', 'الضرائب', 'التصريح بالدخل', 'اشعار ضريبي'],
     'uk': ['податок', 'податки', 'податкова декларація', 'податкове повідомлення']},
    st=[SIP, EFS])
sit('aide-alimentaire', 'budget', ['precarite/aide-alimentaire', 'precarite/urgence-sociale'],
    L('Je n’ai pas assez à manger', 'I do not have enough to eat', 'Ich habe nicht genug zu essen', 'Yeterince yiyeceğim yok', 'ليس لدي ما يكفي من الطعام', 'Мені не вистачає їжі'),
    {'fr': ['manger', 'nourriture', 'faim', 'colis alimentaire', 'banque alimentaire', 'epicerie sociale', 'restos du coeur', 'repas', 'vetements', 'hygiene'],
     'en': ['food', 'hungry', 'hunger', 'food bank', 'food parcel', 'meals', 'clothes'],
     'de': ['essen', 'hunger', 'lebensmittel', 'tafel', 'lebensmittelpaket', 'kleidung'],
     'tr': ['yemek', 'yiyecek', 'aclik', 'gida yardimi', 'gida kolisi', 'giysi'],
     'ar': ['طعام', 'الطعام', 'جوع', 'جائع', 'مساعدة غذائية', 'سلة غذائية', 'ملابس'],
     'uk': ['їжа', 'їжі', 'голод', 'продуктовий набір', 'продукти', 'одяг']},
    st=[CCAS, MDS, CA])

# ── Famille ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('naissance', 'famille', ['famille/grossesse-naissance', 'enfance-jeunesse/pmi-petite-enfance'],
    L('J’attends un enfant ou mon bébé vient de naître', 'I am expecting a baby or my baby was just born', 'Ich erwarte ein Kind oder mein Baby ist gerade geboren', 'Bebek bekliyorum veya bebeğim yeni doğdu', 'أنتظر طفلًا أو وُلد طفلي للتو', 'Я чекаю дитину або моя дитина щойно народилася'),
    {'fr': ['enceinte', 'grossesse', 'bebe', 'naissance', 'accouchement', 'nouveau ne', 'pmi', 'declarer la naissance'],
     'en': ['pregnant', 'pregnancy', 'baby', 'birth', 'newborn', 'giving birth'],
     'de': ['schwanger', 'schwangerschaft', 'baby', 'geburt', 'neugeboren', 'entbindung'],
     'tr': ['hamile', 'hamilelik', 'bebek', 'dogum', 'yeni dogan'],
     'ar': ['حامل', 'الحمل', 'طفل رضيع', 'رضيع', 'ولادة', 'مولود'],
     'uk': ['вагітн', 'немовля', 'народження', 'пологи', 'новонароджен']},
    needs=['prestations-familiales', 'garde-enfants'], rights=['F13213'], steps=['ACTE_NAISSANCE_DEMANDE'], st=[PMI, CAF, MAIRIE])
sit('separation', 'famille', ['famille/separation'],
    L('Je me sépare ou je divorce', 'I am separating or divorcing', 'Ich trenne mich oder lasse mich scheiden', 'Ayrılıyorum veya boşanıyorum', 'أنا أنفصل أو أتطلق', 'Я розлучаюся'),
    {'fr': ['separation', 'separe', 'separee', 'divorce', 'divorcer', 'rupture', 'pension alimentaire', 'garde des enfants', 'mediation familiale'],
     'en': ['separation', 'separated', 'divorce', 'break-up', 'child support', 'custody', 'family mediation'],
     'de': ['trennung', 'getrennt', 'scheidung', 'unterhalt', 'sorgerecht', 'familienmediation'],
     'tr': ['ayrildim', 'ayrilik', 'bosanma', 'bosaniyorum', 'nafaka', 'velayet'],
     'ar': ['انفصال', 'منفصل', 'طلاق', 'نفقة', 'الحضانة', 'وساطة عائلية'],
     'uk': ['розлуч', 'розійшлися', 'аліменти', 'опіка над дитиною', 'сімейна медіація']},
    needs=['prestations-familiales'], rights=['F38245'], steps=['F827'], st=[PJ, MJD, CAF, CIDFF])
sit('parent-seul', 'famille', ['famille/famille-monoparentale', 'famille/garde-enfants'],
    L('J’élève seul mon enfant', 'I am raising my child alone', 'Ich erziehe mein Kind allein', 'Çocuğumu yalnız büyütüyorum', 'أربي طفلي وحدي', 'Я сам(-а) виховую дитину'),
    {'fr': ['seul avec mon enfant', 'seule avec mon enfant', 'seule avec mes enfants', 'seul avec mes enfants', 'parent isole', 'parent solo', 'mere seule', 'pere seul', 'monoparentale'],
     'en': ['single parent', 'single mother', 'single father', 'alone with my child', 'lone parent'],
     'de': ['alleinerziehend', 'allein mit meinem kind', 'alleinerziehende mutter', 'alleinerziehender vater'],
     'tr': ['tek ebeveyn', 'yalniz anne', 'yalniz baba', 'cocugumla yalniz'],
     'ar': ['والد وحيد', 'ام وحيدة', 'اب وحيد', 'وحدي مع طفلي'],
     'uk': ['одна з дитиною', 'один з дитиною', 'мати-одиначка', 'батько-одинак']},
    needs=['prestations-familiales', 'garde-enfants', 'aides-logement'], rights=['F38245', 'F38243', 'F12006'], steps=['F827', 'F601'], st=[CAF, MAIRIE, MDS])
sit('garde-enfant', 'famille', ['famille/garde-enfants'],
    L('Je cherche une solution pour faire garder mon enfant', 'I am looking for childcare', 'Ich suche eine Kinderbetreuung', 'Çocuğum için bakım çözümü arıyorum', 'أبحث عن حل لرعاية طفلي', 'Я шукаю, з ким залишити дитину'),
    {'fr': ['garde d enfant', 'faire garder', 'creche', 'nounou', 'assistante maternelle', 'halte garderie', 'mode de garde', 'cmg'],
     'en': ['childcare', 'nursery', 'daycare', 'childminder', 'nanny', 'creche'],
     'de': ['kinderbetreuung', 'kita', 'krippe', 'tagesmutter', 'kinderfrau'],
     'tr': ['cocuk bakimi', 'kres', 'bakici', 'gunduz bakimevi'],
     'ar': ['رعاية الاطفال', 'حضانة', 'مربية', 'روضة'],
     'uk': ['догляд за дитиною', 'ясла', 'няня', 'дитячий садок']},
    needs=['garde-enfants'], rights=['F38243'], steps=['F601'], st=[MAIRIE, CAF, PMI])
sit('enfants-a-charge', 'famille', ['famille/prestations-familiales'],
    L('J’ai des enfants à charge : quelles aides vérifier ?', 'I have dependent children: which benefits to check?', 'Ich habe unterhaltsberechtigte Kinder: welche Hilfen prüfen?', 'Bakmakla yükümlü olduğum çocuklarım var: hangi yardımlar?', 'لدي أطفال أعيلهم: ما المساعدات التي أتحقق منها؟', 'У мене діти на утриманні: які допомоги перевірити?'),
    {'fr': ['allocations familiales', 'enfants a charge', 'famille nombreuse', 'mes enfants', 'trois enfants', 'deux enfants', 'caf'],
     'en': ['family allowance', 'child benefit', 'dependent children', 'large family', 'my children'],
     'de': ['kindergeld', 'familienleistungen', 'kinderreiche familie', 'meine kinder'],
     'tr': ['aile yardimi', 'cocuk yardimi', 'kalabalik aile', 'cocuklarim'],
     'ar': ['المنح العائلية', 'اطفال اعيلهم', 'عائلة كبيرة', 'اطفالي'],
     'uk': ['сімейна допомога', 'допомога на дітей', 'багатодітна', 'мої діти']},
    needs=['prestations-familiales'], rights=['F13213', 'F38245', 'F38243', 'F38244', 'F1878'], steps=['ALLOCATIONS_FAMILIALES_DEMANDE', 'ALLOCATION_RENTREE_SCOLAIRE'], st=[CAF, EFS])
sit('parentalite', 'famille', ['famille/parentalite', 'protection-enfance/prevention-enfance'],
    L('J’ai des difficultés avec mon enfant ou mon adolescent', 'I am having difficulties with my child or teenager', 'Ich habe Schwierigkeiten mit meinem Kind oder Teenager', 'Çocuğumla veya ergenimle zorluk yaşıyorum', 'لدي صعوبات مع طفلي أو ابني المراهق', 'У мене труднощі з дитиною або підлітком'),
    {'fr': ['parentalite', 'mon ado', 'adolescent', 'conflit avec mon enfant', 'education', 'crises', 'decrochage scolaire', 'soutien aux parents'],
     'en': ['parenting', 'my teenager', 'teenager', 'conflict with my child', 'behaviour problems', 'parent support'],
     'de': ['erziehung', 'mein teenager', 'jugendlicher', 'streit mit meinem kind', 'elternberatung'],
     'tr': ['ebeveynlik', 'ergen', 'cocugumla sorun', 'cocugumla catisma', 'ebeveyn destegi'],
     'ar': ['تربية الاطفال', 'ابني المراهق', 'مراهق', 'مشاكل مع طفلي', 'دعم الوالدين'],
     'uk': ['виховання', 'підліт', 'конфлікт з дитиною', 'підтримка батьків']},
    st=[MDS, CMPP, PMI])
sit('deces-proche', 'famille', ['transversal/deces-deuil'],
    L('Un proche est décédé', 'A relative has died', 'Ein Angehöriger ist gestorben', 'Bir yakınım vefat etti', 'توفي أحد أقاربي', 'Помер близький родич'),
    {'fr': ['deces', 'decede', 'decedee', 'est decede', 'est decedee', 'est mort', 'est morte', 'mort de', 'obseques', 'enterrement', 'funerailles', 'deuil', 'veuf', 'veuve', 'succession'],
     'en': ['death', 'died', 'passed away', 'funeral', 'bereavement', 'widow', 'widower', 'inheritance'],
     'de': ['todesfall', 'gestorben', 'verstorben', 'beerdigung', 'trauer', 'witwe', 'witwer', 'erbschaft'],
     'tr': ['vefat', 'oldu', 'cenaze', 'yas', 'dul', 'miras'],
     'ar': ['وفاة', 'توفي', 'جنازة', 'حداد', 'ارملة', 'ارمل', 'ميراث'],
     'uk': ['смерть', 'помер', 'померла', 'похорон', 'жалоба', 'вдова', 'вдівець', 'спадщин']},
    st=[MAIRIE, EFS, CCAS])
sit('aidant', 'famille', ['lien-social/aidants'],
    L('Je m’occupe d’un proche malade, handicapé ou âgé', 'I care for a sick, disabled or elderly relative', 'Ich pflege einen kranken, behinderten oder älteren Angehörigen', 'Hasta, engelli veya yaşlı bir yakınıma bakıyorum', 'أعتني بقريب مريض أو معاق أو مسن', 'Я доглядаю хворого, літнього родича або родича з інвалідністю'),
    {'fr': ['aidant', 'aidante', 'proche aidant', 'je m occupe de ma mere', 'je m occupe de mon pere', 'conge de proche aidant', 'repit', 'epuise'],
     'en': ['carer', 'carer for', 'caregiver', 'family carer', 'caring for', 'respite', 'exhausted'],
     'de': ['pflegende angehörige', 'pflege meine mutter', 'pflege meinen vater', 'pflegezeit', 'entlastung', 'erschöpft'],
     'tr': ['bakim veren', 'anneme bakiyorum', 'babama bakiyorum', 'yakinima bakiyorum', 'tukendim'],
     'ar': ['مقدم الرعاية', 'اعتني بامي', 'اعتني بابي', 'رعاية قريب', 'منهك'],
     'uk': ['доглядач', 'доглядаю маму', 'доглядаю тата', 'доглядаю родича', 'виснажен']},
    needs=['aidants'], rights=['F16920', 'F245', 'F10009'], steps=['F246'], st=[CCAS, INFO, MDS])

# ── Enfants et jeunes ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('enfant-danger', 'jeunes', ['protection-enfance/signalement', 'protection-enfance/ase'],
    L('Un enfant est en danger', 'A child is in danger', 'Ein Kind ist in Gefahr', 'Bir çocuk tehlikede', 'طفل في خطر', 'Дитина в небезпеці'),
    {'fr': ['enfant en danger', 'enfance en danger', 'maltraite', 'maltraitance', 'enfant battu', 'mineur en danger', '119'],
     'en': ['child in danger', 'child abuse', 'abused child', 'child at risk', 'neglected child', '119'],
     'de': ['kind in gefahr', 'kindesmisshandlung', 'misshandelt', 'kindeswohl', '119'],
     'tr': ['cocuk tehlikede', 'cocuk istismari', 'cocuga siddet', 'ihmal', '119'],
     'ar': ['طفل في خطر', 'اساءة للطفل', 'طفل معنف', 'اهمال طفل', '119'],
     'uk': ['дитина в небезпеці', 'жорстоке поводження з дитиною', 'дитину б\'ють', '119']},
    steps=['F33954'], em=['119', '112'])
sit('mineur-isole', 'jeunes', ['protection-enfance/mna'],
    L('Je suis mineur et seul en France, sans mes parents', 'I am a minor alone in France, without my parents', 'Ich bin minderjährig und allein in Frankreich, ohne Eltern', 'Reşit değilim ve Fransa’da ailem olmadan yalnızım', 'أنا قاصر وحدي في فرنسا بدون والديّ', 'Я неповнолітній(-я) і сам(-а) у Франції без батьків'),
    {'fr': ['mineur isole', 'mineur non accompagne', 'mna', 'seul en france', 'sans mes parents', 'moins de 18 ans'],
     'en': ['unaccompanied minor', 'alone in france', 'without my parents', 'under 18'],
     'de': ['unbegleiteter minderjähriger', 'allein in frankreich', 'ohne meine eltern', 'unter 18'],
     'tr': ['refakatsiz cocuk', 'fransada yalnizim', 'ailem olmadan', '18 yasindan kucuk'],
     'ar': ['قاصر غير مصحوب', 'وحدي في فرنسا', 'بدون والدي', 'اقل من 18'],
     'uk': ['неповнолітній без супроводу', 'сам у франції', 'без батьків', 'менше 18']},
    steps=['F33954'], st=[MDS], em=['119'])
sit('sortie-ase', 'jeunes', ['protection-enfance/sortie-ase', 'logement/logement-jeunes'],
    L('J’ai 18 ans et je quitte l’aide sociale à l’enfance', 'I am 18 and leaving child welfare (aide sociale à l’enfance)', 'Ich bin 18 und verlasse die Kinder- und Jugendhilfe (aide sociale à l’enfance)', '18 yaşındayım ve çocuk koruma hizmetinden (aide sociale à l’enfance) ayrılıyorum', 'عمري 18 سنة وأغادر رعاية الطفولة (aide sociale à l’enfance)', 'Мені 18 і я виходжу з системи захисту дітей (aide sociale à l’enfance)'),
    {'fr': ['ase', 'aide sociale a l enfance', 'sortie de l ase', 'jeune majeur', 'famille d accueil', 'contrat jeune majeur', 'foyer de l enfance'],
     'en': ['leaving care', 'care leaver', 'foster care', 'turning 18', 'child welfare', 'ase'],
     'de': ['jugendhilfe', 'careleaver', 'pflegefamilie', '18 jahre', 'volljährig', 'heim verlassen'],
     'tr': ['koruma altinda', 'koruyucu aile', '18 yasina', 'yurttan cikis', 'ase'],
     'ar': ['رعاية الطفولة', 'دار الرعاية', 'عائلة حاضنة', 'بلغت 18', '18 سنة'],
     'uk': ['служба у справах дітей', 'прийомна сім\'я', '18 років', 'повноліт', 'виходжу з притулку']},
    needs=['sortie-ase'], steps=['F2018', 'CONTRAT_ENGAGEMENT_JEUNE', 'LOGEMENT_SOCIAL_DEMANDE'], st=[ML, MDS])
sit('jeune-sans-emploi', 'jeunes', ['enfance-jeunesse/jeunes-insertion'],
    L('J’ai entre 16 et 25 ans, sans travail ni formation', 'I am 16 to 25, with no job or training', 'Ich bin 16 bis 25, ohne Arbeit und ohne Ausbildung', '16-25 yaşındayım, ne işim ne eğitimim var', 'عمري بين 16 و25 سنة، بلا عمل ولا تدريب', 'Мені від 16 до 25, без роботи й навчання'),
    {'fr': ['mission locale', 'contrat d engagement jeune', 'cej', 'jeune sans emploi', 'decrocheur', 'sans diplome', 'j ai 18 ans', 'j ai 20 ans', 'premier emploi'],
     'en': ['young and unemployed', 'neet', 'no job no training', 'first job', 'school dropout', 'youth guarantee'],
     'de': ['jung und arbeitslos', 'ohne ausbildung', 'schulabbrecher', 'erster job', 'mission locale'],
     'tr': ['genc issiz', 'okulu biraktim', 'ilk is', 'egitimsiz', 'mission locale'],
     'ar': ['شاب عاطل', 'بلا عمل ولا تدريب', 'اول عمل', 'تركت المدرسة'],
     'uk': ['молодий без роботи', 'без навчання', 'перша робота', 'кинув школу']},
    needs=['recherche-emploi'], steps=['CONTRAT_ENGAGEMENT_JEUNE', 'FRANCE_TRAVAIL_INSCRIPTION'], st=[ML, IJ, FT])
sit('etudiant-difficulte', 'jeunes', ['enfance-jeunesse/etudiants'],
    L('Je suis étudiant et j’ai des difficultés (argent, logement, moral)', 'I am a student having difficulties (money, housing, morale)', 'Ich bin Student und habe Schwierigkeiten (Geld, Wohnung, Psyche)', 'Öğrenciyim ve zorluk yaşıyorum (para, barınma, moral)', 'أنا طالب ولدي صعوبات (المال، السكن، المعنويات)', 'Я студент(-ка) і маю труднощі (гроші, житло, настрій)'),
    {'fr': ['etudiant', 'etudiante', 'universite', 'fac', 'crous', 'bourse etudiante', 'precarite etudiante', 'logement etudiant'],
     'en': ['student', 'university', 'student grant', 'student hardship', 'student housing'],
     'de': ['student', 'studentin', 'universität', 'studium', 'bafög', 'studentenwohnheim'],
     'tr': ['ogrenci', 'universite', 'ogrenci bursu', 'ogrenci yurdu'],
     'ar': ['طالب', 'طالبة', 'الجامعة', 'منحة جامعية', 'سكن الطلاب'],
     'uk': ['студент', 'студентка', 'університет', 'студентська стипендія', 'гуртожиток']},
    needs=['aides-logement', 'psy'], rights=['F12006'], steps=['AIDE_LOGEMENT_DEMANDE', 'F2018'], st=[BAPU, IJ])
sit('scolarite', 'jeunes', ['enfance-jeunesse/scolarite-inclusive'],
    L('Mon enfant va à l’école : frais, cantine, bourse', 'My child goes to school: costs, canteen, grant', 'Mein Kind geht zur Schule: Kosten, Kantine, Stipendium', 'Çocuğum okula gidiyor: masraflar, yemekhane, burs', 'طفلي يذهب إلى المدرسة: مصاريف، مقصف، منحة', 'Моя дитина ходить до школи: витрати, їдальня, стипендія'),
    {'fr': ['ecole', 'rentree', 'rentree scolaire', 'college', 'lycee', 'cantine', 'bourse', 'fournitures', 'scolarite'],
     'en': ['school', 'back to school', 'school year', 'secondary school', 'high school', 'canteen', 'school meals', 'grant', 'school supplies'],
     'de': ['schule', 'schulanfang', 'schuljahr', 'gymnasium', 'kantine', 'schulessen', 'stipendium', 'schulsachen'],
     'tr': ['okul', 'okul donemi', 'ortaokul', 'lise', 'yemekhane', 'burs', 'kirtasiye'],
     'ar': ['مدرسة', 'المدرسة', 'الدخول المدرسي', 'اعدادية', 'ثانوية', 'المقصف', 'منحة', 'ادوات مدرسية'],
     'uk': ['школа', 'школи', 'школу', 'навчальний рік', 'коледж', 'ліцей', 'їдальн', 'стипенді', 'шкільне приладдя']},
    needs=['scolarite-inclusive', 'garde-enfants'], rights=['F38244', 'F1878', 'F19294'], steps=['ALLOCATION_RENTREE_SCOLAIRE', 'BOURSE_COLLEGE_DEMANDE', 'BOURSE_LYCEE_DEMANDE', 'CANTINE_AIDE_DEMANDE'], st=[MAIRIE, CAF, CIO])
sit('jeune-loisirs', 'jeunes', ['lien-social/culture-loisirs'],
    L('Je cherche une activité : sport, culture, loisirs', 'I am looking for an activity: sport, culture, leisure', 'Ich suche eine Aktivität: Sport, Kultur, Freizeit', 'Bir etkinlik arıyorum: spor, kültür, eğlence', 'أبحث عن نشاط: رياضة، ثقافة، ترفيه', 'Я шукаю заняття: спорт, культура, дозвілля'),
    {'fr': ['sport', 'culture', 'loisirs', 'activite', 'pass culture', 'club', 'musique', 'vacances'],
     'en': ['sport', 'culture', 'leisure', 'activity', 'hobby', 'club', 'music', 'holidays'],
     'de': ['sport', 'kultur', 'freizeit', 'aktivität', 'verein', 'musik', 'ferien'],
     'tr': ['spor', 'kultur', 'eglence', 'etkinlik', 'kulup', 'muzik', 'tatil'],
     'ar': ['رياضة', 'ثقافة', 'ترفيه', 'نشاط', 'نادي', 'موسيقى', 'عطلة'],
     'uk': ['спорт', 'культура', 'дозвілля', 'заняття', 'клуб', 'музика', 'канікули']},
    steps=['PASS_CULTURE'], st=[IJ, MAIRIE])

# ── Santé et handicap ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('handicap', 'sante', ['handicap/mdph-droits', 'handicap/vie-sociale'],
    L('Je vis avec un handicap', 'I live with a disability', 'Ich lebe mit einer Behinderung', 'Engelliyim', 'أعيش مع إعاقة', 'Я живу з інвалідністю'),
    {'fr': ['handicap', 'handicape', 'handicapee', 'mdph', 'invalidite', 'fauteuil roulant', 'aah', 'pch', 'rqth', 'savs'],
     'en': ['disability', 'disabled', 'handicap', 'wheelchair', 'mdph', 'impairment'],
     'de': ['behinderung', 'behindert', 'rollstuhl', 'mdph', 'schwerbehindert'],
     'tr': ['engelli', 'engellilik', 'tekerlekli sandalye', 'mdph', 'ozurlu'],
     'ar': ['اعاقة', 'الاعاقة', 'معاق', 'كرسي متحرك', 'ذوي الاحتياجات'],
     'uk': ['інвалідн', 'інвалідність', 'особа з інвалідністю', 'візок', 'mdph']},
    needs=['mdph-droits', 'accessibilite-mobilite'], rights=['F12242', 'F14202', 'F34049'], steps=['F31029'], st=[MDPH, SAVS, SAMSAH, MDS])
sit('enfant-handicap', 'sante', ['handicap/enfants-handicap', 'enfance-jeunesse/scolarite-inclusive'],
    L('Mon enfant a un handicap', 'My child has a disability', 'Mein Kind hat eine Behinderung', 'Çocuğum engelli', 'طفلي لديه إعاقة', 'Моя дитина має інвалідність'),
    {'fr': ['enfant handicape', 'mon enfant a un handicap', 'aesh', 'pps', 'ime', 'sessad', 'camsp', 'itep', 'aeeh', 'autisme', 'autiste', 'troubles dys'],
     'en': ['disabled child', 'my child has a disability', 'special needs', 'autism', 'learning disability'],
     'de': ['behindertes kind', 'mein kind hat eine behinderung', 'förderbedarf', 'autismus', 'schulbegleitung'],
     'tr': ['engelli cocuk', 'cocugum engelli', 'ozel egitim', 'otizm'],
     'ar': ['طفل معاق', 'طفلي معاق', 'احتياجات خاصة', 'التوحد'],
     'uk': ['дитина з інвалідністю', 'особливі потреби', 'аутизм', 'асистент вчителя']},
    needs=['mdph-droits', 'scolarite-inclusive'], steps=['F24610', 'F33865'], st=[MDPH, CAMSP, SESSAD, IME, ITEP])
sit('handicap-travail', 'sante', ['handicap/travail-handicap'],
    L('J’ai un handicap et je cherche un travail', 'I have a disability and I am looking for work', 'Ich habe eine Behinderung und suche Arbeit', 'Engelliyim ve iş arıyorum', 'لدي إعاقة وأبحث عن عمل', 'Я маю інвалідність і шукаю роботу'),
    {'fr': ['travailleur handicape', 'rqth', 'esat', 'cap emploi', 'emploi handicap', 'travail adapte', 'entreprise adaptee'],
     'en': ['disabled worker', 'work with a disability', 'sheltered work', 'supported employment'],
     'de': ['behinderter arbeitnehmer', 'arbeit mit behinderung', 'werkstatt für behinderte', 'inklusionsbetrieb'],
     'tr': ['engelli calisan', 'engelli istihdami', 'korumali is'],
     'ar': ['عامل معاق', 'عمل لذوي الاعاقة', 'تشغيل المعاقين'],
     'uk': ['працівник з інвалідністю', 'робота для людей з інвалідністю']},
    needs=['mdph-droits'], steps=['F31029'], st=[ESAT, FT, MDPH])
sit('handicap-hebergement', 'sante', ['handicap/adultes-hebergement'],
    L('Je cherche un lieu de vie adapté à un handicap', 'I am looking for a place to live adapted to a disability', 'Ich suche eine Wohnform für Menschen mit Behinderung', 'Engelliliğe uygun bir yaşam yeri arıyorum', 'أبحث عن مكان عيش مناسب للإعاقة', 'Я шукаю житло, пристосоване до інвалідності'),
    {'fr': ['foyer de vie', 'foyer d hebergement', 'fam', 'mas', 'maison d accueil specialisee', 'etablissement handicap'],
     'en': ['care home for disabled', 'supported living', 'residential care', 'group home'],
     'de': ['wohnheim für behinderte', 'betreutes wohnen', 'wohngruppe', 'pflegeeinrichtung'],
     'tr': ['engelli yurdu', 'engelli bakim evi', 'destekli yasam'],
     'ar': ['دار لذوي الاعاقة', 'سكن مدعوم', 'مؤسسة للمعاقين'],
     'uk': ['будинок для людей з інвалідністю', 'підтримуване проживання', 'інтернат']},
    steps=['F31029'], st=[FH, FV, FAM, MAS, MDPH])
sit('sans-couverture-sante', 'sante', ['sante/couverture-sante', 'sante/pass', 'sante/centres-sante'],
    L('Je n’ai pas de couverture santé ou je ne peux pas payer mes soins', 'I have no health cover or cannot pay for care', 'Ich habe keine Krankenversicherung oder kann Behandlungen nicht bezahlen', 'Sağlık sigortam yok veya tedavi masraflarını ödeyemiyorum', 'ليس لدي تغطية صحية أو لا أستطيع دفع العلاج', 'У мене немає медичного страхування або я не можу платити за лікування'),
    {'fr': ['mutuelle', 'carte vitale', 'complementaire sante', 'css', 'c2s', 'secu', 'securite sociale', 'pas de couverture', 'soins trop chers', 'medecin', 'ame'],
     'en': ['health insurance', 'no health cover', 'doctor', 'medical care', 'carte vitale', 'can t pay for care'],
     'de': ['krankenversicherung', 'keine versicherung', 'arzt', 'behandlung bezahlen', 'carte vitale'],
     'tr': ['saglik sigortasi', 'sigortam yok', 'doktor', 'tedavi', 'carte vitale'],
     'ar': ['تأمين صحي', 'بدون تغطية صحية', 'طبيب', 'العلاج', 'بطاقة فيتال'],
     'uk': ['медичне страхування', 'немає страховки', 'лікар', 'лікування', 'carte vitale']},
    rights=['F10027', 'F3079'], st=[CPAM, CS, MS, EFS])
sit('sante-sexuelle', 'sante', ['sante/sante-sexuelle'],
    L('J’ai une question sur la contraception, une grossesse ou une infection', 'I have a question about contraception, pregnancy or an infection', 'Ich habe eine Frage zu Verhütung, Schwangerschaft oder einer Infektion', 'Doğum kontrolü, gebelik veya enfeksiyon hakkında sorum var', 'لدي سؤال عن منع الحمل أو الحمل أو عدوى', 'У мене питання про контрацепцію, вагітність чи інфекцію'),
    {'fr': ['contraception', 'pilule', 'ivg', 'avortement', 'ist', 'mst', 'depistage', 'vih', 'sida', 'test de grossesse'],
     'en': ['contraception', 'pill', 'abortion', 'sti', 'std', 'hiv', 'testing', 'pregnancy test'],
     'de': ['verhütung', 'pille', 'abtreibung', 'schwangerschaftsabbruch', 'geschlechtskrankheit', 'hiv', 'test'],
     'tr': ['dogum kontrolu', 'hap', 'kurtaj', 'cinsel yolla bulasan', 'hiv', 'test'],
     'ar': ['منع الحمل', 'حبوب منع الحمل', 'اجهاض', 'عدوى جنسية', 'فيروس نقص المناعة', 'فحص'],
     'uk': ['контрацепц', 'аборт', 'інфекції', 'віл', 'тест на вагітність']},
    st=[CSS, CEGIDD, EVARS])
sit('souffrance-psy', 'sante', ['sante-mentale/psy'],
    L('Je ne vais pas bien moralement depuis un moment', 'I have not been feeling well mentally for a while', 'Mir geht es seit einer Weile psychisch nicht gut', 'Bir süredir ruhsal olarak iyi değilim', 'لست بخير نفسيًا منذ فترة', 'Мені вже деякий час погано на душі'),
    {'fr': ['psychologue', 'psychiatre', 'moral', 'stress', 'angoisse', 'anxiete', 'burn out', 'fatigue', 'cmp', 'ne vais pas bien'],
     'en': ['psychologist', 'psychiatrist', 'anxiety', 'stress', 'mental health', 'burnout', 'not feeling well'],
     'de': ['psychologe', 'psychiater', 'angst', 'stress', 'psychische gesundheit', 'burnout'],
     'tr': ['psikolog', 'psikiyatrist', 'kaygi', 'stres', 'ruh sagligi', 'tukenmislik'],
     'ar': ['طبيب نفسي', 'اخصائي نفسي', 'قلق', 'ضغط نفسي', 'الصحة النفسية'],
     'uk': ['психолог', 'психіатр', 'тривог', 'стрес', 'психічне здоров', 'вигоран']},
    needs=['psy'], rights=['F34917'], st=[CMP, CMPP, BAPU])
sit('detresse', 'sante', ['sante-mentale/crise-suicide'],
    L('Je vais très mal, j’ai des idées noires', 'I feel very bad, I have dark thoughts', 'Mir geht es sehr schlecht, ich habe dunkle Gedanken', 'Çok kötüyüm, karanlık düşüncelerim var', 'أشعر بسوء شديد، لدي أفكار سوداء', 'Мені дуже погано, у мене темні думки'),
    {'fr': ['suicide', 'me suicider', 'en finir', 'envie de mourir', 'plus envie de vivre', 'idees noires', 'desespoir', 'detresse', 'vais tres mal', '3114'],
     'en': ['suicide', 'kill myself', 'end it all', 'want to die', 'no reason to live', 'despair'],
     'de': ['suizid', 'selbstmord', 'umbringen', 'sterben will', 'keinen sinn', 'verzweifelt'],
     'tr': ['intihar', 'olmek istiyorum', 'kendimi oldurmek', 'umutsuz', 'cok kotuyum'],
     'ar': ['انتحار', 'الانتحار', 'اريد ان اموت', 'انهاء حياتي', 'يأس'],
     'uk': ['суїцид', 'самогубств', 'хочу померти', 'покінчити', 'відчай']},
    needs=['crise-suicide', 'psy'], rights=['F34917'], steps=['F33954'], em=['3114', '15', '112'])
sit('addiction', 'sante', ['sante-mentale/addictions'],
    L('J’ai un problème avec l’alcool, la drogue ou les jeux', 'I have a problem with alcohol, drugs or gambling', 'Ich habe ein Problem mit Alkohol, Drogen oder Glücksspiel', 'Alkol, uyuşturucu veya kumarla sorunum var', 'لدي مشكلة مع الكحول أو المخدرات أو القمار', 'У мене проблема з алкоголем, наркотиками чи азартними іграми'),
    {'fr': ['alcool', 'drogue', 'cannabis', 'addiction', 'dependance', 'jeux d argent', 'tabac', 'csapa'],
     'en': ['alcohol', 'drugs', 'addiction', 'addicted', 'gambling', 'cannabis', 'smoking'],
     'de': ['alkohol', 'drogen', 'sucht', 'abhängig', 'glücksspiel', 'cannabis', 'rauchen'],
     'tr': ['alkol', 'uyusturucu', 'bagimlilik', 'bagimli', 'kumar', 'esrar', 'sigara'],
     'ar': ['الكحول', 'مخدرات', 'ادمان', 'مدمن', 'القمار', 'الحشيش', 'التدخين'],
     'uk': ['алкогол', 'наркотик', 'залежн', 'азартні ігри', 'канабіс', 'куріння']},
    st=[CSAPA, CAARUD])
sit('fin-de-vie', 'sante', ['autonomie/fin-de-vie'],
    L('Un proche est gravement malade ou en fin de vie', 'A relative is seriously ill or at the end of life', 'Ein Angehöriger ist schwer krank oder am Lebensende', 'Bir yakınım ağır hasta veya yaşamının sonunda', 'قريب لي مريض جدًا أو في نهاية حياته', 'Близька людина тяжко хвора або при кінці життя'),
    {'fr': ['fin de vie', 'soins palliatifs', 'gravement malade', 'maladie grave', 'cancer', 'accompagner un proche'],
     'en': ['end of life', 'palliative care', 'seriously ill', 'terminal illness', 'cancer'],
     'de': ['lebensende', 'palliativ', 'schwer krank', 'unheilbar', 'krebs'],
     'tr': ['yasamin sonu', 'palyatif bakim', 'agir hasta', 'olumcul hastalik', 'kanser'],
     'ar': ['نهاية الحياة', 'الرعاية التلطيفية', 'مريض جدا', 'مرض خطير', 'سرطان'],
     'uk': ['кінець життя', 'паліатив', 'тяжко хвор', 'невиліковн', 'рак']},
    needs=['aidants'], rights=['F16920'], st=[CCAS, MDS])

# ── Personnes âgées ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('proche-age', 'seniors', ['autonomie/aide-domicile', 'autonomie/apa-aspa', 'autonomie/information-seniors'],
    L('Un proche âgé a besoin d’aide pour rester chez lui', 'An elderly relative needs help to stay at home', 'Ein älterer Angehöriger braucht Hilfe, um zu Hause zu bleiben', 'Yaşlı bir yakınımın evde kalabilmek için yardıma ihtiyacı var', 'قريب مسن يحتاج إلى مساعدة للبقاء في منزله', 'Літньому родичу потрібна допомога, щоб жити вдома'),
    {'fr': ['personne agee', 'mes parents', 'ma mere', 'mon pere', 'grand mere', 'grand pere', 'vieillesse', 'rester a domicile', 'aide a domicile', 'apa', 'perte d autonomie', 'aide menagere'],
     'en': ['elderly', 'old parent', 'my mother', 'my father', 'grandmother', 'grandfather', 'stay at home', 'home help'],
     'de': ['älter', 'ältere', 'meine mutter', 'mein vater', 'großmutter', 'großvater', 'zu hause bleiben', 'haushaltshilfe', 'pflegedienst'],
     'tr': ['yasli', 'annem', 'babam', 'buyukannem', 'buyukbabam', 'evde bakim'],
     'ar': ['مسن', 'كبير السن', 'امي', 'ابي', 'جدتي', 'جدي', 'البقاء في المنزل', 'مساعدة منزلية'],
     'uk': ['літня', 'літні', 'літній', 'похил', 'моя мама', 'мій тато', 'бабус', 'дідус', 'допомога вдома']},
    needs=['aide-domicile', 'adaptation-logement'], rights=['F10009', 'F245', 'F37501'], steps=['F246'], st=[SAD, SSIAD, INFO, CCAS])
sit('maison-retraite', 'seniors', ['autonomie/ehpad-residences'],
    L('Je cherche une maison de retraite pour moi ou un proche', 'I am looking for a care home for myself or a relative', 'Ich suche ein Pflegeheim für mich oder einen Angehörigen', 'Kendim veya bir yakınım için huzurevi arıyorum', 'أبحث عن دار مسنين لي أو لقريب', 'Я шукаю будинок для літніх людей для себе чи родича'),
    {'fr': ['maison de retraite', 'ehpad', 'un ehpad', 'en ehpad', 'place en ehpad', 'residence autonomie', 'residence senior', 'aide sociale a l hebergement', 'ash'],
     'en': ['care home', 'nursing home', 'retirement home', 'old people s home'],
     'de': ['pflegeheim', 'altenheim', 'seniorenheim', 'seniorenresidenz'],
     'tr': ['huzurevi', 'yasli bakim evi', 'bakimevi'],
     'ar': ['دار المسنين', 'دار العجزة', 'دار رعاية المسنين'],
     'uk': ['будинок для літніх', 'будинок престарілих', 'пансіонат']},
    needs=['aide-domicile'], rights=['F2444', 'F10009'], steps=['F255'], st=[EHPAD, RA, INFO])
sit('maltraitance-agee', 'seniors', ['autonomie/maltraitance-ages'],
    L('Une personne âgée ou handicapée est maltraitée', 'An older or disabled person is being mistreated', 'Eine ältere oder behinderte Person wird misshandelt', 'Yaşlı veya engelli bir kişiye kötü davranılıyor', 'شخص مسن أو معاق يتعرض لسوء المعاملة', 'З літньою людиною або людиною з інвалідністю жорстоко поводяться'),
    {'fr': ['maltraitance personne agee', 'maltraite en ehpad', 'personne agee maltraitee', 'abus de faiblesse', '3133', 'negligence'],
     'en': ['elder abuse', 'mistreated elderly', 'abuse in care home', 'neglect'],
     'de': ['misshandlung älterer', 'gewalt in der pflege', 'vernachlässigung'],
     'tr': ['yasliya kotu muamele', 'yasli istismari', 'ihmal'],
     'ar': ['سوء معاملة المسنين', 'اساءة لمسن', 'اهمال'],
     'uk': ['жорстоке поводження з літніми', 'насильство над літніми', 'нехтування']},
    steps=['F33954'], st=[INFO, CCAS], em=['3133', '112'])
sit('retraite', 'seniors', ['autonomie/apa-aspa', 'autonomie/information-seniors'],
    L('Je vais prendre ma retraite', 'I am about to retire', 'Ich gehe bald in Rente', 'Yakında emekli olacağım', 'سأتقاعد قريبًا', 'Я скоро виходжу на пенсію'),
    {'fr': ['retraite', 'partir a la retraite', 'pension de retraite', 'retraite trop petite', 'aspa', 'minimum vieillesse'],
     'en': ['retirement', 'retire', 'retiring', 'pension', 'old age pension', 'aspa'],
     'de': ['rente', 'ruhestand', 'in rente gehen', 'pension', 'altersrente', 'aspa'],
     'tr': ['emeklilik', 'emekli', 'emekli olmak', 'emekli maasi', 'aspa'],
     'ar': ['تقاعد', 'التقاعد', 'معاش', 'المعاش', 'راتب التقاعد'],
     'uk': ['пенсі', 'вихід на пенсію', 'пенсіонер']},
    rights=['F16871'], steps=['RETRAITE_DEMANDE', 'ASPA_DEMANDE'], st=[EFS, INFO])

# ── Violences et sécurité ─────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('violences', 'violences', ['violences/violences-conjugales'],
    L('Je subis des violences dans mon couple ou ma famille', 'I am experiencing violence from my partner or family', 'Ich erlebe Gewalt in meiner Beziehung oder Familie', 'Eşimden veya ailemden şiddet görüyorum', 'أتعرض للعنف من شريكي أو عائلتي', 'Я зазнаю насильства від партнера чи родини'),
    {'fr': ['violence', 'violences', 'violent', 'frappe', 'me bat', 'battue', 'battu', 'coups', 'menace', 'peur de mon', 'conjoint', 'mari', 'compagnon', '3919'],
     'en': ['violence', 'violent', 'abuse', 'abused', 'hits me', 'beaten', 'beats me', 'threatens', 'afraid of my', 'domestic'],
     'de': ['gewalt', 'gewalttätig', 'schlägt mich', 'geschlagen', 'bedroht', 'angst vor meinem', 'häusliche'],
     'tr': ['siddet', 'dovuyor', 'dayak', 'tehdit', 'korkuyorum', 'esim', 'kocam'],
     'ar': ['عنف', 'العنف', 'يضربني', 'ضرب', 'تهديد', 'اخاف من', 'زوجي'],
     'uk': ['насильств', 'насилля', 'б\'є мене', 'бʼє мене', 'погрож', 'боюся', 'кривдн', 'домашнє', 'чоловік']},
    needs=['violences-conjugales'], steps=['F12544', 'F33954'], st=[CIDFF, BAV, PJ], em=['3919', '17', '112', '119'])
sit('violences-sexuelles', 'violences', ['violences/violences-sexuelles'],
    L('J’ai subi une violence sexuelle', 'I have experienced sexual violence', 'Ich habe sexuelle Gewalt erlebt', 'Cinsel şiddete maruz kaldım', 'تعرضت لعنف جنسي', 'Я зазнала(-в) сексуального насильства'),
    {'fr': ['viol', 'violee', 'viole', 'agression sexuelle', 'violence sexuelle', 'attouchements', 'inceste'],
     'en': ['rape', 'raped', 'sexual assault', 'sexual violence', 'sexual abuse', 'incest'],
     'de': ['vergewaltigung', 'vergewaltigt', 'sexueller übergriff', 'sexuelle gewalt', 'missbrauch', 'inzest'],
     'tr': ['tecavuz', 'cinsel saldiri', 'cinsel siddet', 'taciz', 'ensest'],
     'ar': ['اغتصاب', 'اعتداء جنسي', 'عنف جنسي', 'تحرش جنسي', 'زنا المحارم'],
     'uk': ['зґвалтув', 'сексуальне насильство', 'сексуальне насилля', 'домагання', 'інцест']},
    steps=['F33954'], st=[CIDFF, BAV], em=['0800059595', '17', '112'])
sit('victime', 'violences', ['violences/victimes', 'justice/acces-au-droit'],
    L('J’ai été victime d’un vol, d’une agression ou d’une arnaque', 'I was the victim of theft, assault or a scam', 'Ich wurde Opfer von Diebstahl, Angriff oder Betrug', 'Hırsızlık, saldırı veya dolandırıcılık mağduru oldum', 'كنت ضحية سرقة أو اعتداء أو احتيال', 'Я став(-ла) жертвою крадіжки, нападу чи шахрайства'),
    {'fr': ['victime', 'vol', 'vole', 'cambriolage', 'agression', 'agresse', 'arnaque', 'escroquerie', 'porter plainte', 'plainte'],
     'en': ['victim', 'theft', 'stolen', 'burglary', 'assault', 'attacked', 'scam', 'fraud', 'report to police'],
     'de': ['opfer', 'diebstahl', 'gestohlen', 'einbruch', 'überfall', 'angegriffen', 'betrug', 'anzeige'],
     'tr': ['magdur', 'hirsizlik', 'calindi', 'soygun', 'saldiri', 'dolandiricilik', 'sikayet'],
     'ar': ['ضحية', 'سرقة', 'سرق', 'سطو', 'اعتداء', 'احتيال', 'شكوى'],
     'uk': ['жертва', 'крадіжк', 'вкрали', 'пограбуван', 'напад', 'шахрайств', 'заява в поліцію']},
    st=[BAV, PJ, MJD])
sit('harcelement', 'violences', ['violences/harcelement'],
    L('Je subis du harcèlement (travail, école, internet)', 'I am being harassed (work, school, online)', 'Ich werde belästigt oder gemobbt (Arbeit, Schule, Internet)', 'Tacize uğruyorum (iş, okul, internet)', 'أتعرض للتحرش أو التنمر (العمل، المدرسة، الإنترنت)', 'Мене цькують або переслідують (робота, школа, інтернет)'),
    {'fr': ['harcelement', 'harcele', 'harcelee', 'cyberharcelement', 'moqueries', 'harcelement scolaire', 'harcelement au travail'],
     'en': ['harassment', 'harassed', 'bullying', 'bullied', 'cyberbullying', 'stalking'],
     'de': ['belästigung', 'belästigt', 'mobbing', 'gemobbt', 'cybermobbing', 'stalking'],
     'tr': ['taciz', 'zorbalik', 'mobbing', 'siber zorbalik', 'israrli takip'],
     'ar': ['تحرش', 'تنمر', 'التنمر الالكتروني', 'ملاحقة'],
     'uk': ['цькуван', 'булінг', 'переслідуван', 'кібербулінг', 'домагання на роботі']},
    st=[PJ, BAV, MJD])
sit('exploitation', 'violences', ['violences/traite-exploitation'],
    L('On me force à travailler ou à me prostituer', 'Someone is forcing me to work or into prostitution', 'Ich werde zur Arbeit oder Prostitution gezwungen', 'Beni çalışmaya veya fuhuşa zorluyorlar', 'يجبرونني على العمل أو الدعارة', 'Мене змушують працювати або займатися проституцією'),
    {'fr': ['force a travailler', 'travail force', 'exploitation', 'prostitution', 'proxenete', 'traite des etres humains', 'passeport confisque', 'papiers confisques'],
     'en': ['forced to work', 'forced labour', 'exploitation', 'prostitution', 'trafficking', 'passport taken'],
     'de': ['zur arbeit gezwungen', 'zwangsarbeit', 'ausbeutung', 'prostitution', 'menschenhandel', 'pass abgenommen'],
     'tr': ['zorla calistiriliyorum', 'zorla calistirma', 'somuru', 'fuhus', 'insan ticareti', 'pasaportumu aldilar'],
     'ar': ['يجبرونني على العمل', 'عمل قسري', 'استغلال', 'دعارة', 'اتجار بالبشر', 'اخذوا جوازي'],
     'uk': ['змушують працювати', 'примусова праця', 'експлуатац', 'проституц', 'торгівля людьми', 'забрали паспорт']},
    steps=['F33954'], st=[BAV], em=['17', '112'])

# ── Arriver en France, étrangers ──────────────────────────────────────────────────────────────────────────────────────────────────
sit('arrivee-strasbourg', 'etrangers', ['transversal/institutions-locales', 'logement/logement-social'],
    L('Je viens d’arriver à Strasbourg ou dans l’Eurométropole', 'I have just arrived in Strasbourg or the Eurométropole', 'Ich bin gerade in Straßburg oder der Eurométropole angekommen', 'Strazburg’a veya Eurométropole’e yeni geldim', 'وصلت للتو إلى ستراسبورغ أو إلى Eurométropole', 'Я щойно приїхав(-ла) до Страсбурга або Eurométropole'),
    {'fr': ['arrivee', 'suis arrive', 'suis arrivee', 'viens d arriver', 'nouveau a', 'nouvelle a', 'installer a', 'strasbourg', 'eurometropole', 'nouvelle ville'],
     'en': ['just arrived', 'arrived in', 'new in', 'relocated', 'strasbourg', 'new city'],
     'de': ['neu in', 'angekommen', 'zugezogen', 'straßburg', 'strasbourg'],
     'tr': ['yeni geldim', 'strazburg', 'strasbourg', 'yeni sehir'],
     'ar': ['وصلت', 'وصلت للتو', 'جديد في', 'ستراسبورغ', 'مدينة جديدة'],
     'uk': ['щойно приїхав', 'щойно приїхала', 'приїхав', 'страсбург']},
    needs=['acces-aux-droits', 'aides-logement'], rights=['F12006', 'F1280', 'F33453'], steps=['F827', 'LOGEMENT_SOCIAL_DEMANDE', 'AIDE_LOGEMENT_DEMANDE', 'VISALE_DEMANDE'], st=[MAIRIE, EFS, MDS, CCAS])
sit('titre-sejour', 'etrangers', ['migration/titre-sejour'],
    L('Je dois demander ou renouveler mon titre de séjour', 'I need to apply for or renew my residence permit', 'Ich muss meinen Aufenthaltstitel beantragen oder verlängern', 'Oturma iznimi almam veya yenilemem gerekiyor', 'يجب أن أطلب أو أجدد تصريح إقامتي', 'Мені треба отримати або продовжити посвідку на проживання'),
    {'fr': ['titre de sejour', 'renouveler mon titre', 'renouvellement', 'carte de sejour', 'prefecture', 'recepisse', 'anef', 'rendez vous prefecture'],
     'en': ['residence permit', 'renew my permit', 'residence card', 'prefecture', 'visa renewal'],
     'de': ['aufenthaltstitel', 'aufenthaltserlaubnis verlängern', 'aufenthaltskarte', 'präfektur'],
     'tr': ['oturma izni', 'ikamet izni', 'izin yenileme', 'oturum karti', 'valilik'],
     'ar': ['تصريح الاقامة', 'بطاقة الاقامة', 'تجديد الاقامة', 'المحافظة'],
     'uk': ['посвідка на проживання', 'продовжити посвідку', 'дозвіл на проживання', 'префектур']},
    st=[PREF, SPREF, EFS, PJ])
sit('demande-asile', 'etrangers', ['migration/asile'],
    L('Je veux demander l’asile', 'I want to apply for asylum', 'Ich möchte Asyl beantragen', 'İltica başvurusu yapmak istiyorum', 'أريد طلب اللجوء', 'Я хочу попросити притулку'),
    {'fr': ['asile', 'demandeur d asile', 'refugie', 'ofpra', 'cnda', 'cada', 'guda'],
     'en': ['asylum', 'asylum seeker', 'refugee', 'ofpra'],
     'de': ['asyl', 'asylbewerber', 'asylantrag', 'flüchtling'],
     'tr': ['iltica', 'siginmaci', 'multeci', 'siginma'],
     'ar': ['لجوء', 'اللجوء', 'طالب لجوء', 'لاجئ'],
     'uk': ['політичний притулок', 'попросити притулку', 'шукач притулку', 'біжен']},
    st=[OFII, PREF])
sit('protection-temporaire', 'etrangers', ['migration/protection-temporaire'],
    L('J’ai fui la guerre en Ukraine (protection temporaire)', 'I fled the war in Ukraine (temporary protection)', 'Ich bin vor dem Krieg in der Ukraine geflohen (vorübergehender Schutz)', 'Ukrayna’daki savaştan kaçtım (geçici koruma)', 'هربت من الحرب في أوكرانيا (الحماية المؤقتة)', 'Я втік(-ла) від війни в Україні (тимчасовий захист)'),
    {'fr': ['ukraine', 'ukrainien', 'ukrainienne', 'protection temporaire', 'fui la guerre', 'deplace'],
     'en': ['ukraine', 'ukrainian', 'temporary protection', 'fled the war', 'displaced'],
     'de': ['ukraine', 'ukrainer', 'vorübergehender schutz', 'vor dem krieg geflohen'],
     'tr': ['ukrayna', 'ukraynali', 'gecici koruma', 'savastan kactim'],
     'ar': ['اوكرانيا', 'اوكراني', 'الحماية المؤقتة', 'هربت من الحرب'],
     'uk': ['україна', 'україни', 'тимчасовий захист', 'втік від війни', 'втекла від війни', 'переселен']},
    st=[PREF, EFS])
sit('apprendre-francais', 'etrangers', ['migration/integration-langue'],
    L('Je veux apprendre le français', 'I want to learn French', 'Ich möchte Französisch lernen', 'Fransızca öğrenmek istiyorum', 'أريد تعلم اللغة الفرنسية', 'Я хочу вивчати французьку'),
    {'fr': ['apprendre le francais', 'cours de francais', 'parler francais', 'fle', 'alphabetisation', 'contrat d integration'],
     'en': ['learn french', 'french lessons', 'french course', 'speak french'],
     'de': ['französisch lernen', 'französischkurs', 'sprachkurs'],
     'tr': ['fransizca ogrenmek', 'fransizca kursu', 'dil kursu'],
     'ar': ['تعلم الفرنسية', 'دروس الفرنسية', 'دورة اللغة الفرنسية'],
     'uk': ['вивчати французьку', 'курси французької', 'французька мова']},
    st=[OFII, MAIRIE, EFS])
sit('sans-titre-sejour', 'etrangers', ['migration/droits-sans-titre', 'precarite/acces-aux-droits'],
    L('Je n’ai pas de titre de séjour', 'I do not have a residence permit', 'Ich habe keinen Aufenthaltstitel', 'Oturma iznim yok', 'ليس لدي تصريح إقامة', 'У мене немає посвідки на проживання'),
    {'fr': ['sans papiers', 'pas de papiers', 'sejour irregulier', 'aide medicale de l etat', 'pas de titre de sejour'],
     'en': ['undocumented', 'no papers', 'no residence permit', 'irregular status'],
     'de': ['ohne papiere', 'keine papiere', 'ohne aufenthaltstitel', 'illegal'],
     'tr': ['kagitsiz', 'belgesiz', 'oturma iznim yok', 'kacak'],
     'ar': ['بدون اوراق', 'بلا اوراق', 'بدون تصريح اقامة'],
     'uk': ['без документів', 'немає посвідки', 'нелегально']},
    needs=['droits-sans-titre', 'hebergement-urgence'], rights=['F3079'], steps=['F17317', 'F2003'], st=[EFS, CPAM, CCAS])

# ── Justice et droits ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('litige', 'justice', ['justice/acces-au-droit'],
    L('J’ai un conflit avec quelqu’un (voisin, employeur, propriétaire, vendeur)', 'I have a dispute with someone (neighbour, employer, landlord, seller)', 'Ich habe einen Streit (Nachbar, Arbeitgeber, Vermieter, Verkäufer)', 'Biriyle anlaşmazlığım var (komşu, işveren, ev sahibi, satıcı)', 'لدي نزاع مع شخص ما (جار، صاحب عمل، مالك، بائع)', 'У мене конфлікт (сусід, роботодавець, власник житла, продавець)'),
    {'fr': ['litige', 'conflit', 'voisin', 'prud hommes', 'avocat', 'aide juridictionnelle', 'conseil juridique', 'tribunal', 'conciliateur'],
     'en': ['dispute', 'conflict', 'neighbour', 'lawyer', 'legal aid', 'legal advice', 'court'],
     'de': ['streit', 'konflikt', 'nachbar', 'anwalt', 'prozesskostenhilfe', 'rechtsberatung', 'gericht'],
     'tr': ['anlasmazlik', 'komsu', 'avukat', 'adli yardim', 'hukuki danisma', 'mahkeme'],
     'ar': ['نزاع', 'خلاف', 'جار', 'محامي', 'مساعدة قضائية', 'استشارة قانونية', 'محكمة'],
     'uk': ['спір', 'конфлікт', 'сусід', 'адвокат', 'правова допомога', 'юридична консультац', 'суд']},
    st=[PJ, MJD])
sit('contester-decision', 'justice', ['justice/recours', 'discrimination/defenseur-droits'],
    L('Je veux contester une décision (Caf, France Travail, administration)', 'I want to challenge a decision (Caf, France Travail, administration)', 'Ich möchte eine Entscheidung anfechten (Caf, France Travail, Behörde)', 'Bir karara itiraz etmek istiyorum (Caf, France Travail, idare)', 'أريد الطعن في قرار (Caf، France Travail، الإدارة)', 'Я хочу оскаржити рішення (Caf, France Travail, адміністрація)'),
    {'fr': ['contester', 'recours', 'refus', 'decision injuste', 'indu', 'trop percu', 'radiation', 'defenseur des droits', 'mediateur'],
     'en': ['challenge a decision', 'appeal', 'refusal', 'unfair decision', 'overpayment', 'ombudsman'],
     'de': ['widerspruch', 'anfechten', 'ablehnung', 'ungerechte entscheidung', 'rückforderung', 'ombudsmann'],
     'tr': ['itiraz', 'ret karari', 'haksiz karar', 'fazla odeme', 'arabulucu'],
     'ar': ['طعن', 'اعتراض', 'رفض', 'قرار ظالم', 'مبلغ زائد', 'وسيط'],
     'uk': ['оскаржити', 'оскарження', 'відмова', 'несправедливе рішення', 'переплата', 'омбудсман']},
    steps=['RECOURS_ADMINISTRATIF'], st=[EFS, PJ])
sit('sortie-detention', 'justice', ['justice/pjj-spip'],
    L('Je sors de prison, ou un proche en sort', 'I am leaving prison, or a relative is', 'Ich werde aus der Haft entlassen, oder ein Angehöriger', 'Cezaevinden çıkıyorum veya bir yakınım çıkıyor', 'أخرج من السجن أو يخرج قريب لي', 'Я виходжу з в’язниці або виходить мій родич'),
    {'fr': ['prison', 'detention', 'sortie de prison', 'liberation', 'spip', 'pjj', 'bracelet electronique', 'condamne'],
     'en': ['prison', 'released from prison', 'leaving prison', 'probation', 'parole'],
     'de': ['gefängnis', 'haft', 'haftentlassung', 'bewährung', 'entlassen'],
     'tr': ['cezaevi', 'hapis', 'tahliye oldum', 'denetimli serbestlik'],
     'ar': ['السجن', 'خروج من السجن', 'الافراج', 'المراقبة القضائية'],
     'uk': ['в\'язниц', 'вʼязниц', 'звільнення з', 'ув\'язнен', 'пробац']},
    steps=['F17317', 'FRANCE_TRAVAIL_INSCRIPTION', 'CARTE_IDENTITE_DEMANDE'], st=[PJ, FT, MDS])
sit('protection-majeur', 'justice', ['protection-majeurs/mesures', 'protection-majeurs/mjpm'],
    L('Un proche ne peut plus gérer seul son argent et ses papiers', 'A relative can no longer manage their money and papers alone', 'Ein Angehöriger kann Geld und Papiere nicht mehr allein regeln', 'Bir yakınım parasını ve evraklarını artık tek başına yönetemiyor', 'قريب لي لم يعد يستطيع إدارة ماله وأوراقه وحده', 'Родич більше не може сам керувати грошима й документами'),
    {'fr': ['tutelle', 'tutelle pour', 'sous tutelle', 'curatelle', 'curatelle pour', 'sauvegarde de justice', 'mandataire', 'mjpm', 'habilitation familiale', 'ne peut plus gerer'],
     'en': ['guardianship', 'legal guardian', 'conservatorship', 'power of attorney', 'can no longer manage'],
     'de': ['betreuung', 'vormundschaft', 'gesetzlicher betreuer', 'vorsorgevollmacht'],
     'tr': ['vesayet', 'vasi', 'kayyum', 'vekaletname'],
     'ar': ['وصاية', 'قيم', 'وكالة', 'لم يعد يستطيع التدبير'],
     'uk': ['опіка', 'піклування', 'опікун', 'довіреність']},
    st=[MJPM, PJ, MJD])
sit('discrimination', 'justice', ['discrimination/defenseur-droits', 'discrimination/lgbtqi'],
    L('Je suis victime de discrimination ou de rejet', 'I am facing discrimination or rejection', 'Ich werde diskriminiert oder ausgegrenzt', 'Ayrımcılığa veya dışlanmaya maruz kalıyorum', 'أتعرض للتمييز أو الرفض', 'Мене дискримінують або відштовхують'),
    {'fr': ['discrimination', 'victime de racisme', 'victime de discrimination', 'discrimine', 'racisme', 'raciste', 'homophobie', 'transphobie', 'lgbt', 'rejete', 'origine', 'refus a cause'],
     'en': ['discrimination', 'discriminated', 'racism', 'racist', 'homophobia', 'transphobia', 'lgbt'],
     'de': ['diskriminierung', 'diskriminiert', 'rassismus', 'homophobie', 'transphobie', 'lgbt'],
     'tr': ['ayrimcilik', 'irkcilik', 'homofobi', 'transfobi', 'lgbt', 'dislandim'],
     'ar': ['تمييز', 'عنصرية', 'رهاب المثلية', 'مجتمع الميم', 'lgbt'],
     'uk': ['дискримінац', 'расизм', 'гомофоб', 'трансфоб', 'lgbt', 'лгбт']},
    st=[PJ, MJD])

# ── Vie quotidienne ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
sit('demarches-papiers', 'quotidien', ['precarite/acces-aux-droits', 'numerique/demarches-en-ligne'],
    L('J’ai besoin d’aide pour un dossier ou un formulaire', 'I need help with a file or a form', 'Ich brauche Hilfe bei einem Antrag oder Formular', 'Bir dosya veya form için yardıma ihtiyacım var', 'أحتاج مساعدة في ملف أو استمارة', 'Мені потрібна допомога з документами чи формою'),
    {'fr': ['demarche', 'demarches', 'papiers', 'dossier', 'formulaire', 'courrier', 'lettre', 'remplir', 'administration'],
     'en': ['paperwork', 'forms', 'form', 'fill in', 'letter', 'administration'],
     'de': ['formular', 'formulare', 'behörde', 'papierkram', 'antrag ausfüllen', 'brief'],
     'tr': ['evrak', 'basvuru', 'form', 'doldurmak', 'mektup', 'resmi islem'],
     'ar': ['اوراق', 'معاملات', 'استمارة', 'ملء', 'رسالة', 'الادارة'],
     'uk': ['документ', 'форма', 'заява', 'заяви', 'заповнити', 'лист']},
    needs=['acces-aux-droits'], st=[EFS, MAIRIE, CCAS])
sit('pas-internet', 'quotidien', ['numerique/demarches-en-ligne'],
    L('Je n’ai pas internet ou je ne sais pas faire mes démarches en ligne', 'I have no internet or cannot do procedures online', 'Ich habe kein Internet oder komme mit Online-Anträgen nicht zurecht', 'İnternetim yok veya işlemleri çevrimiçi yapamıyorum', 'ليس لدي إنترنت أو لا أعرف إجراء المعاملات عبر الإنترنت', 'У мене немає інтернету або я не вмію робити процедури онлайн'),
    {'fr': ['internet', 'en ligne', 'ordinateur', 'smartphone', 'mot de passe', 'franceconnect', 'mail', 'numerique', 'scanner'],
     'en': ['internet', 'online', 'computer', 'smartphone', 'password', 'email', 'digital'],
     'de': ['internet', 'online', 'computer', 'smartphone', 'passwort', 'e-mail', 'digital'],
     'tr': ['internet', 'cevrimici', 'bilgisayar', 'akilli telefon', 'sifre', 'e posta'],
     'ar': ['الانترنت', 'اونلاين', 'حاسوب', 'هاتف ذكي', 'كلمة السر', 'بريد الكتروني'],
     'uk': ['інтернет', 'онлайн', 'комп\'ютер', 'смартфон', 'пароль', 'електронна пошта']},
    needs=['acces-aux-droits'], st=[EFS, MAIRIE])
sit('lire-ecrire', 'quotidien', ['numerique/illettrisme'],
    L('J’ai du mal à lire ou à écrire', 'I find it hard to read or write', 'Ich habe Schwierigkeiten mit Lesen oder Schreiben', 'Okumakta veya yazmakta zorlanıyorum', 'أجد صعوبة في القراءة أو الكتابة', 'Мені важко читати або писати'),
    {'fr': ['lire', 'ecrire', 'illettrisme', 'illettre', 'analphabete', 'ne sais pas lire', 'ne sais pas ecrire'],
     'en': ['read', 'write', 'reading', 'writing', 'illiterate', 'literacy'],
     'de': ['lesen', 'schreiben', 'analphabet', 'alphabetisierung'],
     'tr': ['okumak', 'yazmak', 'okuma yazma', 'okuma yazma bilmiyorum'],
     'ar': ['القراءة', 'الكتابة', 'لا اعرف القراءة', 'محو الامية'],
     'uk': ['читати', 'писати', 'неписьменн', 'грамотн']},
    st=[EFS, CCAS])
sit('papiers-perdus', 'quotidien', ['precarite/acces-aux-droits'],
    L('J’ai perdu mes papiers ou on me les a volés', 'I lost my papers or they were stolen', 'Ich habe meine Papiere verloren oder sie wurden gestohlen', 'Belgelerimi kaybettim veya çalındı', 'فقدت أوراقي أو سُرقت', 'Я загубив(-ла) документи або їх вкрали'),
    {'fr': ['perdu mes papiers', 'papiers perdus', 'papiers voles', 'perdu ma carte d identite', 'perdu mon passeport', 'carte d identite', 'passeport', 'acte de naissance'],
     'en': ['lost my papers', 'lost my id', 'lost my passport', 'stolen papers', 'identity card', 'passport', 'birth certificate'],
     'de': ['papiere verloren', 'ausweis verloren', 'pass verloren', 'papiere gestohlen', 'personalausweis', 'reisepass', 'geburtsurkunde'],
     'tr': ['belgelerimi kaybettim', 'kimligimi kaybettim', 'pasaportumu kaybettim', 'kimlik karti', 'pasaport', 'dogum belgesi'],
     'ar': ['فقدت اوراقي', 'فقدت بطاقة الهوية', 'فقدت جواز السفر', 'بطاقة الهوية', 'جواز السفر', 'شهادة الميلاد'],
     'uk': ['загубив документи', 'загубила документи', 'вкрали документи', 'посвідчення особи', 'паспорт', 'свідоцтво про народження']},
    steps=['CARTE_IDENTITE_DEMANDE', 'PASSEPORT_DEMANDE', 'ACTE_NAISSANCE_DEMANDE'], st=[MAIRIE, EFS])
sit('demenagement', 'quotidien', ['transversal/institutions-locales', 'logement/aides-logement'],
    L('Je déménage', 'I am moving house', 'Ich ziehe um', 'Taşınıyorum', 'سأنتقل إلى مسكن آخر', 'Я переїжджаю'),
    {'fr': ['demenage', 'demenagement', 'changement d adresse', 'nouvelle adresse', 'emmenage'],
     'en': ['moving house', 'moving home', 'change of address', 'new address', 'moved'],
     'de': ['umzug', 'umziehen', 'umgezogen', 'adressänderung', 'neue adresse'],
     'tr': ['tasiniyorum', 'tasindim', 'tasinma', 'adres degisikligi', 'yeni adres'],
     'ar': ['انتقل', 'انتقلت', 'تغيير العنوان', 'عنوان جديد'],
     'uk': ['переїжджаю', 'переїхав', 'переїхала', 'переїзд', 'зміна адреси', 'нова адреса']},
    needs=['aides-logement'], steps=['F827', 'AIDE_LOGEMENT_DEMANDE'], st=[MAIRIE, CAF, EFS])
sit('transport-cout', 'quotidien', ['mobilite/tarifs-solidaires'],
    L('Les transports en commun me coûtent trop cher', 'Public transport is too expensive for me', 'Öffentliche Verkehrsmittel sind mir zu teuer', 'Toplu taşıma bana çok pahalı geliyor', 'المواصلات العامة مكلفة جدًا بالنسبة لي', 'Громадський транспорт для мене задорогий'),
    {'fr': ['tram', 'bus', 'cts', 'abonnement', 'transport', 'tarif solidaire', 'titre de transport', 'ticket'],
     'en': ['tram', 'bus', 'public transport', 'travel pass', 'reduced fare', 'ticket'],
     'de': ['straßenbahn', 'bus', 'nahverkehr', 'monatskarte', 'sozialtarif', 'fahrkarte'],
     'tr': ['tramvay', 'otobus', 'toplu tasima', 'abonman', 'indirimli bilet', 'bilet'],
     'ar': ['الترام', 'الحافلة', 'النقل العام', 'اشتراك', 'تذكرة'],
     'uk': ['трамвай', 'автобус', 'громадський транспорт', 'проїзний', 'квиток']},
    st=[CCAS, MAIRIE])
sit('permis-mobilite', 'quotidien', ['mobilite/mobilite-emploi', 'emploi/freins-emploi'],
    L('Je n’ai pas de moyen de transport pour aller travailler', 'I have no means of transport to get to work', 'Ich habe kein Verkehrsmittel, um zur Arbeit zu kommen', 'İşe gitmek için ulaşım aracım yok', 'ليس لدي وسيلة نقل للذهاب إلى العمل', 'У мене немає транспорту, щоб їздити на роботу'),
    {'fr': ['permis de conduire', 'permis', 'voiture', 'scooter', 'velo', 'aller au travail', 'mobilite', 'garage solidaire'],
     'en': ['driving licence', 'driving license', 'car', 'scooter', 'bike', 'get to work'],
     'de': ['führerschein', 'auto', 'roller', 'fahrrad', 'zur arbeit kommen'],
     'tr': ['ehliyet', 'araba', 'scooter', 'bisiklet', 'ise gitmek'],
     'ar': ['رخصة القيادة', 'سيارة', 'دراجة', 'الذهاب الى العمل'],
     'uk': ['водійські права', 'машина', 'автомобіль', 'велосипед', 'дістатися на роботу']},
    st=[FT, ML])
sit('transport-adapte', 'quotidien', ['mobilite/transport-adapte', 'handicap/accessibilite-mobilite'],
    L('J’ai besoin d’un transport adapté (handicap, mobilité réduite)', 'I need adapted transport (disability, reduced mobility)', 'Ich brauche einen angepassten Fahrdienst (Behinderung, eingeschränkte Mobilität)', 'Uyarlanmış ulaşıma ihtiyacım var (engellilik, hareket kısıtlılığı)', 'أحتاج إلى نقل مكيّف (إعاقة، حركة محدودة)', 'Мені потрібен пристосований транспорт (інвалідність, обмежена мобільність)'),
    {'fr': ['transport adapte', 'mobilite reduite', 'pmr', 'carte mobilite inclusion', 'cmi', 'stationnement', 'fauteuil'],
     'en': ['adapted transport', 'reduced mobility', 'disabled parking', 'blue badge', 'wheelchair transport'],
     'de': ['fahrdienst', 'eingeschränkte mobilität', 'behindertenparkplatz', 'parkausweis'],
     'tr': ['engelli ulasim', 'hareket kisitliligi', 'engelli otoparki'],
     'ar': ['نقل مكيف', 'حركة محدودة', 'موقف لذوي الاعاقة'],
     'uk': ['пристосований транспорт', 'обмежена мобільність', 'паркування для людей з інвалідністю']},
    needs=['accessibilite-mobilite'], rights=['F34049'], st=[MDPH])
sit('isolement', 'quotidien', ['lien-social/isolement'],
    L('Je me sens seul', 'I feel lonely', 'Ich fühle mich einsam', 'Kendimi yalnız hissediyorum', 'أشعر بالوحدة', 'Я почуваюся самотнім(-ньою)'),
    {'fr': ['seul', 'seule', 'solitude', 'isole', 'isolee', 'personne a qui parler', 'parler a quelqu un'],
     'en': ['lonely', 'loneliness', 'isolated', 'no one to talk to'],
     'de': ['einsam', 'einsamkeit', 'isoliert', 'niemand zum reden'],
     'tr': ['yalnizim', 'yalnizlik', 'kimsem yok', 'konusacak kimse'],
     'ar': ['وحيد', 'وحيدة', 'الوحدة', 'معزول', 'لا احد اتحدث معه'],
     'uk': ['самотн', 'ізольован', 'нема з ким поговорити']},
    needs=['isolement'], st=[CCAS, INFO, MAIRIE])

UNCOVERED = [{'subdomain': 'transversal/coordination-pro', 'reason': 'Coordination des professionnels : pas un événement de vie d’une personne (relève d’ADA Pro et des orientations professionnelles).'}]
DROPPED = [
    {'situation': 'creation-activite', 'fr': 'Je veux créer mon activité', 'reason': 'Aucune fiche, démarche Mon Parcours ni sous-domaine du catalogue ne la couvre : non affichée.'},
    {'situation': 'equivalence-diplome', 'fr': 'Je veux faire reconnaître mon diplôme étranger', 'reason': 'Aucune fiche, démarche Mon Parcours ni sous-domaine du catalogue ne la couvre : non affichée.'},
]

def main():
    p = os.path.join(ROOT, 'data/reference/life-situations.v1.json')
    old = json.load(open(p, encoding='utf-8'))
    out = {
        'schema': old['schema'], 'version': '2.0.0', 'status': old['status'],
        'readMe': old['readMe'] + ['family: the group of the /situation index (FAMILIES order). Labels of situations and families: src/lib/situationLabels.js, generated with this file by scripts/life-situations-build.py.',
                                   'Fiches are resolved in three sourced tiers: the public Rights Graph view, the Mon Parcours list sources, then the Rights Graph source ledger (data/rules/rights-graph-sources.v1.json, DILA archive read 2026-11-18; fiche titles and dates only — no D11 rule or condition).'],
        'emergencySource': 'F33954',
        'families': [f for f, _ in FAMILIES],
        'uncovered': UNCOVERED, 'dropped': DROPPED,
        'situations': [{k: v for k, v in s.items() if k != 'labels'} for s in S],
    }
    ids = [s['id'] for s in S]
    assert len(ids) == len(set(ids)), 'duplicate id'
    fams = {f for f, _ in FAMILIES}
    assert all(s['family'] in fams for s in S)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2); f.write('\n')
    # explicit label module
    js = ['// GENERATED by scripts/life-situations-build.py — do not edit by hand (edit the build script, then run it).',
          '/**', ' * G14-RG — the names of the « Ma situation » situations and families in the interface language: explicit keys, so scripts/i18n-check.mjs', ' * checks every language. @param {string} id @param {(key: string, fr: string) => string} t @returns {string}', ' */',
          'export function situationLabel(id, t) {', '  switch (id) {']
    q = lambda s: "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"
    for s in S: js.append(f"    case {q(s['id'])}: return t({q('situation:item.' + s['id'])}, {q(s['labels']['fr'])});")
    js += ['    default: return id;', '  }', '}', '', '/** @param {string} id @param {(key: string, fr: string) => string} t @returns {string} */', 'export function familyLabel(id, t) {', '  switch (id) {']
    for fid, fl in FAMILIES: js.append(f"    case {q(fid)}: return t({q('situation:family.' + fid)}, {q(fl['fr'])});")
    js += ['    default: return id;', '  }', '}', '']
    with open(os.path.join(ROOT, 'src/lib/situationLabels.js'), 'w', encoding='utf-8') as f: f.write('\n'.join(js))
    # locales
    for lang in LANGS[1:]:
        lp = os.path.join(ROOT, 'src/i18n/locales', lang, 'situation.json')
        d = json.load(open(lp, encoding='utf-8'))
        d = {k: v for k, v in d.items() if not k.startswith('item.') and not k.startswith('family.')}
        for s in S: d['item.' + s['id']] = s['labels'][lang]
        for fid, fl in FAMILIES: d['family.' + fid] = fl[lang]
        with open(lp, 'w', encoding='utf-8') as f: json.dump(dict(sorted(d.items())), f, ensure_ascii=False, indent=1); f.write('\n')
    by = {}
    for s in S: by[s['family']] = by.get(s['family'], 0) + 1
    print('situations', len(S), 'danger', sum(1 for s in S if s['danger']), by)

if __name__ == '__main__':
    main()
