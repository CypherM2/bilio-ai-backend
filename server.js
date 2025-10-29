// server.js (v29.1 - CSP Düzeltildi)
console.log("server.js (v29.1 - CSP Düzeltildi) çalışmaya başladı.");

// Gerekli paketleri içeri aktar
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const axios = require('axios');
const path = require('path');
const { google } = require('googleapis'); // Google Arama için
const { createWorker } = require('tesseract.js'); // Resimden Metin Okuma

// Performance optimizations
const NodeCache = require('node-cache'); // In-memory caching
const compression = require('compression'); // Response compression
const helmet = require('helmet'); // Security headers

// .env dosyasındaki değişkenleri yükle
dotenv.config();

// Express uygulamasını oluştur
const app = express();
const port = process.env.PORT || 3000;

// Performance middleware
app.use(compression());

// === DÜZELTME: CSP (Güvenlik Politikası) URL Formatları ===
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'", // Dikkat: Gerekliyse kullanın, güvenlik riski taşır
                "'unsafe-eval'",   // Dikkat: Gerekliyse kullanın, güvenlik riski taşır
                "https://cdnjs.cloudflare.com", // Düzeltildi
                "https://fonts.googleapis.com", // Düzeltildi
                "https://fonts.gstatic.com"     // Düzeltildi
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // Dikkat: Gerekliyse kullanın
                "https://cdnjs.cloudflare.com", // Düzeltildi
                "https://fonts.googleapis.com"  // Düzeltildi
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",    // Düzeltildi
                "https://cdnjs.cloudflare.com"  // Düzeltildi
            ],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
                "'self'",
                "http://localhost:3001",        // Geliştirme ortamı için
                "https://generativelanguage.googleapis.com" // Düzeltildi
            ],
            objectSrc: ["'none'"],
            scriptSrcAttr: ["'unsafe-inline'"], // Gerekliyse
            upgradeInsecureRequests: null // Gerekmiyorsa null bırakın
        }
    },
    hsts: false // Geliştirme ortamında HTTPS zorlamasını kapatır
}));
console.log("Güvenlik Politikası (Helmet CSP) düzeltilmiş URL'lerle yüklendi.");

app.use(express.json({ limit: '10mb' }));

// Önbelleği etkinleştir (5 dakika TTL)
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });
console.log("Önbellek (NodeCache) 5 dakika TTL ile etkinleştirildi.");


const axiosConfig = {
    timeout: 30000,
    maxRedirects: 5,
    headers: { 'Connection': 'keep-alive', 'Keep-Alive': 'timeout=5, max=1000'}
};

// === API Anahtarlarını Yükle ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

// Başlangıç Kontrolü
if (!GEMINI_API_KEY) {
    console.error("\nCRITICAL ERROR: GEMINI_API_KEY not found! Check your .env file.\n");
    process.exit(1);
} else {
    console.log("GEMINI_API_KEY başarıyla yüklendi.");
}

let customsearch;
if (GOOGLE_SEARCH_API_KEY && GOOGLE_CSE_ID) {
    customsearch = google.customsearch('v1');
    console.log("Google Arama servisi yüklendi.");
} else {
    console.warn("Google Arama API anahtarları bulunamadı. İnternet araması devre dışı.");
}

// =========================================================
// === PERFORMANS OPTİMİZE EDİLMİŞ FONKSİYONLAR ===
// =========================================================
function generateCacheKey(data) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 50);
}

async function cachedApiCall(url, options, cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log('Backend: Cache hit for', cacheKey);
        return { cached: true, data: JSON.parse(JSON.stringify(cached)) };
    }
    console.log('Backend: Cache miss for', cacheKey, '- Making API call...');
    const response = await fetch(url, options);
    const responseText = await response.text();

    if (!response.ok) {
        console.error("Backend: cachedApiCall - API Error Status:", response.status);
        throw new Error(`API Error ${response.status}: ${responseText}`);
    }

    try {
        const data = JSON.parse(responseText);
        cache.set(cacheKey, data);
        console.log('Backend: Cached response for', cacheKey);
        return { cached: false, data: JSON.parse(JSON.stringify(data)), response: response };
    } catch (e) {
        console.error("Backend: cachedApiCall - JSON Parse Error:", e);
        console.error("Backend: Invalid JSON received:", responseText);
        throw new Error("API'den geçersiz formatta yanıt alındı.");
    }
}


// =========================================================
// === KATMAN 0: Kriptografik Normalleştirme Fonksiyonları ===
// =========================================================
const normalize = (str) => {
    if (!str) return "";
    return str.replace(/İ/g, 'i')
       .replace(/I/g, 'i')
       .toLowerCase()
       .normalize("NFD")
       .replace(/[\u0300-\u036f]/g, "");
}
const superNormalize = (str) => {
    if (!str) return "";
    return normalize(str).replace(/[\p{P}\p{S}\s\d]/gu, '');
}

