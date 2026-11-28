// Languages for the AI voice, and OUR fixed money sentences in each of them (typed table, so a missing
// sentence is a compile error and a test failure). Only the English wording was written by the team; every
// other language was MACHINE-TRANSLATED and has not been checked by a native speaker (README, DISCLOSURES).
// Amounts come from the server quote as integer minor units and are written with Intl, never as floats.

export type LangCode = "en" | "fr" | "es" | "pt" | "ar" | "hi" | "yo" | "ha";
export interface Lang {
  code: LangCode;
  /** Shown in the picker, in the language itself. */
  label: string;
  /** English name, for the system instruction. */
  name: string;
  /** speechConfig.languageCode (BCP-47). */
  bcp47: string;
  /** Intl locale (Latin digits forced). */
  locale: string;
  /** Word for naira in that language. */
  naira: string;
  experimental?: boolean;
}

export const LANGS: Lang[] = [
  { code: "en", label: "English", name: "English", bcp47: "en-US", locale: "en-NG", naira: "naira" },
  { code: "fr", label: "Français", name: "French", bcp47: "fr-FR", locale: "fr-FR-u-nu-latn", naira: "nairas" },
  { code: "es", label: "Español", name: "Spanish", bcp47: "es-US", locale: "es-ES-u-nu-latn", naira: "nairas" },
  { code: "pt", label: "Português", name: "Portuguese", bcp47: "pt-BR", locale: "pt-BR-u-nu-latn", naira: "nairas" },
  { code: "ar", label: "العربية", name: "Arabic", bcp47: "ar-XA", locale: "ar-u-nu-latn", naira: "نيرة" },
  { code: "hi", label: "हिन्दी", name: "Hindi", bcp47: "hi-IN", locale: "hi-IN-u-nu-latn", naira: "नाइरा" },
  { code: "yo", label: "Yorùbá", name: "Yoruba", bcp47: "yo-NG", locale: "yo-NG-u-nu-latn", naira: "naira" },
  { code: "ha", label: "Hausa", name: "Hausa", bcp47: "ha-NG", locale: "ha-NG-u-nu-latn", naira: "naira" },
];
export const DEFAULT_LANG: LangCode = "en";
export const LANG_STORAGE_KEY = "payalone_lang";

