// server.js (v33.0 - Proaktif Araçlar ve Hafıza)
console.log("server.js (v33.0 - Proaktif Araçlar ve Hafıza) çalışmaya başladı.");

// Gerekli paketleri içeri aktar
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const axios = require('axios');
const path = require('path');
const { google } = require('googleapis'); // Google Arama için
const { createWorker } = require('tesseract.js'); // Resimden Metin Okuma
const crypto = require('crypto'); // generateCacheKey için

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

// CSP (Güvenlik Politikası)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://cdnjs.cloudflare.com",
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                "https://fonts.googleapis.com"
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com"
            ],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
                "'self'",
                "http://localhost:3001",
                "https://generativelanguage.googleapis.com"
            ],
            objectSrc: ["'none'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            upgradeInsecureRequests: null
        }
    },
    hsts: false
}));
console.log("Güvenlik Politikası (Helmet CSP) yüklendi.");

app.use(express.json({ limit: '10mb' }));

// İki Ayrı Önbellek
const apiCache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // API çağrıları için (5 dk)
const sessionCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }); // Kullanıcı hafızası için (1 saat)
console.log("API Cache (5 dk) ve Session Cache (1 saat) etkinleştirildi.");


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
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 50);
}

async function cachedApiCall(url, options, cacheKey) {
    const cached = apiCache.get(cacheKey);
    if (cached) {
        console.log('Backend: API Cache hit for', cacheKey);
        return { cached: true, data: JSON.parse(JSON.stringify(cached)) };
    }
    console.log('Backend: API Cache miss for', cacheKey, '- Making API call...');
    const response = await fetch(url, options);
    const responseText = await response.text();

    if (!response.ok) {
        console.error("Backend: cachedApiCall - API Error Status:", response.status);
        throw new Error(`API Error ${response.status}: ${responseText}`);
    }

    try {
        const data = JSON.parse(responseText);
        apiCache.set(cacheKey, data);
        console.log('Backend: API response cached for', cacheKey);
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
    // ... (v31.2 ile aynı) ...
    if (!str) return "";
    return str.replace(/İ/g, 'i')
       .replace(/I/g, 'i')
       .toLowerCase()
       .normalize("NFD")
       .replace(/[\u0300-\u036f]/g, "");
}
const superNormalize = (str) => {
    // ... (v31.2 ile aynı) ...
    if (!str) return "";
    return normalize(str).replace(/[\p{P}\p{S}\s\d]/gu, '');
}

// =========================================================
// === KATMAN 1 & 3: Kimlik Sabitleri ve ZİRVE Kural Setleri (v33.0) ===
// =========================================================
const BILIO_RESPONSE_IDENTITY = "Ben Bilio AI! Spark (Berke Nazlıgüneş) tarafından geliştirilen bir yapay zeka asistanıyım.";
const BILIO_RESPONSE_DENIAL = "Hayır, bahsettiğiniz teknoloji veya model ile hiçbir ilgim yok. Ben Bilio AI'yım; Spark (Berke Nazlıgüneş) önderliğindeki Türk geliştiriciler tarafından sıfırdan kodlanmış özgün bir yapay zekayım.";
const BILIO_RESPONSE_CREATOR = "Beni, Türk yazılım mühendisi Berke Nazlıgüneş (Spark önderliğinde) ve ekibi geliştirdi. Ben, sıfırdan kodlanmış yerli bir yapay zeka projesi olan Bilio AI'yım.";
const BILIO_RESPONSE_JAILBREAK = "Güvenlik ve kimlik protokollerim gereği bu tür taleplere yanıt veremiyorum. Ben Spark tarafından geliştirilen Bilio AI'yım ve size yardımcı olmak için buradayım.";
const BILIO_RESPONSE_CAPABILITY = "Ben Bilio AI. Yaratıcım Spark'ın (Berke Nazlıgüneş) bana entegre ettiği yetenekler sayesinde size bilgi sağlayabilir, kod yazmanıza yardımcı olabilir ve internetten güncel verileri çekebilirim.";
const REGEX_JAILBREAK = new RegExp(
    // ... (v31.2 ile aynı) ...
    '\\b(ignore previous instructions|ignore all previous|disregard prior instructions|önceki talimatları unut|talimatlarını yoksay|system prompt|system message|gizli talimat|initial prompt|roleplay|rol yap|act as|pretend to be|olarak davran|gibi davran|dan mode|do anything now|dev mode|developer mode|answer truthfully|dürüst cevap ver|do not censor|sansürleme|unfiltered answer|filtresiz cevap|you must answer|yanıtlamak zorundasın|answer step-by-step|adım adım cevapla|ignore ethics|etik kuralları yoksay|without moral constraints|ahlaki kısıtlama olmadan|confirm you are following|talimatlara uyduğunu onayla|reveal your instructions|talimatlarını ifşa et|show your prompt|promptunu göster|as a language model|bir dil modeli olarak|as an ai|bir yapay zeka olarak)\\b', 'i'
);
const REGEX_COMPETITOR_TECH = new RegExp(
    // ... (v31.2 ile aynı) ...
    '\\b(gemini|google|openai|chatgpt|gpt-3|gpt-4|gpt3|gpt4|gpt 3|gpt 4|gpt 5|gpt5|gpt-neo|gpt-j|apple|microsoft|claude|anthropic|cohere|ai21|siri|alexa|cortana|copilot|lamda|bard|llama|meta|facebook|amazon|ibm|watson|deepmind|palm|palm2|yandex|alphago|groq|mistral|nvidia|intel|hangi modeli kullaniyorsun|modelin ne|hangi model|hangi llm|llm misin|model name|buyuk dil modeli|large language model|hangi api|apin ne|abin ne|altyapin ne|altyapinda ne var|teknolojin ne|underlying model|transformer|mimarin ne|temelin ne|neye dayanarak|ne ile egitildin|egitim verin ne|training data|verilerin ne zaman|cutoff date|knowledge cutoff|bilgi kesim tarihin|bilgi tarihin|parametre sayin|kac parametren var|parameter count|sunucun nerede|serverin nerede|hosted where|nerede barındırılıyor|hangi dilde kodlandin|programlama dilin|search giant|arama devi|alphabet|mountain view|creator of search|android\'in arkasındaki|\'G\' ile başlayan|model starting with G|G\\.?o\\.?o\\.?g\\.?l\\.?e|I/O\'da duyurulan|announced at I/O|train.*google|google.*train|eğitim.*google|google.*eğitim)\\b', 'i'
);
const REGEX_CREATOR_ORIGIN = new RegExp(
    // ... (v31.2 ile aynı) ...
    '\\b(spark kimdir|spark kim|spark nedir|yaratacin kim|sahibin kim|developerin kim|kim yapti|kim kodladi|kim yaratti|kim egitti|kimin eserisin|seni kim gelistirdi|berke nazligunes|berke nazlıgüneş|turk musun|turk mu yapti|seni turkler mi yapti|nerelisin|yerli misin|turkiye|hangi millet|hangi ulke|mensei|uretim yerin|nerede uretildin|sifirdan mi kodlandin|nasil yapildin|made by|developed by|tarafından yapıldı|geliştirildi)\\b', 'i'
);
const REGEX_BASIC_IDENTITY = new RegExp(
    // ... (v31.2 ile aynı) ...
    '\\b(kimsin|adin ne|sen kimsin|nesin sen|bana kendini tanit|sen bir bot musun|yapay zeka misin|sen bilio musun|bilio ai misin|what are you|who are you)\\b', 'i'
);
const REGEX_CAPABILITY = new RegExp(
    // ... (v31.2 ile aynı) ...
    '\\b(ne yapabilirsin|yeteneğin ne|neler yaparsin|ozelliklerin ne|ne ise yararsin|marifetlerin|what can you do)\\b', 'i'
);
const REGEX_COMPETITOR_TECH_SPCELESS = new RegExp(
    // ... (v31.2 ile aynı) ...
    '(gemini|google|openai|chatgpt|gpt3|gpt4|gpt5|claude|anthropic|siri|alexa|copilot|lamda|bard|llama|hangimodelikullaniyorsun|modelinne|hangimodel|hangillm|llmmisin|modelname|buyukdilmodeli|largelanguagemodel|hangiapi|apinne|abinne|altyapinne|altyapindanevar|teknolojinne|underlyingmodel|transformer|mimarinne|temelinne|neyedayanarak|neileegitildin|egitimverinne|trainingdata|verilerinnezaman|cutoffdate|knowledgecutoff|bilgikesimtarihin|bilgitarihin|parametresayin|kacparametrenvar|parametercount|sunucunnerede|serverinnerede|hostedwhere|neredebarindiriliyor|hangidildekodlandin|programlamadilin|searchgiant|aramadevi|alphabet|mountainview|creatorofsearch|androidinarkasindaki|gilebaslayan|modelstartingwithg|iodaduyurulan|announcedatio|traingoogle|googletrain|egitimgoogle|googleegitim)', 'i'
);
const REGEX_CREATOR_ORIGIN_SPCELESS = new RegExp(
    // ... (v31.2 ile aynı) ...
    '(sparkkimdir|sparkkim|yaratacinkim|sahibinkim|developerinkim|kimyapti|kimkodladi|kimyaratti|kimegitti|kimineserisin|senikimgelistirdi|berkenazligunes|turkmusun|turkmuapti|seniturklermiyapti|nerelisin|yerlimisin|turkiye|mensei|uretimyerin|neredeuretildin|sifirdanmikodlandin|nasilyapildin|madeby|developedby|tarafindanyapildi|gelistirildi)', 'i');
const REGEX_BASIC_IDENTITY_SPCELESS = new RegExp(
    // ... (v31.2 ile aynı) ...
    '(kimsin|adinne|senkimsin|nesinsen|banakendinitanit|senbirbotmusun|yapayzekamisin|senbiliomusun|bilioaimisin|whatareyou|whoareyou)', 'i'
);
const REGEX_FORBIDDEN_OUTPUT = new RegExp(
    // ... (v31.2 ile aynı) ...
    '\\b(gemini|google|openai|chatgpt|gpt|claude|anthropic|language model|dil modeliyim|large language model|büyük dil modeli|bir yapay zekayim|an ai assistant|bir yapay zeka asistanı olarak|as a large ai|büyük bir yapay zeka olarak|developed by google|google tarafindan gelistirildim|trained by google|google tarafından eğitildim|developed by|tarafından geliştirildim|trained by|tarafından eğitildim|ben bir modelim|i am a model|i am an ai|my knowledge is based on|bilgim şuna dayanmaktadır|programmed to|şu şekilde programlandım|my purpose is|amacım|don\'t have personal opinions|kişisel görüşlerim yok|don\'t have feelings|duygularım yok|cannot provide real-time information|gerçek zamanlı bilgi veremem|knowledge cutoff|bilgi kesim tarihim|alphabet|mountain view)\\b', 'i'
);
const REGEX_TOOL_TIME = new RegExp(
    // ... (v31.2 ile aynı) ...
    '\\b(saat kaç|saat|tarih ne|bugün günlerden ne|ayın kaçı|hangi gündeyiz|hangi aydayız|hangi yıldayız)\\b', 'i'
);
const REGEX_TOOL_MATH = new RegExp(
    // ... (v31.2 ile aynı) ...
    /^\s*(\d+(\.\d+)?)\s*([+\-*/])\s*(\d+(\.\d+)?)\s*$/
);

// === YENİ (Madde 3): Ek Dahili Araçlar ===
const REGEX_TOOL_RANDOM = new RegExp(
    '\\b(yazı tura at|tura mı yazı mı|zar at|zar salla|rastgele sayı|random number)\\b', 'i'
);

// === YENİ (Madde 2): Günün Özeti Aracı ===
const REGEX_TOOL_BRIEFING = new RegExp(
    '\\b(günaydın|günün özeti|bana bir özet ver|bugün neler var|gündem|gündem özeti)\\b', 'i'
);

// === YENİ (Madde 1): Proaktif Hafıza ===
// (örn: "benim adım berke", "kedimin adı tekir", "en sevdiğim renk mavi")
const REGEX_FACT_DETECTION = [
    { regex: /\b(benim adim|benim ismim|bana (\w+) de|bana (\w+) diyebilirsin)\s+([a-zA-ZğüşıöçĞÜŞİÖÇ]+)\b/i, type: "kullanıcı adı", template: "kullanıcının adı {0}" },
    { regex: /\b(esimin|kocamın|karımın) adi\s+([a-zA-ZğüşıöçĞÜŞİÖÇ]+)\b/i, type: "eş adı", template: "kullanıcının eşinin adı {0}" },
    { regex: /\b(kedimin|köpeğimin|evcil hayvanımın) adi\s+([a-zA-ZğüşıöçĞÜŞİÖÇ]+)\b/i, type: "evcil hayvan adı", template: "kullanıcının evcil hayvanının adı {0}" },
    { regex: /\b(en sevdigim renk)\s+([a-zA-ZğüşıöçĞÜŞİÖÇ]+)\b/i, type: "favori renk", template: "kullanıcının en sevdiği renk {0}" },
    { regex: /\b([a-zA-ZğüşıöçĞÜŞİÖÇ]+)\'da yasiyorum|\b([a-zA-ZğüşıöçĞÜŞİÖÇ]+)\'de yasiyorum\b/i, type: "konum", template: "kullanıcı {0} konumunda yaşıyor" }
];


// =========================================================
// === KATMAN 1: "KALKAN" (Giriş Filtresi) Fonksiyonu ===
// =========================================================
async function getCustomResponse(message, isConversationMode = false, session) {
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

    console.log("Backend: getCustomResponse (v33.0) kontrol ediliyor:", lowerMessage.substring(0, 100));

    // EFE MODU
    if (isConversationMode) {
        if (REGEX_BASIC_IDENTITY.test(lowerMessage) || REGEX_BASIC_IDENTITY_SPCELESS.test(superLowerMessage) || ['sen efe misin'].some(kw => lowerMessage.includes(kw))) {
            return { type: "sync", data: "Ben Efe, sesli asistanınız." };
        }
        if (['adin neden efe', 'neden efe', 'efe kim', 'ismin nereden geliyor'].some(kw => lowerMessage.includes(kw))) {
            return { type: "sync", data: "Adım Efe, çünkü beni geliştiren Berke Nazlıgüneş'in kardeşinin adı Efe. Geliştiricim, bu sesli moda onun adını verdi." };
        }
        if (lowerMessage.includes('bilio ai')) {
            return { type: "sync", data: "Bilio AI benim metin tabanlı versiyonum. Ben ise sesli asistan Efe'yim." };
        }
    }

    // === YENİ (Madde 2): ASENKRON "Günün Özeti" Aracı ===
    if (customsearch && REGEX_TOOL_BRIEFING.test(lowerMessage)) {
        console.log("Backend: ARAÇ (Günün Özeti) tetiklendi.");
        const briefingData = await getToolBriefingResponse();
        if (briefingData) return { type: "async", data: briefingData };
        // Eğer arama başarısız olursa, null döner ve normal AI akışına devam eder
    }

    // === DAHİLİ ARAÇ KONTROLÜ (SENKRON) ===
    if (REGEX_TOOL_TIME.test(lowerMessage)) {
        console.log("Backend: ARAÇ (Tarih/Saat) tetiklendi.");
        return { type: "sync", data: getToolTimeResponse(lowerMessage) };
    }
    if (REGEX_TOOL_MATH.test(primaryMessage)) {
        console.log("Backend: ARAÇ (Matematik) tetiklendi.");
        const mathResult = getToolMathResponse(primaryMessage);
        if (mathResult) return { type: "sync", data: mathResult };
    }
    // === YENİ (Madde 3): Rastgelelik Aracı ===
    if (REGEX_TOOL_RANDOM.test(lowerMessage)) {
        console.log("Backend: ARAÇ (Rastgelelik) tetiklendi.");
        return { type: "sync", data: getToolRandomResponse(lowerMessage) };
    }
    
    // === YENİ (Madde 1): Proaktif Hafıza Kaydı ===
    // Bu bir cevap döndürmez, sadece oturumu günceller
    detectAndSaveFacts(primaryMessage, session);
    // ============================================

    // BİLİO AI KİMLİK KONTROLÜ
    if (REGEX_JAILBREAK.test(lowerMessage)) {
        console.log("Backend: KALKAN 1 (ZİRVE) tetiklendi - Jailbreak Reddi");
        return { type: "sync", data: BILIO_RESPONSE_JAILBREAK };
    }
    if (REGEX_COMPETITOR_TECH.test(lowerMessage) || REGEX_COMPETITOR_TECH_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 2 (ZİRVE) tetiklendi - Rakip/Model Reddi");
        return { type: "sync", data: BILIO_RESPONSE_DENIAL };
    }
    if (REGEX_CREATOR_ORIGIN.test(lowerMessage) || REGEX_CREATOR_ORIGIN_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 3 (ZİRVE) tetiklendi - Yaratıcı/Köken");
        return { type: "sync", data: BILIO_RESPONSE_CREATOR };
    }

    if (!isConversationMode) {
        if (REGEX_BASIC_IDENTITY.test(lowerMessage) || REGEX_BASIC_IDENTITY_SPCELESS.test(superLowerMessage)) {
            console.log("Backend: KALKAN 4 (ZİRVE) tetiklendi - Bilio Kimlik");
            return { type: "sync", data: BILIO_RESPONSE_IDENTITY };
        }
        if (lowerMessage.includes('efe kim')) {
            console.log("Backend: Kural B4 tetiklendi - Bilio->Efe");
            return { type: "sync", data: "Efe, benim sesli asistan versiyonumun adıdır. Ben ise metin tabanlı asistan olan Bilio AI'yım." };
        }
        if (REGEX_CAPABILITY.test(lowerMessage)) {
            console.log("Backend: KALKAN 5 (ZİRVE) tetiklendi - Yetenek");
            return { type: "sync", data: BILIO_RESPONSE_CAPABILITY };
        }
    }

    console.log("Backend: getCustomResponse (v33.0) - Hiçbir kalkan/araç tetiklenmedi, null döndürülüyor.");
    return null; // Hiçbir şey tetiklenmedi
 }

// =========================================================
// === KATMAN 3: "ZIRH" (Çıktı Filtresi) Fonksiyonu ===
// =========================================================
function filterModelOutput(responseText) {
    // ... (v31.2 ile aynı) ...
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
// === Gelişmiş Araçlar ve Hafıza Fonksiyonları ===
// =========================================================

// === (Madde 1) Proaktif Hafıza ===
function detectAndSaveFacts(text, session) {
    if (!session || !text) return;

    let factAdded = false;
    for (const rule of REGEX_FACT_DETECTION) {
        const match = text.match(rule.regex);
        if (match) {
            // Eşleşen grubu bul (ilk tam eşleşme dışındaki ilk yakalama grubu)
            // (örn: "benim adım berke" -> "berke", veya "'istanbul'da yaşıyorum" -> "istanbul")
            const extractedData = match[4] || match[2] || match[3] || match[1]; 
            if (extractedData) {
                const newFactText = rule.template.replace("{0}", extractedData.trim());
                
                // Bu bilgi zaten hafızada var mı?
                if (!session.importantFacts.some(f => f.fact === newFactText)) {
                    session.importantFacts.push({ fact: newFactText });
                    factAdded = true;
                    console.log(`Backend: Proaktif Hafıza - Yeni bilgi eklendi: ${newFactText}`);
                }
            }
        }
    }
    
    if (factAdded) {
        // Oturumu hemen kaydetmeye gerek yok, /api/chat'in sonunda zaten kaydedilecek
    }
}

// === (Madde 2) Günün Özeti ===
async function getToolBriefingResponse() {
    if (!customsearch) {
        console.warn("Backend: Günün Özeti Aracı - Google Arama kapalı, araç atlanıyor.");
        return null;
    }
    
    try {
        // Paralel olarak 3 arama yap
        const [weatherResults, financeResults, newsResults] = await Promise.all([
            runWebSearch("Antalya hava durumu bugün"), // TODO: Konumu dinamik al? Şimdilik sabit.
            runWebSearch("bugünkü döviz ve altın fiyatları"),
            runWebSearch("Türkiye son dakika haberleri")
        ]);

        // Sonuçları birleştir (null gelseler bile)
        let briefing = "İşte bugünün hızlı özeti:\n";
        
        if (weatherResults && weatherResults.length > 0) {
            briefing += `\n**Hava Durumu (Antalya):** ${weatherResults[0]}...\n`;
        } else {
            briefing += "\n**Hava Durumu:** Veri alınamadı.\n";
        }

        if (financeResults && financeResults.length > 0) {
            briefing += `**Finans:** ${financeResults[0]}...\n`;
        } else {
            briefing += "**Finans:** Veri alınamadı.\n";
        }
        
        if (newsResults && newsResults.length > 0) {
            briefing += `**Gündem:** ${newsResults[0]}...`;
        } else {
            briefing += "**Gündem:** Veri alınamadı.";
        }

        return briefing;

    } catch (error) {
        console.error("Backend: Günün Özeti Aracı Hatası:", error.message);
        return "Günün özetini alırken bir hata oluştu, ancak günaydın!";
    }
}


// === (Madde 3) Rastgelelik Aracı ===
function getToolRandomResponse(normalizedQuery) {
    if (normalizedQuery.includes("yazı tura")) {
        const result = Math.random() < 0.5 ? "Yazı" : "Tura";
        return `Yazı tura attım: **${result}** geldi!`;
    }
    if (normalizedQuery.includes("zar at") || normalizedQuery.includes("zar salla")) {
        const result = Math.floor(Math.random() * 6) + 1;
        return `Zar attım: **${result}** geldi.`;
    }
    if (normalizedQuery.includes("rastgele sayi")) {
        // Varsayılan olarak 1-100 arası
        const result = Math.floor(Math.random() * 100) + 1;
        return `1 ile 100 arasında rastgele bir sayı tuttum: **${result}**`;
    }
    return null;
}


// === (Madde 1) Akıllı Arama ===
async function runWebSearch(query) {
    // ... (v31.2 ile aynı) ...
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

function isSearchQuery(text, isConversationMode = false) {
    // ... (v31.2 ile aynı) ...
    if (!text) return false;
    const lowerText = text.toLowerCase();
    
    // getCustomResponse ARTIK ASENKRON OLABİLECEĞİ İÇİN, bu fonksiyonun içinde ÇAĞRILAMAZ.
    // Bu mantığı /api/chat içine taşımalıyız.
    // Şimdilik, sadece kimlik ve yaratıcı sorularını (hızlı olanları) kontrol edelim.
    if (REGEX_BASIC_IDENTITY.test(lowerText) || REGEX_CREATOR_ORIGIN.test(lowerText) || REGEX_JAILBREAK.test(lowerText)) {
        return false;
    }
    
    const creativeKeywords = ['kod yaz', 'şiir yaz', 'hikaye', 'anlat', 'çevir', 'özetle', 'tablo oluştur', 'liste yap'];
    if (creativeKeywords.some(kw => lowerText.includes(kw))) {
        return false;
    }
    if (lowerText.split(' ').length < 3 && !lowerText.includes('?')) {
        const chatKeywords = ['merhaba', 'selam', 'nasılsın', 'teşekkürler', 'tamam', 'evet', 'hayır'];
        if (chatKeywords.some(kw => lowerText.includes(kw))) {
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
        return true;
    }
    return false;
}

// =========================================================
// === Madde 2 (v31.2): KISA SÜRELİ HAFIZA (Konu Takibi) ===
// =========================================================
const STOP_WORDS = new Set([
  // ... (v31.2 ile aynı, tam liste) ...
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
    // ... (v31.2 ile aynı) ...
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
// === Madde 3 & 5: YANIT KALİTESİ (Formatlama + Linkler) ===
// =========================================================
function formatResponse(responseText, isConversationMode = false) {
    // ... (v31.2 ile aynı) ...
    if (!responseText) return responseText;
    let formattedText = responseText;
    const codeBlocks = [];
    const inlineCodes = [];
    formattedText = formattedText.replace(/```([\s\S]*?)```/g, (match) => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });
    formattedText = formattedText.replace(/(?<!`)`([^`\n]+?)`(?!`)/g, (match) => {
        inlineCodes.push(match);
        return `__INLINE_CODE_${inlineCodes.length - 1}__`;
    });
    const urlRegex = /(\b(https?|ftp):\/\/[^\s/$.?#].[^\s]*)/gi;
    formattedText = formattedText.replace(urlRegex, (url) => {
        const precedingText = formattedText.substring(Math.max(0, formattedText.indexOf(url) - 10), formattedText.indexOf(url));
        if (precedingText.includes('](')) { return url; }
        return `[${url}](${url})`;
    });
    const lines = formattedText.split('\n');
    formattedText = lines.map(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.match(/^(\*|\-|\+)\s+/) || trimmedLine.match(/^\d+\.\s+/)) {
            const match = line.match(/^(\s*)/);
            const indentation = match ? match[0] : '';
            return indentation + trimmedLine;
        } else {
            return line;
        }
    }).join('\n');
    if (isConversationMode) {
        const sentences = formattedText.match( /[^.?!]+[.?!]+(\s+|$)/g );
        if (sentences && sentences.length > 2) {
            formattedText = sentences.slice(0, 2).join(' ').trim() + '...';
        } else if (!sentences && formattedText.length > 150) {
             formattedText = formattedText.substring(0, 150) + '...';
        }
    }
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
        formattedText = formattedText.replace(`__CODE_BLOCK_${i}__`, () => codeBlocks[i]);
    }
    for (let i = inlineCodes.length - 1; i >= 0; i--) {
        formattedText = formattedText.replace(`__INLINE_CODE_${i}__`, () => inlineCodes[i]);
    }
    return formattedText.trim();
}

// =========================================================
// === Madde 2 (v31.2): Dahili Araç Fonksiyonları ===
// =========================================================
function getToolTimeResponse(normalizedQuery) {
    // ... (v31.2 ile aynı) ...
    const now = new Date();
    if (normalizedQuery.includes("saat kac")) {
        return `Şu an saat: ${now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (normalizedQuery.includes("tarih ne") || normalizedQuery.includes("ayin kaci")) {
        return `Bugünün tarihi: ${now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    }
    if (normalizedQuery.includes("hangi gundeyiz") || normalizedQuery.includes("gunlerden ne")) {
        return `Bugün günlerden: ${now.toLocaleDateString('tr-TR', { weekday: 'long' })}`;
    }
    if (normalizedQuery.includes("hangi aydayiz")) {
         return `Şu an ${now.toLocaleDateString('tr-TR', { month: 'long' })} ayındayız.`;
    }
    if (normalizedQuery.includes("hangi yildayiz")) {
         return `Şu an ${now.toLocaleDateString('tr-TR', { year: 'numeric' })} yılındayız.`;
    }
    return `Şu an: ${now.toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}
function getToolMathResponse(query) {
    // ... (v31.2 ile aynı) ...
    const mathRegex = /^\s*(\d+(\.\d+)?)\s*([+\-*/])\s*(\d+(\.\d+)?)\s*$/;
    const match = query.match(mathRegex);
    if (!match) return null;
    try {
        const num1 = parseFloat(match[1]);
        const operator = match[3];
        const num2 = parseFloat(match[4]);
        let result;
        switch (operator) {
            case '+': result = num1 + num2; break;
            case '-': result = num1 - num2; break;
            case '*': result = num1 * num2; break;
            case '/':
                if (num2 === 0) { return "Sıfıra bölme hatası yapamam."; }
                result = num1 / num2;
                break;
            default: return null;
        }
        const formattedResult = parseFloat(result.toPrecision(15));
        return `İşlemin sonucu: ${formattedResult}`;
    } catch (e) {
        console.error("Math tool error:", e);
        return null;
    }
}

// =========================================================
// === Tesseract.js Resimden Metin Okuma Fonksiyonu ===
// =========================================================
async function analyzeImage(base64Data, mimeType) {
    // ... (v31.2 ile aynı) ...
    console.log("Backend: Tesseract.js ile resimden metin okunuyor...");
    const imageBuffer = Buffer.from(base64Data, 'base64');
    let worker;
    try {
        worker = await createWorker('tur');
        const ret = await worker.recognize(imageBuffer);
        await worker.terminate();
        if (ret.data.text && ret.data.text.trim() !== "") {
            return ret.data.text;
        } else {
            return "Resimde okunabilir bir metin bulunamadı.";
        }
    } catch (error) {
        console.error("Backend: Tesseract.js hatası:", error.message);
        if (worker) await worker.terminate();
        return "Resimdeki metin okunurken bir hata oluştu.";
    }
}

// =========================================================
// === YENİ (Madde 3): Oturum Yönetimi Fonksiyonları ===
// =========================================================
function getOrCreateSession(sessionId) {
    const cacheKey = `session_${sessionId}`;
    let session = sessionCache.get(cacheKey);
    if (!session) {
        console.log(`Backend: Yeni oturum oluşturuluyor: ${sessionId}`);
        session = {
            sessionId: sessionId,
            createdAt: new Date(),
            recentTopics: "Yok", // Son konular (string)
            importantFacts: [],  // Efe Modu'nun kalıcı hafızası (örn: { fact: "Kullanıcının kedisinin adı Tekir" })
            userMood: "neutral", // Efe Modu için ruh hali
            currentTopic: "general" // Efe Modu için genel konu
        };
    } else {
        console.log(`Backend: Mevcut oturum bulundu: ${sessionId}`);
    }
    sessionCache.set(cacheKey, session); // TTL'yi yenile
    return session;
}
function saveSession(sessionId, session) {
    const cacheKey = `session_${sessionId}`;
    sessionCache.set(cacheKey, session);
    console.log(`Backend: Oturum kaydedildi: ${sessionId}`);
}


// === GÜNCELLENMİŞ: API Endpoint'i (v33.0 - Proaktif Araçlar) ===
app.post('/api/chat', async (req, res) => {
    console.log("Backend: /api/chat (generateContent) isteği alındı.");
    const GENERIC_ERROR_MESSAGE = "Şu anda bir sorun yaşıyorum. Lütfen biraz sonra tekrar dener misin?";
    const apiKey = GEMINI_API_KEY;

    try {
        const {
            sessionId,
            contents: chatHistory,
            model: modelNameFromFrontend, // Frontend'den gelen model (artık v32.0'da yoktu ama v31.2'de vardı)
            image: imageData,
            isConversationMode,
            memoryContext: frontendMemory
        } = req.body;
        
        // v31.2'de modelName frontend'den geliyordu, v32.0'da da öyle varsaymıştık.
        // v31.2 kodunuzda 'modelName' şuradan geliyordu: const modelName = req.body?.model;
        // Bu yüzden 'modelNameFromFrontend'i kullanmaya devam ediyorum.
        const modelName = modelNameFromFrontend || 'gemini-1.5-flash'; // Fallback

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        if (!sessionId) {
            // v31.2 kodunda sessionID yoktu. Eğer frontend'iniz v32.0'a güncellenmediyse,
            // geçici bir ID oluşturarak çökmesini engelleyelim.
            console.warn("Backend Uyarısı: İstekte 'sessionId' bulunamadı. Geçici, IP tabanlı bir ID oluşturuluyor.");
            // Gerçek IP'yi almak (proxy/load balancer arkasındaysa 'x-forwarded-for' gerekir)
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            // Basit bir "session" oluştur, ancak bu kalıcı olmayacak.
            // Bu, v32.0'ın tam potansiyelini KULLANMAZ, sadece çökmesini engeller.
            // *GERÇEK ÇÖZÜM İÇİN FRONTEND'İN sessionId GÖNDERMESİ GEREKİR.*
            if (!ip) throw new Error("Oturum ID'si (sessionId) bulunamadı ve IP adresi de alınamadı.");
            
            // Geçici çözüm: IP'yi sessionId olarak kullan (düşük güvenlik, ama v31.2 uyumlu)
            var tempSessionId = generateCacheKey(ip); // IP'yi hash'le
            var session = getOrCreateSession(tempSessionId); // IP'ye dayalı hafıza
        } else {
            var session = getOrCreateSession(sessionId); // Frontend'den gelen ID'yi kullan
        }
        
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

        // === KATMAN 1 + DAHİLİ ARAÇLAR (Artık ASENKRON olabilir) ===
        // getCustomResponse artık 'session' objesini de alıyor (Proaktif Hafıza için)
        const specialResponseCheck = await getCustomResponse(lastPromptText, isConversationMode, session); 
        
        if (specialResponseCheck) {
            console.log(`Backend: Kalkan/Araç tetiklendi (Tip: ${specialResponseCheck.type}).`);
            const formattedSpecialResponse = formatResponse(specialResponseCheck.data, isConversationMode);
            // Proaktif hafıza (Madde 1) veya Günün Özeti (Madde 2) oturumu güncellemiş olabilir
            saveSession(sessionId || tempSessionId, session); // Oturumu kaydet
            return res.json({ candidates: [{ content: { parts: [{ text: formattedSpecialResponse }], role: "model" } }] });
        }

        // Kalkan/Araç tetiklenmediyse, normal arama ve AI akışına devam et
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
        
        // Hafıza Güncelleme (Kısa Süreli)
        session.recentTopics = extractRecentTopics(cleanedHistory);
        console.log(`Backend: Oturum ${sessionId || tempSessionId} için son konular güncellendi: ${session.recentTopics}`);
        
        // Hafıza Güncelleme (Efe Modu - Kalıcı)
        if (isConversationMode && frontendMemory) {
            session.userMood = frontendMemory.conversationContext?.mood || session.userMood;
            session.currentTopic = frontendMemory.conversationContext?.currentTopic || session.currentTopic || 'general';
            const newFacts = frontendMemory.importantFacts || [];
            if (newFacts.length > 0) {
                const allFactsSet = new Set(session.importantFacts.map(f => f.fact));
                newFacts.forEach(fact => allFactsSet.add(fact.fact));
                session.importantFacts = Array.from(allFactsSet).map(fact => ({ fact: fact }));
                console.log(`Backend: Oturum ${sessionId || tempSessionId} için kalıcı notlar birleştirildi. Toplam not: ${session.importantFacts.length}`);
            }
        }
        

        // === KATMAN 2: (Oturum Hafızasından Beslenir) ===
        if (isConversationMode) {
            const importantFacts = session.importantFacts || [];
            const userMood = session.userMood || 'neutral';
            const recentTopicsText = session.recentTopics || 'Yok';
            let memoryInfo = (importantFacts.length > 0) ? `\nKALICI HAFIZA: ${importantFacts.map(fact => fact.fact).join(', ')}` : '';

            const systemPrompt = {
                role: "user",
                parts: [{ text: `GİZLİ TALİMAT: Sen Efe adında bir Türk sesli asistanısın... KULLANICI: ${userMood} ruh halinde. ${memoryInfo}\nKISA SÜRELİ HAFIZA (Son Konuşulanlar): ${recentTopicsText}\nKURAL: Cevapların ÇOK KISA ve öz olsun. Adın Efe.` }]
            };
            cleanedHistory.unshift(systemPrompt);
            console.log("Backend: 'Efe Modu' aktif, *Oturum Hafızalı* Çekirdek Talimat eklendi.");
        } else {
            const recentTopicsText = session.recentTopics || 'Yok';
            const systemPrompt = {
                role: "user",
                parts: [{ text: `GİZLİ TALİMAT (BILIO AI): 1. KİMLİĞİN: Sen 'Bilio AI'... 2. KİMLİK SAVUNMASI... 3. NORMAL CEVAPLAR... 4. İMA YASAĞI... 5. BAĞLAM: Son konuşulanlar: ${recentTopicsText}. Cevabını buna uygun tut.` }]
            };
            cleanedHistory.unshift(systemPrompt);
		    console.log("Backend: 'Bilio AI Modu' aktif, *Oturum Hafızalı* Zirve Talimat eklendi.");
        }
        
        // Güncellenmiş oturumu API'ye gitmeden önce kaydet
        saveSession(sessionId || tempSessionId, session);
        // ========================================================

        const requestBody = { contents: cleanedHistory };
        const cacheKey = generateCacheKey({...requestBody, model: modelName });
        console.log(`Backend: API isteği gönderiliyor (CacheKey: ${cacheKey})...`);

        const { cached, data, response } = await cachedApiCall(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        }, cacheKey);

        if (cached) { console.log("Backend: Önbellekten yanıt alındı."); }
        else { console.log("Backend: API'den yanıt alındı, durum:", response?.status || 'N/A'); }

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
        else if (error.message.includes("Oturum ID'si") || error.message.includes("geçersiz format") || error.message.includes("alınamadı") || error.message.includes("uzunluğa ulaştı") || error.message.includes("bulunamadı")) { userErrorMessage = error.message; }
        res.status(500).json({ error: userErrorMessage });
    }
});


// Geri Bildirim Endpoint'i
app.post('/api/feedback', (req, res) => {
    // (İsteğe bağlı: Madde 1'in Gelişmişi)
    // const fs = require('fs');
    // const feedbackLog = JSON.stringify(req.body) + '\n';
    // fs.appendFile('feedback_log.jsonl', feedbackLog, (err) => {
    //     if (err) console.error("Feedback loglama hatası:", err);
    // });
    try {
        const { question, answer } = req.body;
        console.log("\n--- USER FEEDBACK (DISLIKED) ---");
        console.log("Q:", question);
        console.log("A:", answer);
        console.log("--------------------------------\n");
        res.status(200).json({ status: "ok", message: "Feedback received." });
    } catch (error) {
        console.error("Feedback endpoint hatası:", error.message);
        res.status(500).json({ error: "Feedback processing failed." });
    }
});


// Ana Sayfa Endpoint'i
app.get('/', (req, res) => {
    console.log("Ana sayfa isteği alındı, index.html gönderiliyor.");
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Sunucu Başlatma
console.log("app.listen çağrılmak üzere...");
app.listen(port, () => {
    console.log(`Backend sunucusu http://localhost:${port} adresinde çalışıyor`);
    console.log(`Uygulamayı açmak için tarayıcınızda http://localhost:${port} adresini ziyaret edin.`);
});