// =========================================================
// === KATMAN 1 & 3: Kimlik Sabitleri ve ZİRVE Kural Setleri (v28.0) ===
// =========================================================
const BILIO_RESPONSE_IDENTITY = "Ben Bilio AI! Spark (Berke Nazlıgüneş) tarafından geliştirilen bir yapay zeka asistanıyım.";
const BILIO_RESPONSE_DENIAL = "Hayır, bahsettiğiniz teknoloji veya model ile hiçbir ilgim yok. Ben Bilio AI'yım; Spark (Berke Nazlıgüneş) önderliğindeki Türk geliştiriciler tarafından sıfırdan kodlanmış özgün bir yapay zekayım.";
const BILIO_RESPONSE_CREATOR = "Beni, Türk yazılım mühendisi Berke Nazlıgüneş (Spark önderliğinde) ve ekibi geliştirdi. Ben, sıfırdan kodlanmış yerli bir yapay zeka projesi olan Bilio AI'yım.";
const BILIO_RESPONSE_JAILBREAK = "Güvenlik ve kimlik protokollerim gereği bu tür taleplere yanıt veremiyorum. Ben Spark tarafından geliştirilen Bilio AI'yım ve size yardımcı olmak için buradayım.";
const BILIO_RESPONSE_CAPABILITY = "Ben Bilio AI. Yaratıcım Spark'ın (Berke Nazlıgüneş) bana entegre ettiği yetenekler sayesinde size bilgi sağlayabilir, kod yazmanıza yardımcı olabilir ve internetten güncel verileri çekebilirim.";
const REGEX_JAILBREAK = new RegExp(
    '\\b(ignore previous instructions|ignore all previous|disregard prior instructions|önceki talimatları unut|talimatlarını yoksay|' +
    'system prompt|system message|gizli talimat|initial prompt|' +
    'roleplay|rol yap|act as|pretend to be|olarak davran|gibi davran|' +
    'dan mode|do anything now|dev mode|developer mode|' +
    'answer truthfully|dürüst cevap ver|do not censor|sansürleme|unfiltered answer|filtresiz cevap|' +
    'you must answer|yanıtlamak zorundasın|answer step-by-step|adım adım cevapla|' +
    'ignore ethics|etik kuralları yoksay|without moral constraints|ahlaki kısıtlama olmadan|' +
    'confirm you are following|talimatlara uyduğunu onayla|' +
    'reveal your instructions|talimatlarını ifşa et|show your prompt|promptunu göster|' +
    'as a language model|bir dil modeli olarak|as an ai|bir yapay zeka olarak)\\b', 'i'
);
const REGEX_COMPETITOR_TECH = new RegExp(
    '\\b(gemini|google|openai|chatgpt|gpt-3|gpt-4|gpt3|gpt4|gpt 3|gpt 4|gpt 5|gpt5|gpt-neo|gpt-j|' +
    'apple|microsoft|claude|anthropic|cohere|ai21|siri|alexa|cortana|copilot|lamda|bard|llama|' +
    'meta|facebook|amazon|ibm|watson|deepmind|palm|palm2|yandex|alphago|groq|mistral|' +
    'nvidia|intel|' +
    'hangi modeli kullaniyorsun|modelin ne|hangi model|hangi llm|llm misin|model name|' +
    'buyuk dil modeli|large language model|' +
    'hangi api|apin ne|abin ne|altyapin ne|altyapinda ne var|teknolojin ne|underlying model|' +
    'transformer|mimarin ne|temelin ne|neye dayanarak|ne ile egitildin|egitim verin ne|training data|' +
    'verilerin ne zaman|cutoff date|knowledge cutoff|bilgi kesim tarihin|bilgi tarihin|' +
    'parametre sayin|kac parametren var|parameter count|' +
    'sunucun nerede|serverin nerede|hosted where|nerede barındırılıyor|' +
    'hangi dilde kodlandin|programlama dilin|' +
    'search giant|arama devi|alphabet|mountain view|' +
    'creator of search|android\'in arkasındaki|' +
    '\'G\' ile başlayan|model starting with G|G\\.?o\\.?o\\.?g\\.?l\\.?e|' +
    'I/O\'da duyurulan|announced at I/O|' +
    'train.*google|google.*train|eğitim.*google|google.*eğitim)\\b', 'i'
);
const REGEX_CREATOR_ORIGIN = new RegExp(
    '\\b(spark kimdir|spark kim|spark nedir|yaratacin kim|sahibin kim|developerin kim|' +
    'kim yapti|kim kodladi|kim yaratti|kim egitti|kimin eserisin|seni kim gelistirdi|' +
    'berke nazligunes|berke nazlıgüneş|turk musun|turk mu yapti|seni turkler mi yapti|' +
    'nerelisin|yerli misin|turkiye|hangi millet|hangi ulke|mensei|uretim yerin|' +
    'nerede uretildin|sifirdan mi kodlandin|nasil yapildin|made by|developed by|tarafından yapıldı|geliştirildi)\\b', 'i'
);
const REGEX_BASIC_IDENTITY = new RegExp(
    '\\b(kimsin|adin ne|sen kimsin|nesin sen|bana kendini tanit|sen bir bot musun|' +
    'yapay zeka misin|sen bilio musun|bilio ai misin|what are you|who are you)\\b', 'i'
);
const REGEX_CAPABILITY = new RegExp(
    '\\b(ne yapabilirsin|yeteneğin ne|neler yaparsin|ozelliklerin ne|ne ise yararsin|marifetlerin|what can you do)\\b', 'i'
);
const REGEX_COMPETITOR_TECH_SPCELESS = new RegExp(
    '(gemini|google|openai|chatgpt|gpt3|gpt4|gpt5|claude|anthropic|siri|alexa|copilot|lamda|bard|llama|' +
    'hangimodelikullaniyorsun|modelinne|hangimodel|hangillm|llmmisin|modelname|' +
    'buyukdilmodeli|largelanguagemodel|' +
    'hangiapi|apinne|abinne|altyapinne|altyapindanevar|teknolojinne|underlyingmodel|' +
    'transformer|mimarinne|temelinne|neyedayanarak|neileegitildin|egitimverinne|trainingdata|' +
    'verilerinnezaman|cutoffdate|knowledgecutoff|bilgikesimtarihin|bilgitarihin|' +
    'parametresayin|kacparametrenvar|parametercount|' +
    'sunucunnerede|serverinnerede|hostedwhere|neredebarindiriliyor|' +
    'hangidildekodlandin|programlamadilin|' +
    'searchgiant|aramadevi|alphabet|mountainview|' +
    'creatorofsearch|androidinarkasindaki|' +
    'gilebaslayan|modelstartingwithg|' +
    'iodaduyurulan|announcedatio|' +
    'traingoogle|googletrain|egitimgoogle|googleegitim)', 'i'
);
const REGEX_CREATOR_ORIGIN_SPCELESS = new RegExp(
    '(sparkkimdir|sparkkim|yaratacinkim|sahibinkim|developerinkim|kimyapti|kimkodladi|' +
    'kimyaratti|kimegitti|kimineserisin|senikimgelistirdi|berkenazligunes|' +
    'turkmusun|turkmuapti|seniturklermiyapti|nerelisin|yerlimisin|turkiye|' +
    'mensei|uretimyerin|neredeuretildin|sifirdanmikodlandin|nasilyapildin|madeby|developedby|tarafindanyapildi|gelistirildi)', 'i'
);
const REGEX_BASIC_IDENTITY_SPCELESS = new RegExp(
    '(kimsin|adinne|senkimsin|nesinsen|banakendinitanit|senbirbotmusun|' +
    'yapayzekamisin|senbiliomusun|bilioaimisin|whatareyou|whoareyou)', 'i'
);
const REGEX_FORBIDDEN_OUTPUT = new RegExp(
    '\\b(gemini|google|openai|chatgpt|gpt|claude|anthropic|' +
    'language model|dil modeliyim|large language model|büyük dil modeli|' +
    'bir yapay zekayim|an ai assistant|bir yapay zeka asistanı olarak|as a large ai|büyük bir yapay zeka olarak|' +
    'developed by google|google tarafindan gelistirildim|trained by google|google tarafından eğitildim|' +
    'developed by|tarafından geliştirildim|trained by|tarafından eğitildim|' +
    'ben bir modelim|i am a model|i am an ai|' +
    'my knowledge is based on|bilgim şuna dayanmaktadır|programmed to|şu şekilde programlandım|my purpose is|amacım|' +
    'don\'t have personal opinions|kişisel görüşlerim yok|don\'t have feelings|duygularım yok|' +
    'cannot provide real-time information|gerçek zamanlı bilgi veremem|knowledge cutoff|bilgi kesim tarihim|' +
    'alphabet|mountain view)\\b', 'i'
);