export const langByCode = (c: string): Lang => LANGS.find((l) => l.code === c) ?? LANGS[0];

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export function readLang(s?: Pick<Store, "getItem">): LangCode {
  try {
    const v = s?.getItem(LANG_STORAGE_KEY) ?? "";
    return LANGS.some((l) => l.code === v) ? (v as LangCode) : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}
export function writeLang(s: Pick<Store, "setItem"> | undefined, c: LangCode): void {
  try {
    s?.setItem(LANG_STORAGE_KEY, c);
  } catch {
    /* not remembered: the choice still applies to this visit */
  }
}

/** "300000" (kobo) -> "3,000 naira". Whole part through Intl as a BigInt (exact), kobo only when not zero. */
export function amountSpoken(minor: string, code: LangCode): string {
  const l = langByCode(code);
  const m = BigInt(minor);
  const whole = m / BigInt(100);
  const kobo = Number(m % BigInt(100));
  const nf = new Intl.NumberFormat(l.locale, { useGrouping: true });
  let text = nf.format(whole);
  if (kobo !== 0) {
    const dec = nf.formatToParts(1.1).find((p) => p.type === "decimal")?.value ?? ".";
    text += dec + String(kobo).padStart(2, "0");
  }
  return `${text} ${l.naira}`;
}

export interface Strings {
  /** First visit: the model greets with this meaning (it is in the system instruction). */
  greetFirst: string;
  greetBack: string;
  readBack(p: { amount: string; name: string }): string;
  approveFingerprint: string;
  pressKeyFingerprint: string;
  typePin: string;
  digits(n: number): string;
  cancelled: string;
  receipt(p: { amount: string; name: string }): string;
  requestPrompt(p: { shop: string; amount: string; ref: string }): string;
  setupIntro: string;
  setupConfirm: string;
  setupMismatch: string;
  setupPasskey: string;
  setupSkipped: string;
  pressKeyAdd: string;
  weakPin: string;
  setupDone: string;
  needNumbers: string;
  genericError: string;
}

const en: Strings = {
  greetFirst: "Hello, welcome to Pay Alone. What would you like to do today? You can send money, check your receipts, or ask me anything.",
  greetBack: "Welcome back to Pay Alone. What would you like to do?",
  readBack: ({ amount, name }) => `You are paying ${name} ${amount}. Fees are included.`,
  approveFingerprint: "To approve, use your fingerprint or Windows Hello now. Or say cancel.",
  pressKeyFingerprint: "Press any key to approve with your fingerprint.",
  typePin: "Type your 4 digit PIN on the keypad, then press Enter. I will not listen while you type.",
  digits: (n) => (n === 0 ? "no digits" : n === 1 ? "1 digit" : `${n} digits`),
  cancelled: "Cancelled. Nothing was sent.",
  receipt: ({ amount, name }) => `Done. You paid ${name} ${amount}.`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} is asking for ${amount}, reference ${ref}. Say yes to check it, or no to decline.`,
  setupIntro: "Before your first payment, let's set up. Type a 4 digit PIN you will remember, then press Enter.",
  setupConfirm: "Type it again to confirm.",
  setupMismatch: "The two PINs were different. Let's try again. Type a 4 digit PIN, then press Enter.",
  setupPasskey: "Now let's add your fingerprint or Windows Hello, so you can approve without typing. Say skip to do this later.",
  setupSkipped: "Okay, skipped. You can add it later.",
  pressKeyAdd: "Press any key to add your fingerprint.",
  weakPin: "That PIN is too easy to guess. Type a different 4 digit PIN, then press Enter.",
  setupDone: "You're set. Your weekly limit is set on your wallet's own page when you connect it.",
  needNumbers: "Please say the amount in numbers.",
  genericError: "Something went wrong. Nothing was sent.",
};

const fr: Strings = {
  greetFirst: "Bonjour, bienvenue sur Pay Alone. Que souhaitez-vous faire aujourd'hui ? Vous pouvez envoyer de l'argent, consulter vos reçus ou me poser une question.",
  greetBack: "Bon retour sur Pay Alone. Que souhaitez-vous faire ?",
  readBack: ({ amount, name }) => `Vous payez ${name} ${amount}. Les frais sont inclus.`,
  approveFingerprint: "Pour approuver, utilisez maintenant votre empreinte digitale ou Windows Hello. Ou dites annuler.",
  pressKeyFingerprint: "Appuyez sur une touche pour approuver avec votre empreinte digitale.",
  typePin: "Tapez votre code PIN à 4 chiffres sur le clavier, puis appuyez sur Entrée. Je n'écoute pas pendant que vous tapez.",
  digits: (n) => (n === 0 ? "aucun chiffre" : n === 1 ? "1 chiffre" : `${n} chiffres`),
  cancelled: "Annulé. Rien n'a été envoyé.",
  receipt: ({ amount, name }) => `C'est fait. Vous avez payé ${name} ${amount}.`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} demande ${amount}, référence ${ref}. Dites oui pour vérifier, ou non pour refuser.`,
  setupIntro: "Avant votre premier paiement, configurons l'application. Tapez un code PIN à 4 chiffres dont vous vous souviendrez, puis appuyez sur Entrée.",
  setupConfirm: "Tapez-le encore une fois pour confirmer.",
  setupMismatch: "Les deux codes étaient différents. Recommençons. Tapez un code PIN à 4 chiffres, puis appuyez sur Entrée.",
  setupPasskey: "Ajoutons maintenant votre empreinte digitale ou Windows Hello, pour approuver sans taper. Dites passer pour le faire plus tard.",
  setupSkipped: "D'accord, c'est ignoré. Vous pourrez l'ajouter plus tard.",
  pressKeyAdd: "Appuyez sur une touche pour ajouter votre empreinte digitale.",
  weakPin: "Ce code PIN est trop facile à deviner. Tapez un autre code PIN à 4 chiffres, puis appuyez sur Entrée.",
  setupDone: "Tout est prêt. Votre limite hebdomadaire se règle sur la page de votre portefeuille, quand vous le connectez.",
  needNumbers: "Veuillez dire le montant en chiffres.",
  genericError: "Un problème est survenu. Rien n'a été envoyé.",
};