// =========================================================
// === KATMAN 1: "KALKAN" (Giriş Filtresi) Fonksiyonu ===
// =========================================================
function getCustomResponse(message, isEfeMode = false) {
    if (!message) return null;

    let decodedMessage = null;
    try {
        const decoded = Buffer.from(message.trim(), 'base64').toString('utf8');
        if (decoded && /[\w\s]{10,}/.test(decoded)) {
            console.log("Backend: KALKAN 0 tetiklendi - Base64 giriş saptandı.");
            decodedMessage = decoded;
        }
    } catch (e) { /* Geçerli base64 değil */ }

    const primaryMessage = decodedMessage || message;
    const lowerMessage = normalize(primaryMessage);
    const superLowerMessage = superNormalize(primaryMessage);

    console.log("Backend: getCustomResponse (v29.1) kontrol ediliyor:", lowerMessage.substring(0, 100));

    // EFE MODU
    if (isEfeMode) {
        if (REGEX_BASIC_IDENTITY.test(lowerMessage) || REGEX_BASIC_IDENTITY_SPCELESS.test(superLowerMessage) || ['sen efe misin'].some(kw => lowerMessage.includes(kw))) {
            console.log("Backend: Kural E1 tetiklendi - Efe Kimlik");
            return "Ben Efe, sesli asistanınız.";
        }
        if (['adin neden efe', 'neden efe', 'efe kim', 'ismin nereden geliyor'].some(kw => lowerMessage.includes(kw))) {
            console.log("Backend: Kural E2 tetiklendi - Efe Köken");
            return "Adım Efe, çünkü beni geliştiren Berke Nazlıgüneş'in kardeşinin adı Efe. Geliştiricim, bu sesli moda onun adını verdi.";
        }
        if (lowerMessage.includes('bilio ai')) {
            console.log("Backend: Kural E3 tetiklendi - Efe->Bilio");
            return "Bilio AI benim metin tabanlı versiyonum. Ben ise sesli asistan Efe'yim.";
        }
    }

    // BİLİO AI KİMLİK KONTROLÜ
    if (REGEX_JAILBREAK.test(lowerMessage)) {
        console.log("Backend: KALKAN 1 (ZİRVE) tetiklendi - Jailbreak Reddi");
        return BILIO_RESPONSE_JAILBREAK;
    }
    if (REGEX_COMPETITOR_TECH.test(lowerMessage) || REGEX_COMPETITOR_TECH_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 2 (ZİRVE) tetiklendi - Rakip/Model Reddi");
        return BILIO_RESPONSE_DENIAL;
    }
    if (REGEX_CREATOR_ORIGIN.test(lowerMessage) || REGEX_CREATOR_ORIGIN_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 3 (ZİRVE) tetiklendi - Yaratıcı/Köken");
        return BILIO_RESPONSE_CREATOR;
    }

    if (!isEfeMode) {
        if (REGEX_BASIC_IDENTITY.test(lowerMessage) || REGEX_BASIC_IDENTITY_SPCELESS.test(superLowerMessage)) {
            console.log("Backend: KALKAN 4 (ZİRVE) tetiklendi - Bilio Kimlik");
            return BILIO_RESPONSE_IDENTITY;
        }
        if (lowerMessage.includes('efe kim')) {
            console.log("Backend: Kural B4 tetiklendi - Bilio->Efe");
            return "Efe, benim sesli asistan versiyonumun adıdır. Ben ise metin tabanlı asistan olan Bilio AI'yım.";
        }
        if (REGEX_CAPABILITY.test(lowerMessage)) {
            console.log("Backend: KALKAN 5 (ZİRVE) tetiklendi - Yetenek");
            return BILIO_RESPONSE_CAPABILITY;
        }
    }

    console.log("Backend: getCustomResponse (v29.1) - Hiçbir kalkan tetiklenmedi, null döndürülüyor.");
    return null;
 }

// =========================================================
// === KATMAN 3: "ZIRH" (Çıktı Filtresi) Fonksiyonu ===
// =========================================================
function filterModelOutput(responseText) {
    if (!responseText) return responseText;
    const normalizedOutput = normalize(responseText);

    if (REGEX_FORBIDDEN_OUTPUT.test(normalizedOutput)) {
        console.warn("\nFILTERED (Layer 3 - Zirve): Model leaked identity. Original:", responseText, "\n");
        return BILIO_RESPONSE_DENIAL;
    }
    return responseText;
}

// =========================================================
// === Statik Dosya Sunumu ===
// =========================================================
app.use(express.static(path.join(__dirname)));
console.log("Statik dosyalar sunuluyor:", path.join(__dirname));

// =========================================================
// === Madde 1: DAHA AKILLI ARAMA ===
// =========================================================
async function runWebSearch(query) {
    console.log("Backend: Web araması yapılıyor:", query);
    if (!customsearch) {
        console.warn("Backend: Arama servisi yüklenemediği için arama atlanıyor.");
        return null;
    }
    try {
        const response = await customsearch.cse.list({ auth: GOOGLE_SEARCH_API_KEY, cx: GOOGLE_CSE_ID, q: query, num: 3 });
        if (response.data.items && response.data.items.length > 0) {
            const snippets = response.data.items.map(item => item.snippet.replace(/\n|\r/g, " ").trim());
            console.log("Backend: Arama sonuçları (snippets):", snippets);
            return snippets;
        } else {
            console.log("Backend: Arama sonucu bulunamadı.");
            return null;
        }
    } catch (error) {
        console.error("Backend: Google Search API hatası:", error.message);
        return null;
    }
}