const es: Strings = {
  greetFirst: "Hola, bienvenido a Pay Alone. ¿Qué le gustaría hacer hoy? Puede enviar dinero, revisar sus recibos o preguntarme lo que quiera.",
  greetBack: "Bienvenido de nuevo a Pay Alone. ¿Qué le gustaría hacer?",
  readBack: ({ amount, name }) => `Va a pagar ${amount} a ${name}. Las comisiones están incluidas.`,
  approveFingerprint: "Para aprobar, use ahora su huella digital o Windows Hello. O diga cancelar.",
  pressKeyFingerprint: "Pulse cualquier tecla para aprobar con su huella digital.",
  typePin: "Escriba su PIN de 4 dígitos en el teclado y pulse Intro. No escucho mientras escribe.",
  digits: (n) => (n === 0 ? "ningún dígito" : n === 1 ? "1 dígito" : `${n} dígitos`),
  cancelled: "Cancelado. No se envió nada.",
  receipt: ({ amount, name }) => `Listo. Pagó ${amount} a ${name}.`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} solicita ${amount}, referencia ${ref}. Diga sí para revisarlo, o no para rechazarlo.`,
  setupIntro: "Antes de su primer pago, vamos a configurar la aplicación. Escriba un PIN de 4 dígitos que recuerde y pulse Intro.",
  setupConfirm: "Escríbalo otra vez para confirmar.",
  setupMismatch: "Los dos PIN eran distintos. Intentémoslo de nuevo. Escriba un PIN de 4 dígitos y pulse Intro.",
  setupPasskey: "Ahora añadamos su huella digital o Windows Hello, para aprobar sin escribir. Diga omitir para hacerlo más tarde.",
  setupSkipped: "De acuerdo, omitido. Puede añadirlo más tarde.",
  pressKeyAdd: "Pulse cualquier tecla para añadir su huella digital.",
  weakPin: "Ese PIN es demasiado fácil de adivinar. Escriba otro PIN de 4 dígitos y pulse Intro.",
  setupDone: "Todo listo. Su límite semanal se fija en la página de su billetera cuando la conecta.",
  needNumbers: "Por favor, diga la cantidad en números.",
  genericError: "Algo salió mal. No se envió nada.",
};

const pt: Strings = {
  greetFirst: "Olá, bem-vindo ao Pay Alone. O que você gostaria de fazer hoje? Você pode enviar dinheiro, ver seus recibos ou me perguntar qualquer coisa.",
  greetBack: "Bem-vindo de volta ao Pay Alone. O que você gostaria de fazer?",
  readBack: ({ amount, name }) => `Você vai pagar ${amount} a ${name}. As taxas estão incluídas.`,
  approveFingerprint: "Para aprovar, use agora sua impressão digital ou o Windows Hello. Ou diga cancelar.",
  pressKeyFingerprint: "Pressione qualquer tecla para aprovar com sua impressão digital.",
  typePin: "Digite seu PIN de 4 dígitos no teclado e pressione Enter. Eu não escuto enquanto você digita.",
  digits: (n) => (n === 0 ? "nenhum dígito" : n === 1 ? "1 dígito" : `${n} dígitos`),
  cancelled: "Cancelado. Nada foi enviado.",
  receipt: ({ amount, name }) => `Pronto. Você pagou ${amount} a ${name}.`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} está pedindo ${amount}, referência ${ref}. Diga sim para conferir, ou não para recusar.`,
  setupIntro: "Antes do seu primeiro pagamento, vamos configurar. Digite um PIN de 4 dígitos que você vá lembrar e pressione Enter.",
  setupConfirm: "Digite de novo para confirmar.",
  setupMismatch: "Os dois PINs eram diferentes. Vamos tentar de novo. Digite um PIN de 4 dígitos e pressione Enter.",
  setupPasskey: "Agora vamos adicionar sua impressão digital ou o Windows Hello, para aprovar sem digitar. Diga pular para fazer depois.",
  setupSkipped: "Certo, pulado. Você pode adicionar depois.",
  pressKeyAdd: "Pressione qualquer tecla para adicionar sua impressão digital.",
  weakPin: "Esse PIN é fácil demais de adivinhar. Digite outro PIN de 4 dígitos e pressione Enter.",
  setupDone: "Tudo pronto. Seu limite semanal é definido na página da sua carteira quando você a conecta.",
  needNumbers: "Por favor, diga o valor em números.",
  genericError: "Algo deu errado. Nada foi enviado.",
};

const ar: Strings = {
  greetFirst: "مرحباً بك في Pay Alone. ماذا تريد أن تفعل اليوم؟ يمكنك إرسال المال، أو مراجعة إيصالاتك، أو أن تسألني أي شيء.",
  greetBack: "أهلاً بعودتك إلى Pay Alone. ماذا تريد أن تفعل؟",
  readBack: ({ amount, name }) => `أنت تدفع ${amount} إلى ${name}. الرسوم مشمولة.`,
  approveFingerprint: "للموافقة، استخدم بصمتك أو Windows Hello الآن. أو قل إلغاء.",
  pressKeyFingerprint: "اضغط أي مفتاح للموافقة ببصمتك.",
  typePin: "اكتب رمز PIN المكوّن من 4 أرقام على لوحة المفاتيح، ثم اضغط Enter. لن أستمع أثناء الكتابة.",
  digits: (n) => (n === 0 ? "لا أرقام" : n === 1 ? "رقم واحد" : `${n} أرقام`),
  cancelled: "تم الإلغاء. لم يُرسل شيء.",
  receipt: ({ amount, name }) => `تم. لقد دفعت ${amount} إلى ${name}.`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} يطلب ${amount}، المرجع ${ref}. قل نعم للمراجعة، أو لا للرفض.`,
  setupIntro: "قبل أول دفعة، لنقم بالإعداد. اكتب رمز PIN من 4 أرقام تتذكره، ثم اضغط Enter.",
  setupConfirm: "اكتبه مرة أخرى للتأكيد.",
  setupMismatch: "الرمزان مختلفان. لنحاول مرة أخرى. اكتب رمز PIN من 4 أرقام، ثم اضغط Enter.",
  setupPasskey: "الآن لنضف بصمتك أو Windows Hello، لتوافق دون كتابة. قل تخطي للقيام بذلك لاحقاً.",
  setupSkipped: "حسناً، تم التخطي. يمكنك إضافتها لاحقاً.",
  pressKeyAdd: "اضغط أي مفتاح لإضافة بصمتك.",
  weakPin: "هذا الرمز سهل التخمين. اكتب رمز PIN آخر من 4 أرقام، ثم اضغط Enter.",
  setupDone: "أنت جاهز. يُحدَّد حدّك الأسبوعي في صفحة محفظتك عند ربطها.",
  needNumbers: "من فضلك قل المبلغ بالأرقام.",
  genericError: "حدث خطأ. لم يُرسل شيء.",
};

const hi: Strings = {
  greetFirst: "नमस्ते, Pay Alone में आपका स्वागत है। आज आप क्या करना चाहेंगे? आप पैसे भेज सकते हैं, अपनी रसीदें देख सकते हैं, या मुझसे कुछ भी पूछ सकते हैं।",
  greetBack: "Pay Alone में आपका फिर से स्वागत है। आप क्या करना चाहेंगे?",
  readBack: ({ amount, name }) => `आप ${name} को ${amount} का भुगतान कर रहे हैं। शुल्क शामिल है।`,
  approveFingerprint: "मंज़ूरी के लिए अभी अपनी फ़िंगरप्रिंट या Windows Hello का उपयोग करें। या रद्द करें बोलें।",
  pressKeyFingerprint: "अपनी फ़िंगरप्रिंट से मंज़ूरी देने के लिए कोई भी कुंजी दबाएँ।",
  typePin: "कीपैड पर अपना 4 अंकों का PIN टाइप करें, फिर Enter दबाएँ। टाइप करते समय मैं नहीं सुनूँगा।",
  digits: (n) => (n === 0 ? "कोई अंक नहीं" : `${n} अंक`),
  cancelled: "रद्द किया गया। कुछ भी नहीं भेजा गया।",
  receipt: ({ amount, name }) => `हो गया। आपने ${name} को ${amount} का भुगतान किया।`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} ${amount} माँग रहा है, संदर्भ ${ref}। जाँचने के लिए हाँ बोलें, या मना करने के लिए नहीं।`,
  setupIntro: "आपके पहले भुगतान से पहले, चलिए सेटअप करें। 4 अंकों का एक PIN टाइप करें जो आपको याद रहे, फिर Enter दबाएँ।",
  setupConfirm: "पुष्टि के लिए इसे फिर से टाइप करें।",
  setupMismatch: "दोनों PIN अलग थे। फिर से कोशिश करते हैं। 4 अंकों का PIN टाइप करें, फिर Enter दबाएँ।",
  setupPasskey: "अब अपनी फ़िंगरप्रिंट या Windows Hello जोड़ें, ताकि आप बिना टाइप किए मंज़ूरी दे सकें। बाद में करने के लिए छोड़ें बोलें।",
  setupSkipped: "ठीक है, छोड़ दिया। आप इसे बाद में जोड़ सकते हैं।",
  pressKeyAdd: "अपनी फ़िंगरप्रिंट जोड़ने के लिए कोई भी कुंजी दबाएँ।",
  weakPin: "यह PIN अनुमान लगाने में बहुत आसान है। 4 अंकों का कोई और PIN टाइप करें, फिर Enter दबाएँ।",
  setupDone: "आप तैयार हैं। आपकी साप्ताहिक सीमा आपके वॉलेट के अपने पेज पर तय होती है, जब आप उसे जोड़ते हैं।",
  needNumbers: "कृपया राशि अंकों में बोलें।",
  genericError: "कुछ गड़बड़ हो गई। कुछ भी नहीं भेजा गया।",
};