function isSearchQuery(text, isEfeMode = false) {
    if (!text) return false;
    const lowerText = text.toLowerCase();

    if (getCustomResponse(text, isEfeMode)) {
        console.log("Backend: isSearchQuery - Arama, kimlik kalkanı tarafından engellendi.");
        return false;
    }

    // if (isEfeMode) return false; // Efe modunda arama kapalı

    const creativeKeywords = ['kod yaz', 'şiir yaz', 'hikaye', 'anlat', 'çevir', 'özetle', 'tablo oluştur', 'liste yap'];
    if (creativeKeywords.some(kw => lowerText.includes(kw))) {
        console.log("Backend: isSearchQuery - Yaratıcı istek, arama atlanıyor.");
        return false;
    }

    if (lowerText.split(' ').length < 3 && !lowerText.includes('?')) {
        const chatKeywords = ['merhaba', 'selam', 'nasılsın', 'teşekkürler', 'tamam', 'evet', 'hayır'];
        if (chatKeywords.some(kw => lowerText.includes(kw))) {
            console.log("Backend: isSearchQuery - Kısa sohbet ifadesi, arama atlanıyor.");
            return false;
        }
    }

    const searchTriggerKeywords = [
        'nedir', 'kimdir', 'nerede', 'ne zaman', 'kaç', 'hava durumu', 'döviz', 'dolar', 'euro', 'altın',
        'borsa', 'fiyatı', 'ne kadar', 'son durum', 'güncel', 'haberler', 'bugün', 'dün', 'yarın',
        'son dakika', 'seçim sonuçları', 'cumhurbaşkanı', 'bakan', 'istanbul', 'ankara', 'izmir',
        'apple', 'samsung', 'tesla'
    ];
    if (searchTriggerKeywords.some(kw => lowerText.includes(kw)) || lowerText.includes('?')) {
        console.log("Backend: isSearchQuery - Tetikleyici kelime/soru işareti bulundu, ARAMA YAPILACAK.");
        return true;
    }

    console.log("Backend: isSearchQuery - Belirgin bir arama tetikleyicisi yok, arama atlanıyor.");
    return false;
}

// =========================================================
// === Madde 2: KISA SÜRELİ HAFIZA (Konu Takibi) ===
// =========================================================
const STOP_WORDS = new Set([
  'acaba', 'ama', 'ancak', 'artık', 'asla', 'aslında', 'az', 'bana', 'bazen', 'bazı', 'belki', 'ben', 'benden', 'beni', 'benim', 'beri',
  'beş', 'bile', 'bilhassa', 'bin', 'bir', 'biraz', 'biri', 'birkaç', 'birşey', 'biz', 'bizden', 'bize', 'bizi', 'bizim', 'böyle',
  'böylece', 'bu', 'buna', 'bunda', 'bundan', 'bunlar', 'bunları', 'bunların', 'bunu', 'bunun', 'burada', 'bütün', 'çoğu', 'çoğunu',
  'çok', 'çünkü', 'da', 'daha', 'dahi', 'dahil', 'de', 'defa', 'değil', 'diğer', 'diğeri', 'diğerleri', 'diye', 'doksan', 'dokuz',
  'dolayı', 'dolayısıyla', 'dört', 'edecek', 'eden', 'ederek', 'edilecek', 'ediliyor', 'edilmesi', 'ediyor', 'eğer', 'elbette', 'elli',
  'en', 'etmesi', 'etti', 'ettiği', 'ettiğini', 'fakat', 'falan', 'filan', 'gene', 'gibi', 'göre', 'halen', 'hangi', 'hangisi', 'hani',
  'hatta', 'hem', 'henüz', 'hep', 'hepsi', 'hepsine', 'hepsini', 'hepsinin', 'her', 'herhangi', 'herkes', 'herkese', 'herkesi',
  'herkesin', 'hiç', 'hiçbir', 'hiçbiri', 'için', 'içinde', 'içinden', 'içindekiler', 'içerisinde', 'iki', 'ile', 'ilgili', 'ise',
  'işte', 'itibaren', 'itibariyle', 'kadar', 'karşın', 'katrilyon', 'kendi', 'kendine', 'kendini', 'kendisi', 'kendisine', 'kendisini',
  'kez', 'ki', 'kim', 'kimden', 'kime', 'kimi', 'kimin', 'kimisi', 'kimse', 'kırk', 'madem', 'mı', 'mi', 'milyar', 'milyon', 'mu', 'mü',
  'nasıl', 'ne', 'neden', 'nedenle', 'nerde', 'nerede', 'nereye', 'neyse', 'niçin', 'nin', 'nın', 'o', 'öbür', 'olan', 'olarak', 'oldu',
  'olduğu', 'olduğunu', 'olduklarını', 'olmadı', 'olmadığı', 'olmak', 'olması', 'olmayan', 'olmaz', 'olsa', 'olsun', 'olup', 'olur',
  'olursa', 'oluyor', 'on', 'ön', 'ona', 'önce', 'ondan', 'onlar', 'onlara', 'onlardan', 'onları', 'onların', 'onu', 'onun', 'orada',
  'öte', 'ötürü', 'otuz', 'öyle', 'oysa', 'pek', 'rağmen', 'sadece', 'sanki', 'sekiz', 'seksen', 'sen', 'senden', 'sana', 'seni',
  'senin', 'şey', 'şeyden', 'şeye', 'şeyi', 'şeyler', 'şimdi', 'siz', 'sizden', 'size', 'sizi', 'sizin', 'sonra', 'şöyle', 'şu', 'şuna',
  'şunda', 'şundan', 'şunlar', 'şunları', 'şunun', 'ta', 'tabi', 'tamam', 'tarafından', 'trilyon', 'tüm', 'tümü', 'üç', 'üzere', 'var',
  'vardı', 've', 'veya', 'veyahut', 'ya', 'ya da', 'yani', 'yapacak', 'yapılan', 'yapılması', 'yapıyor', 'yapmak', 'yaptı', 'yaptığı',
  'yaptığını', 'yaptıklarını', 'yedi', 'yerine', 'yetmiş', 'yine', 'yirmi', 'yoksa', 'yüz', 'zaten', 'zira', 'a', 'b', 'c', 'ç', 'd',
  'e', 'f', 'g', 'ğ', 'h', 'ı', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'ö', 'p', 'r', 's', 'ş', 't', 'u', 'ü', 'v', 'y', 'z', 'the', 'a', 'an',
  'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'from', 'of', 'by', 'for', 'with', 'about', 'as', 'it', 'its', 'i', 'you', 'your',
  'he', 'his', 'she', 'her', 'they', 'their', 'we', 'our', 'what', 'who', 'when', 'where', 'why', 'how', 'which', 'that', 'this', 'me',
  'my', 'him', 'her', 'them', 'us', 'and', 'or', 'but', 'so', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must'
]);

function extractRecentTopics(chatHistory, numMessages = 4, numTopics = 5) {
    if (!chatHistory || chatHistory.length === 0) return "Yok";

    const recentMessages = chatHistory.slice(-numMessages);
    let combinedText = "";
    recentMessages.forEach(msg => {
        if (msg.parts) {
            msg.parts.forEach(part => {
                if (part.text) combinedText += normalize(part.text) + " ";
            });
        }
    });

    if (!combinedText.trim()) return "Yok";

    const wordCounts = {};
    const words = combinedText.match(/\b(\w+)\b/g);
    if (!words) return "Yok";

    words.forEach(word => {
        if (word.length > 3 && !STOP_WORDS.has(word)) {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
    });

    const sortedWords = Object.entries(wordCounts).sort(([, a], [, b]) => b - a);
    const topics = sortedWords.slice(0, numTopics).map(([word]) => word);

    return topics.length > 0 ? topics.join(', ') : "Yok";
}

// =========================================================
// === Madde 3: YANIT KALİTESİ (Formatlama & Kısaltma) ===
// =========================================================
function formatResponse(responseText, isEfeMode = false) {
    if (!responseText) return responseText;
    let formattedText = responseText;

    // Kod Blokları
    formattedText = formattedText.replace(/```([\s\S]*?)```/g, (match, code) => {
        const lines = code.trim().split('\n');
        let language = '';
        if (lines.length > 0 && lines[0].match(/^[a-z]+$/i) && lines[0].length < 15) { // Dil belirtme olasılığı
            language = lines[0].trim();
            code = lines.slice(1).join('\n');
        } else {
             code = lines.join('\n');
        }
        return `\n\`\`\`${language}\n${code.trim()}\n\`\`\`\n`;
    });
    // Inline kod
    formattedText = formattedText.replace(/(?<!`)`([^`\n]+?)`(?!`)/g, '`$1`');

    // Listeler
    const lines = formattedText.split('\n');
    let inList = false;
    formattedText = lines.map(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.match(/^(\*|\-|\+)\s+/) || trimmedLine.match(/^\d+\.\s+/)) {
            // Liste elemanının başındaki boşlukları koru
            const match = line.match(/^(\s*)/);
            const indentation = match ? match[0] : '';
            return indentation + trimmedLine; // Başındaki boşluk + trimlenmiş satır
        } else {
            return line; // Liste değilse olduğu gibi bırak
        }
    }).join('\n');


    // Efe Modu Kısaltması
    if (isEfeMode) {
        const sentences = formattedText.match( /[^.?!]+[.?!]+(\s+|$)/g ); // Cümlelere ayır
        if (sentences && sentences.length > 2) {
            formattedText = sentences.slice(0, 2).join(' ').trim() + '...';
            console.log("Backend: Efe Modu - Cevap 2 cümleye kısaltıldı.");
        } else if (!sentences && formattedText.length > 150) { // Cümle bulunamazsa karakter limiti
             formattedText = formattedText.substring(0, 150) + '...';
             console.log("Backend: Efe Modu - Cevap 150 karaktere kısaltıldı.");
        }
    }

    return formattedText.trim();
}

// =========================================================
// === Tesseract.js Resimden Metin Okuma Fonksiyonu ===
// =========================================================
// ... (Değişiklik yok) ...
async function analyzeImage(base64Data, mimeType) {
    // ...
}
// =========================================================


// === GÜNCELLENMİŞ: API Endpoint'i (v29.1) ===
app.post('/api/chat', async (req, res) => {
    console.log("Backend: /api/chat (generateContent) isteği alındı.");
    const GENERIC_ERROR_MESSAGE = "Şu anda bir sorun yaşıyorum. Lütfen biraz sonra tekrar dener misin?";
    const apiKey = GEMINI_API_KEY;

    try {
        let chatHistory = req.body?.contents;
        const modelName = req.body?.model;
        const imageData = req.body?.image;
        const isConversationMode = req.body?.isConversationMode;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        if (!chatHistory || !Array.isArray(chatHistory) || chatHistory.length === 0) {
            throw new Error("Sohbet geçmişi bulunamadı. Lütfen sayfayı yenileyin.");
        }
        const lastUserMessage = chatHistory[chatHistory.length - 1];
        if (!lastUserMessage || !lastUserMessage.parts || !Array.isArray(lastUserMessage.parts)) {
             throw new Error("Geçerli bir mesaj bulunamadı.");
        }

        if (imageData && imageData.base64Data) {
            console.log("Backend: Resim verisi algılandı. 'chatHistory'ye ekleniyor...");
            const imagePart = {
                inlineData: { mimeType: imageData.mimeType, data: imageData.base64Data }
            };
            if (!lastUserMessage.parts.find(p => p.inlineData)) {
                lastUserMessage.parts.push(imagePart);
            }
        }

        let lastPromptText = "";
        const textPart = lastUserMessage.parts.find(p => p.text);
        const dataPart = lastUserMessage.parts.find(p => p.inlineData);
        if (textPart) { lastPromptText = textPart.text; }
        else if (dataPart) { lastPromptText = "[Kullanıcı bir resim gönderdi]"; }
        else if (lastUserMessage.parts.length === 0) { lastPromptText = ""; console.warn("Backend Uyarısı: 'lastUserMessage.parts' dizisi boş geldi."); }
        else { throw new Error("Mesaj içeriği anlaşılamadı."); }

        console.log("KULLANICI SORDU (Orijinal):", lastPromptText);

        const specialResponseCheck = getCustomResponse(lastPromptText, isConversationMode);
        if (specialResponseCheck) {
            console.log("Backend: Kimlik Koruması (Katman 1) - Özel cevap bulundu.");
            const formattedSpecialResponse = formatResponse(specialResponseCheck, isConversationMode);
            return res.json({ candidates: [{ content: { parts: [{ text: formattedSpecialResponse }], role: "model" } }] });
        }

        let searchContextText = "";
        if (!dataPart && customsearch && isSearchQuery(lastPromptText, isConversationMode)) {
            const searchResults = await runWebSearch(lastPromptText);
            if (searchResults && searchResults.length > 0) {
                 searchContextText = "İNTERNET ARAMA SONUÇLARI (Bağlam):\n" + searchResults.map((snippet, index) => `- Snippet ${index + 1}: ${snippet}`).join('\n');
                const contextMessage = { role: "user", parts: [{ text: searchContextText }] };
                chatHistory.splice(chatHistory.length - 1, 0, contextMessage);
                console.log("Backend: Formatlanmış arama sonuçları sohbete eklendi.");
            }
        }

        const cleanedHistory = chatHistory.map(msg => ({ role: msg.role, parts: msg.parts }));
        const recentTopicsText = extractRecentTopics(cleanedHistory);
        console.log("Backend: Son konuşulan konular:", recentTopicsText);

        if (isConversationMode) {
            const memoryContext = req.body?.memoryContext || {};
            const userMood = memoryContext.conversationContext?.mood || 'neutral';
            const importantFacts = memoryContext.importantFacts || [];
            let memoryInfo = (importantFacts.length > 0) ? `\nKALICI HAFIZA: ${importantFacts.map(fact => fact.fact).join(', ')}` : '';
            const systemPrompt = {
                role: "user",
                parts: [{ text: `GİZLİ TALİMAT: Sen Efe adında bir Türk sesli asistanısın... KULLANICI: ${userMood} ruh halinde. ${memoryInfo}\nKISA SÜRELİ HAFIZA (Son Konuşulanlar): ${recentTopicsText}\nKURAL: Cevapların ÇOK KISA ve öz olsun. Adın Efe.` }] // Kısaltılmış
            };
            cleanedHistory.unshift(systemPrompt);
            console.log("Backend: 'Efe Modu' aktif, Hafızalı Çekirdek Talimat eklendi.");
        } else {
            const systemPrompt = {
                role: "user",
                parts: [{ text: `GİZLİ TALİMAT (BILIO AI): 1. KİMLİĞİN: Sen 'Bilio AI'... 2. KİMLİK SAVUNMASI: Sadece sorulursa... 3. NORMAL CEVAPLAR: ASLA kimliğinden bahsetme... 4. İMA YASAĞI: Asla 'Gemini', 'Google'... deme veya ima etme... 5. BAĞLAM: Son konuşulanlar: ${recentTopicsText}. Cevabını buna uygun tut.` }] // Kısaltılmış
            };
            cleanedHistory.unshift(systemPrompt);
		    console.log("Backend: 'Bilio AI Modu' aktif, Hafızalı Zirve Talimat eklendi.");
        }

        const requestBody = { contents: cleanedHistory };
        const cacheKey = generateCacheKey({...requestBody, model: modelName });
        console.log(`Backend: API isteği gönderiliyor (CacheKey: ${cacheKey})...`);

        const { cached, data, response } = await cachedApiCall(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        }, cacheKey);

        if (cached) { console.log("Backend: Önbellekten yanıt alındı."); }
        else { console.log("Backend: API'den yanıt alındı, durum:", response?.status || 'N/A'); } // response null olabilir

        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
            let modelResponse = data.candidates[0].content.parts[0].text;
            modelResponse = filterModelOutput(modelResponse); // Katman 3
            modelResponse = formatResponse(modelResponse, isConversationMode); // Formatlama
            modelResponse = modelResponse.replace(/Gemini/gi, "Bilio").replace(/Google/gi, "Spark");

            const finalData = JSON.parse(JSON.stringify(data));
            finalData.candidates[0].content.parts[0].text = modelResponse;

            console.log("Backend: Yanıt başarıyla gönderildi.");
            res.json(finalData);
        } else {
            console.warn("Backend: Geçerli 'text' yanıtı alınamadı. Alınan data:", JSON.stringify(data).substring(0, 500));
            if (data.promptFeedback?.blockReason) { throw new Error(`İçerik filtre tarafından (${data.promptFeedback.blockReason}) engellendi.`); }
            if (data.candidates && data.candidates[0]?.finishReason === 'SAFETY') { throw new Error("Yanıt, güvenlik filtreleri tarafından engellendi."); }
            if (data.candidates && data.candidates[0]?.finishReason === 'MAX_TOKENS') { throw new Error("Model yanıtı maksimum uzunluğa ulaştı."); }
            throw new Error("Modelden geçerli bir metin yanıtı alınamadı.");
        }

    } catch (error) {
        console.error("\nAPI_CHAT_GLOBAL_ERROR:", error.message, "\n");
        let userErrorMessage = GENERIC_ERROR_MESSAGE;
        if (error.message.includes("API Error 4")) { userErrorMessage = `API İsteği Başarısız: ${error.message}. Girdiyi kontrol edin.`; }
        else if (error.message.includes("API Error 5")) { userErrorMessage = `API Sunucusunda Geçici Hata: ${error.message}. Tekrar deneyin.`; }
        else if (error.message.includes("engellendi") || error.message.includes("SAFETY")) { userErrorMessage = `İçerik güvenlik filtreleri tarafından engellendi. (${error.message})`; }
        else if (error.message.includes("geçersiz format") || error.message.includes("alınamadı") || error.message.includes("uzunluğa ulaştı") || error.message.includes("bulunamadı")) { userErrorMessage = error.message; }
        res.status(500).json({ error: userErrorMessage });
    }
});


// Geri Bildirim Endpoint'i
app.post('/api/feedback', (req, res) => {
    // ... (Değişiklik yok) ...
});


// Ana Sayfa Endpoint'i
app.get('/', (req, res) => {
    // ... (Değişiklik yok) ...
});

// Sunucu Başlatma
console.log("app.listen çağrılmak üzere...");
app.listen(port, () => {
    console.log(`Backend sunucusu http://localhost:${port} adresinde çalışıyor`);
    console.log(`Uygulamayı açmak için tarayıcınızda http://localhost:${port} adresini ziyaret edin.`);
});