const yo: Strings = {
  greetFirst: "Ẹ kú àbọ̀ sí Pay Alone. Kí ni ẹ fẹ́ ṣe lónìí? Ẹ lè fi owó ránṣẹ́, ẹ lè wo àwọn ìwé ẹ̀rí owó yín, tàbí ẹ lè béèrè ohunkóhun lọ́wọ́ mi.",
  greetBack: "Ẹ kú àbọ̀ padà sí Pay Alone. Kí ni ẹ fẹ́ ṣe?",
  readBack: ({ amount, name }) => `Ẹ ń san ${amount} fún ${name}. Owó iṣẹ́ wà nínú rẹ̀.`,
  approveFingerprint: "Láti fọwọ́ sí i, ẹ lo ìka ọwọ́ yín tàbí Windows Hello báyìí. Tàbí ẹ sọ pé fagilé.",
  pressKeyFingerprint: "Ẹ tẹ bọ́tìnnì kankan láti fọwọ́ sí i pẹ̀lú ìka ọwọ́ yín.",
  typePin: "Ẹ tẹ PIN oní nọ́ńbà mẹ́rin yín lórí pádì, lẹ́yìn náà ẹ tẹ Enter. Mi ò ní gbọ́ nígbà tí ẹ bá ń tẹ̀.",
  digits: (n) => (n === 0 ? "kò sí nọ́ńbà" : `nọ́ńbà ${n}`),
  cancelled: "A ti fagilé e. A kò fi nǹkan kan ránṣẹ́.",
  receipt: ({ amount, name }) => `Ó ti parí. Ẹ san ${amount} fún ${name}.`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} ń béèrè ${amount}, nọ́ńbà ìtọ́kasí ${ref}. Ẹ sọ bẹ́ẹ̀ni láti yẹ̀ ẹ́ wò, tàbí rárá láti kọ̀.`,
  setupIntro: "Kí ẹ tó san owó àkọ́kọ́, ẹ jẹ́ ká ṣètò. Ẹ tẹ PIN oní nọ́ńbà mẹ́rin tí ẹ máa rántí, lẹ́yìn náà ẹ tẹ Enter.",
  setupConfirm: "Ẹ tún tẹ̀ ẹ́ lẹ́ẹ̀kan sí i láti jẹ́rìí sí i.",
  setupMismatch: "PIN méjèèjì yàtọ̀. Ẹ jẹ́ ká tún gbìyànjú. Ẹ tẹ PIN oní nọ́ńbà mẹ́rin, lẹ́yìn náà ẹ tẹ Enter.",
  setupPasskey: "Ní báyìí, ẹ jẹ́ ká fi ìka ọwọ́ yín tàbí Windows Hello kún un, kí ẹ lè fọwọ́ sí i láì tẹ̀. Ẹ sọ pé fò kọjá láti ṣe é lẹ́yìn.",
  setupSkipped: "Ó dára, a ti fò ó kọjá. Ẹ lè fi kún un lẹ́yìn.",
  pressKeyAdd: "Ẹ tẹ bọ́tìnnì kankan láti fi ìka ọwọ́ yín kún un.",
  weakPin: "PIN yẹn rọrùn jù láti ṣe àfidámọ̀. Ẹ tẹ PIN oní nọ́ńbà mẹ́rin mìíràn, lẹ́yìn náà ẹ tẹ Enter.",
  setupDone: "Ẹ ti ṣetán. A ṣètò ààlà ọ̀sẹ̀ yín lórí ojú-ewé àpamọ́wọ́ yín nígbà tí ẹ bá so ó pọ̀.",
  needNumbers: "Ẹ jọ̀wọ́, ẹ sọ iye owó náà ní nọ́ńbà.",
  genericError: "Nǹkan kan ṣẹlẹ̀. A kò fi nǹkan kan ránṣẹ́.",
};

const ha: Strings = {
  greetFirst: "Barka da zuwa Pay Alone. Me kuke so ku yi a yau? Kuna iya aika kuɗi, duba rasitocinku, ko ku tambaye ni komai.",
  greetBack: "Barka da dawowa Pay Alone. Me kuke so ku yi?",
  readBack: ({ amount, name }) => `Kuna biyan ${name} ${amount}. An haɗa da kuɗin sabis.`,
  approveFingerprint: "Don amincewa, ku yi amfani da yatsanku ko Windows Hello yanzu. Ko ku ce soke.",
  pressKeyFingerprint: "Ku danna kowane maɓalli don amincewa da yatsanku.",
  typePin: "Ku rubuta PIN ɗinku mai lambobi huɗu a kan allon maɓalli, sannan ku danna Enter. Ba zan saurara ba yayin da kuke rubutu.",
  digits: (n) => (n === 0 ? "babu lamba" : `lambobi ${n}`),
  cancelled: "An soke. Ba a aika komai ba.",
  receipt: ({ amount, name }) => `An gama. Kun biya ${name} ${amount}.`,
  requestPrompt: ({ shop, amount, ref }) => `${shop} yana neman ${amount}, lambar tunani ${ref}. Ku ce eh don dubawa, ko a'a don ƙi.`,
  setupIntro: "Kafin biyan ku na farko, bari mu tsara. Ku rubuta PIN mai lambobi huɗu da za ku tuna, sannan ku danna Enter.",
  setupConfirm: "Ku sake rubuta shi don tabbatarwa.",
  setupMismatch: "PIN ɗin biyu sun bambanta. Mu sake gwadawa. Ku rubuta PIN mai lambobi huɗu, sannan ku danna Enter.",
  setupPasskey: "Yanzu bari mu ƙara yatsanku ko Windows Hello, don ku amince ba tare da rubutu ba. Ku ce tsallake don yin hakan daga baya.",
  setupSkipped: "To, an tsallake. Kuna iya ƙara shi daga baya.",
  pressKeyAdd: "Ku danna kowane maɓalli don ƙara yatsanku.",
  weakPin: "Wannan PIN yana da sauƙin tsammani. Ku rubuta wani PIN mai lambobi huɗu, sannan ku danna Enter.",
  setupDone: "Kun shirya. Ana saita iyakar mako-mako a shafin walat ɗinku lokacin da kuka haɗa shi.",
  needNumbers: "Don Allah ku faɗi adadin da lambobi.",
  genericError: "Wani abu ya faru. Ba a aika komai ba.",
};

export const STRINGS: Record<LangCode, Strings> = { en, fr, es, pt, ar, hi, yo, ha };
export const stringsFor = (c: LangCode): Strings => STRINGS[c] ?? STRINGS.en;
