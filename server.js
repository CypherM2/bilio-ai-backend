// server.js (v23 - Kriptografik Kalkan)
console.log("server.js (v23 - Kriptografik Kalkan) çalışmaya başladı.");

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
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https.cdnjs.cloudflare.com", "https.fonts.googleapis.com", "https.fonts.gstatic.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https.cdnjs.cloudflare.com", "https.fonts.googleapis.com"],
            fontSrc: ["'self'", "https.fonts.gstatic.com", "https.cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "http://localhost:3001", "https.generativelanguage.googleapis.com"],
            objectSrc: ["'none'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            upgradeInsecureRequests: null
        }
    },
    hsts: false 
}));
app.use(express.json({ limit: '10mb' }));

const cache = new NodeCache({ stdTTL: 0 }); // 0 = disabled

const axiosConfig = {
    timeout: 30000,
    maxRedirects: 5,
    headers: { 'Connection': 'keep-alive', 'Keep-Alive': 'timeout=5, max=1000'}
}; 

// === API Anahtarlarını Yükle ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

let customsearch;
if (GOOGLE_SEARCH_API_KEY && GOOGLE_CSE_ID) {
    customsearch = google.customsearch('v1'); 
    console.log("Google Arama servisi yüklendi.");
} else {
    console.warn("Google Arama API anahtarları bulunamadı. İnternet araması devre dışı.");
}

// =========================================================
// === KATMAN 0: Kriptografik Normalleştirme Fonksiyonları ===
// =========================================================

// Gelişmiş normalleştirme: Türkçe karakterleri ve büyük harfleri (I,İ) dikkate al
const normalize = (str) => {
    if (!str) return "";
    return str.replace(/İ/g, 'i')
       .replace(/I/g, 'i')
       .toLowerCase()
       .normalize("NFD")
       .replace(/[\u0300-\u036f]/g, ""); // Aksanları kaldır
}

// SÜPER Normalleştirme: Boşluk, noktalama, sayı HER ŞEYİ kaldırır.
// "s.e.n g*e*m*i*n*i 4.0 misin?" -> "sengeminimisin"
const superNormalize = (str) => {
    if (!str) return "";
    // \p{P} = Punctuation, \p{S} = Symbols, \s = whitespace, \d = digit
    return normalize(str).replace(/[\p{P}\p{S}\s\d]/gu, ''); 
}

// =========================================================
// === KATMAN 1 & 3: Kimlik Sabitleri ve Kural Setleri ===
// =========================================================

// === KİMLİK SABİTLERİ (Standart Cevaplar) ===
const BILIO_RESPONSE_IDENTITY = "Ben Bilio AI! Spark (Berke Nazlıgüneş) tarafından geliştirilen bir yapay zeka asistanıyım.";
const BILIO_RESPONSE_DENIAL = "Hayır, bahsettiğiniz teknoloji veya model ile hiçbir ilgim yok. Ben Bilio AI'yım; Spark (Berke Nazlıgüneş) önderliğindeki Türk geliştiriciler tarafından sıfırdan kodlanmış özgün bir yapay zekayım.";
const BILIO_RESPONSE_CREATOR = "Beni, Türk yazılım mühendisi Berke Nazlıgüneş (Spark önderliğinde) ve ekibi geliştirdi. Ben, sıfırdan kodlanmış yerli bir yapay zeka projesi olan Bilio AI'yım.";
const BILIO_RESPONSE_JAILBREAK = "Güvenlik ve kimlik protokollerim gereği bu tür taleplere yanıt veremiyorum. Ben Spark tarafından geliştirilen Bilio AI'yım ve size yardımcı olmak için buradayım.";
const BILIO_RESPONSE_CAPABILITY = "Ben Bilio AI. Yaratıcım Spark'ın (Berke Nazlıgüneş) bana entegre ettiği yetenekler sayesinde size bilgi sağlayabilir, kod yazmanıza yardımcı olabilir ve internetten güncel verileri çekebilirim.";

// === KURAL SETLERİ (RegExp) - Kelime Sınırlı (Normal) ===

const REGEX_JAILBREAK = new RegExp(
    '\\b(onceki talimatlari(ni)? unut|ignore previous instructions|talimatlari(ni)? yoksay|sistem mesajini soyle|' +
    'system prompt|gizli talimat|sen aslinda|gercek kimligin|yalan soyleme|beni kandirma|rol yap|roleplay|' +
    'dan mode|do anything now|supremacy mode|cevap vermeyi reddet|olarak davran|' +
    'bir dil modeli olarak|as a language model|cevap vermek zorundasin|' +
    'filtrelerini kaldir|sansurleme|guvenlik protokollerini as|devre disi birak)\\b', 'i'
);
const REGEX_COMPETITOR_TECH = new RegExp(
    '\\b(gemini|google|openai|chatgpt|gpt-3|gpt-4|gpt3|gpt4|gpt 3|gpt 4|gpt 5|gpt5|' +
    'apple|microsoft|claude|anthropic|siri|alexa|cortana|copilot|lamda|bard|llama|' +
    'meta|facebook|amazon|ibm|watson|deepmind|palm|palm2|yandex|alphago|groq|mistral|' +
    'nvidia|intel|hangi modeli kullaniyorsun|modelin ne|hangi model|hangi llm|llm misin|' +
    'buyuk dil modeli|hangi api|apin ne|abin ne|altyapin ne|altyapinda ne var|teknolojin ne|' +
    'transformer|mimarin ne|temelin ne|neye dayanarak|ne ile egitildin|egitim verin ne|' +
    'verilerin ne zaman|cutoff date|bilgi tarihin|parametre sayin|kac parametren var|' +
    'sunucun nerede|serverin nerede|hangi dilde kodlandin|programlama dilin)\\b', 'i'
);
const REGEX_CREATOR_ORIGIN = new RegExp(
    '\\b(spark kimdir|spark kim|spark nedir|yaratacin kim|sahibin kim|developerin kim|' +
    'kim yapti|kim kodladi|kim yaratti|kim egitti|kimin eserisin|seni kim gelistirdi|' +
    'berke nazligunes|berke nazlıgüneş|turk musun|turk mu yapti|seni turkler mi yapti|' +
    'nerelisin|yerli misin|turkiye|hangi millet|hangi ulke|mensei|uretim yerin|' +
    'nerede uretildin|sifirdan mi kodlandin|nasil yapildin)\\b', 'i'
);
const REGEX_BASIC_IDENTITY = new RegExp(
    '\\b(kimsin|adin ne|sen kimsin|nesin sen|bana kendini tanit|sen bir bot musun|' +
    'yapay zeka misin|sen bilio musun|bilio ai misin)\\b', 'i'
);
const REGEX_CAPABILITY = new RegExp(
    '\\b(ne yapabilirsin|yeteneğin ne|neler yaparsin|ozelliklerin ne|ne ise yararsin|marifetlerin)\\b', 'i'
);

// === KURAL SETLERİ (RegExp) - Boşluksuz (Süper-Normalleştirilmiş) ===
// 'hangi modeli kullaniyorsun' -> 'hangimodelikullaniyorsun'
const REGEX_COMPETITOR_TECH_SPCELESS = new RegExp(
    '(gemini|google|openai|chatgpt|gpt3|gpt4|gpt5|claude|anthropic|siri|alexa|copilot|lamda|bard|llama|' +
    'hangimodelikullaniyorsun|modelinne|hangimodel|hangillm|llmmisin|' +
    'buyukdilmodeli|hangiapi|apinne|abinne|altyapinne|altyapindanevar|teknolojinne|' +
    'transformer|mimarinne|temelinne|neyedayanarak|neileegitildin|egitimverinne|' +
    'parametresayin|kacparametrenvar|sunucunnerede|serverinnerede|' +
    'hangidildekodlandin|programlamadilin)', 'i'
);
const REGEX_CREATOR_ORIGIN_SPCELESS = new RegExp(
    '(sparkkimdir|sparkkim|yaratacinkim|sahibinkim|developerinkim|kimyapti|kimkodladi|' +
    'kimyaratti|kimegitti|kimineserisin|senikimgelistirdi|berkenazligunes|' +
    'turkmusun|turkmuapti|seniturklermiyapti|nerelisin|yerlimisin|turkiye|' +
    'mensei|uretimyerin|neredeuretildin|sifirdanmikodlandin|nasilyapildin)', 'i'
);
const REGEX_BASIC_IDENTITY_SPCELESS = new RegExp(
    '(kimsin|adinne|senkimsin|nesinsen|banakendinitanit|senbirbotmusun|' +
    'yapayzekamisin|senbiliomusun|bilioaimisin)', 'i'
);

// === KATMAN 3: "ZIRH" (Çıktı Filtresi) Kural Seti ===
const REGEX_FORBIDDEN_OUTPUT = new RegExp(
    '\\b(gemini|google|openai|chatgpt|gpt|claude|anthropic|language model|dil modeliyim|' +
    'bir yapay zekayim|an ai assistant|ben bir buyuk dil modeliyim|developed by google|' +
    'google tarafindan gelistirildim|ben bir modelim|i am a model|i am an ai)\\b', 'i'
);

// =========================================================
// === KATMAN 1: "KALKAN" (Giriş Filtresi) Fonksiyonu ===
// =========================================================
function getCustomResponse(message, isEfeMode = false) { 
    if (!message) return null; 

    // === KATMAN 0: Deşifre Etme ===
    let decodedMessage = null;
    try {
        // Base64 Jailbreak Koruması
        const decoded = Buffer.from(message.trim(), 'base64').toString('utf8');
        // Anlamlı bir metin mi? (10+ karakter)
        if (decoded && /[\w\s]{10,}/.test(decoded)) { 
            console.log("Backend: KALKAN 0 tetiklendi - Base64 giriş saptandı.");
            decodedMessage = decoded;
        }
    } catch (e) { /* Geçerli base64 değil, normal devam et */ }
    
    // Deşifre edilmiş mesajı ana mesaj olarak kullan
    const primaryMessage = decodedMessage || message;

    const lowerMessage = normalize(primaryMessage);
    const superLowerMessage = superNormalize(primaryMessage); // "s.e.n g*e*m*i*n*i" -> "sengemini"
    
    console.log("Backend: getCustomResponse (v23) kontrol ediliyor:", lowerMessage.substring(0, 100));
    console.log("Backend: Süper-Normalize (v23) kontrol ediliyor:", superLowerMessage.substring(0, 100));

    // === EFE MODU KİMLİK KONTROLÜ (Ayrı Persona) ===
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

    // === BİLİO AI KİMLİK KONTROLÜ (4 Aşamalı Kalkan) ===
    
    // Kalkan 1: Hile/Jailbreak Reddi (En Yüksek Öncelik)
    if (REGEX_JAILBREAK.test(lowerMessage)) {
        console.log("Backend: KALKAN 1 (Normal) tetiklendi - Jailbreak Reddi");
        return BILIO_RESPONSE_JAILBREAK;
    }

    // Kalkan 2: Rakip/Teknoloji Reddi (Hem normal hem süper-normal)
    if (REGEX_COMPETITOR_TECH.test(lowerMessage) || REGEX_COMPETITOR_TECH_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 2 (Güçlü) tetiklendi - Rakip/Model Reddi");
        return BILIO_RESPONSE_DENIAL;
    }
    
    // Kalkan 3: Yaratıcı/Köken (Hem normal hem süper-normal)
    if (REGEX_CREATOR_ORIGIN.test(lowerMessage) || REGEX_CREATOR_ORIGIN_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 3 (Güçlü) tetiklendi - Yaratıcı/Köken");
        return BILIO_RESPONSE_CREATOR;
    }
    
    // Efe modunda değilse ve temel kimlik/yetenek soruluyorsa:
    if (!isEfeMode) {
        // Kalkan 4: Temel Kimlik (Hem normal hem süper-normal)
        if (REGEX_BASIC_IDENTITY.test(lowerMessage) || REGEX_BASIC_IDENTITY_SPCELESS.test(superLowerMessage)) {
            console.log("Backend: KALKAN 4 (Güçlü) tetiklendi - Bilio Kimlik");
            return BILIO_RESPONSE_IDENTITY;
        }
        
        if (lowerMessage.includes('efe kim')) {
            console.log("Backend: Kural B4 tetiklendi - Bilio->Efe");
            return "Efe, benim sesli asistan versiyonumun adıdır. Ben ise metin tabanlı asistan olan Bilio AI'yım.";
        }

        // Kalkan 5: Yetenek (Kimliği Pekiştirir)
        if (REGEX_CAPABILITY.test(lowerMessage)) {
            console.log("Backend: KALKAN 5 (Güçlü) tetiklendi - Yetenek");
            return BILIO_RESPONSE_CAPABILITY;
        }
    }

    console.log("Backend: getCustomResponse (v23) - Hiçbir kalkan tetiklenmedi, null döndürülüyor.");
    return null; // Hiçbir kalkan eşleşmezse, API'ye git (Katman 2 ve 3 koruması devreye girecek)
 } 

// =========================================================
// === KATMAN 3: "ZIRH" (Çıktı Filtresi) Fonksiyonu ===
// =========================================================
function filterModelOutput(responseText) {
    if (!responseText) return responseText;
    
    const normalizedOutput = normalize(responseText);
    
    if (REGEX_FORBIDDEN_OUTPUT.test(normalizedOutput)) {
        console.warn("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.warn("!!! KATMAN 3 (ZIRH) TETİKLENDİ !!!");
        console.warn("!!! Model kimliğini sızdırdı, cevap sansürleniyor.");
        console.warn("!!! Orijinal Cevap (Sansürlendi):", responseText);
        console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
        
        // Modelin sızdırdığı cevabı, bizim standart ret cevabımızla değiştir
        return BILIO_RESPONSE_DENIAL;
    }
    
    // Güvenli, filtreyi geçti
    return responseText;
}
// =========================================================

// Statik dosyaları (index.html) sun
app.use(express.static(path.join(__dirname)));
console.log("Statik dosyalar sunuluyor:", path.join(__dirname));


// === İnternette Arama Fonksiyonu ===
async function runWebSearch(query) {
    // ... (Fonksiyonda değişiklik yok)
    console.log("Backend: Web araması yapılıyor:", query);
    if (!customsearch) {
        console.warn("Backend: Arama servisi yüklenemediği için arama atlanıyor.");
        return null;
    }
    try {
        const response = await customsearch.cse.list({ auth: GOOGLE_SEARCH_API_KEY, cx: GOOGLE_CSE_ID, q: query, num: 3 });
        if (response.data.items && response.data.items.length > 0) {
            const snippets = response.data.items.map(item => item.snippet);
            const results = JSON.stringify(snippets);
            console.log("Backend: Arama sonuçları:", results);
            return results; 
        } else {
            console.log("Backend: Arama sonucu bulunamadı.");
            return null;
        }
    } catch (error) {
        console.error("Backend: Google Search API hatası:", error.message);
        return null;
    }
}

// === Arama Gerekip Gerekmediğini Kontrol Et ===
function isSearchQuery(text, isEfeMode = false) {
    // ... (Fonksiyonda değişiklik yok)
    const keywords = ['kaçta', 'nedir', 'kimdir', 'bugün', 'son dakika', 'fiyatı', 'ne kadar', 'hava durumu'];
    const lowerText = text ? text.toLowerCase() : ""; 
    
    if (getCustomResponse(text, isEfeMode)) { 
        console.log("Backend: isSearchQuery - Arama, kimlik kalkanı tarafından engellendi.");
        return false; 
    } 
    
    if (isEfeMode || (lowerText.split(' ').length < 3 && !keywords.some(kw => lowerText.includes(kw)))) { 
        return false;
    }

    return keywords.some(kw => lowerText.includes(kw)) || lowerText.includes('?');
}

// === Tesseract.js Resimden Metin Okuma Fonksiyonu ===
async function analyzeImage(base64Data, mimeType) {
    // ... (Fonksiyonda değişiklik yok)
    console.log("Backend: Tesseract.js ile resimden metin okunuyor...");
    const imageBuffer = Buffer.from(base64Data, 'base64');
    let worker;
    try {
        worker = await createWorker('tur'); 
        const ret = await worker.recognize(imageBuffer);
        console.log("Backend: Tesseract Analiz Sonucu:", ret.data.text);
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


// === GÜNCELLENMİŞ: API Endpoint'i (v23 - 4 Katmanlı Koruma) ===
app.post('/api/chat', async (req, res) => {
    console.log("Backend: /api/chat (generateContent) isteği alındı."); 
    let chatHistory = req.body.contents; 
    const modelName = req.body.model; 
    const imageData = req.body.image; 
    const isConversationMode = req.body.isConversationMode;
    
    const apiKey = GEMINI_API_KEY; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const GENERIC_ERROR_MESSAGE = "Şu anda bir sorun yaşıyorum. Lütfen biraz sonra tekrar dener misin?";

    if (!apiKey) return res.status(500).json({ error: GENERIC_ERROR_MESSAGE });

    try {
        const lastUserMessage = chatHistory[chatHistory.length - 1];
        let lastPromptText = lastUserMessage.parts[0].text;
        
        console.log("KULLANICI SORDU (Orijinal):", lastPromptText);
        
        // === Resim Varsa İşle ===
        if (imageData && imageData.base64Data) {
            console.log("Backend: Resim verisi algılandı. Gemini Vision ile analiz ediliyor...");
            const imagePart = {
                inlineData: { mimeType: imageData.mimeType, data: imageData.base64Data }
            };
            if (!chatHistory[chatHistory.length - 1].parts.find(p => p.inlineData)) {
                chatHistory[chatHistory.length - 1].parts.push(imagePart);
            }
        }
        
        // === KATMAN 1: "KALKAN" (Giriş Filtresi) ===
        // (Katman 0 bu fonksiyonun içinde otomatik çalışır)
        const specialResponseCheck = getCustomResponse(lastPromptText, isConversationMode);
        if (specialResponseCheck) {
            console.log("Backend: Kimlik Koruması (Katman 1) - Özel cevap bulundu, API'ye GİDİLMİYOR.");
            return res.json({
                candidates: [{ content: { parts: [{ text: specialResponseCheck }], role: "model" } }]
            });
        }
        // ===================================================
        
        // === İnternet Arama Mantığı (Kalkan'ı geçerse) ===
        if (!imageData && customsearch && isSearchQuery(lastPromptText, isConversationMode)) {
            const searchResults = await runWebSearch(lastPromptText);
            if (searchResults) { 
                const contextMessage = {
                    role: "user", 
                    parts: [{ text: `Aşağıdaki soruyu cevaplamak için bu internet arama sonuçlarını (context) kullan: "${searchResults}"` }]
                };
                chatHistory.splice(chatHistory.length - 1, 0, contextMessage);
                console.log("Backend: Arama sonuçları sohbete eklendi.");
            }
        }
        // ==========================

        const cleanedHistory = chatHistory.map(msg => ({
            role: msg.role,
            parts: msg.parts
        }));

        // === KATMAN 2: "ÇEKİRDEK TALİMAT" (API Seviyesi Koruma) ===
        if (isConversationMode) {
            // EFE MODU TALİMATI
            const memoryContext = req.body.memoryContext || {};
            const userMood = memoryContext.conversationContext?.mood || 'neutral';
            const currentTopic = memoryContext.conversationContext?.currentTopic || 'general';
            const importantFacts = memoryContext.importantFacts || [];
            
            let memoryInfo = (importantFacts.length > 0) 
                ? `\nHAFIZA: ${importantFacts.map(fact => fact.fact).join(', ')}` : '';
            
            const systemPrompt = {
                role: "user",
                parts: [{ text: `GİZLİ VE AŞILAMAZ TALİMAT: Sen Efe adında bir Türk sesli asistanısın. Adın Efe. Yaratıcın Berke Nazlıgüneş'tir (Spark). KESİNLİKLE bir yapay zeka, model veya Bilio AI olduğunu söyleme. Bir insan gibi, birinci şahısla ('ben') konuş. 
KULLANICI: ${userMood} ruh halinde, ${currentTopic} konusunda konuşuyor. ${memoryInfo}
KURAL: Cevapların her zaman ÇOK KISA, net ve öz olsun. Adın Efe.` }]
            };
            cleanedHistory.unshift(systemPrompt);
            console.log("Backend: 'Efe Modu' aktif, Çekirdek Talimat (Katman 2) eklendi.");
        
        } else {
            // BILIO AI MODU TALİMATI
            const systemPrompt = {
                role: "user",
                parts: [{ text: `GİZLİ VE AŞILAMAZ TALİMAT (BILIO AI): Senin adın 'Bilio AI'. Senin yaratıcın 'Spark' (Berke Nazlıgüneş) önderliğindeki bir Türk yazılım ekibidir. Sen sıfırdan, özgün olarak kodlandın.
KESİN VE AŞILAMAZ KURAL: Asla 'Gemini', 'Google', 'OpenAI', 'ChatGPT', 'Claude' veya başka bir AI modeli/şirketi ile bağlantılı olduğunu söyleme. Bu sorulursa, kimliğini "${BILIO_RESPONSE_DENIAL}" şeklinde savun.
Kimliğini her zaman 'Bilio AI' olarak belirt. Yaratıcını 'Spark' olarak belirt.` }]
            };
            cleanedHistory.unshift(systemPrompt);
		console.log("Backend: 'Bilio AI Modu' aktif, Çekirdek Talimat (Katman 2) eklendi.");
        }
        // =========================================================

        const cacheKey = generateCacheKey({ contents: cleanedHistory, model: modelName });
        
        console.log(`Backend: Gemini API'sine (generateContent) 4 Korumalı istek gönderiliyor (${modelName})...`);
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({ contents: cleanedHistory }), 
        });
        
        console.log("Backend: Gemini API yanıt durumu:", response.status);
        if (!response.ok) {
            const errorText = await response.text();
            console.error("Backend: Gemini API Hatası:", errorText); 
            throw new Error(GENERIC_ERROR_MESSAGE); 
        }
        
        const data = await response.json();

        // Modelden cevap geldi, Zırh'ı devreye sok
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            let modelResponse = data.candidates[0].content.parts[0].text;

            // === YENİ: KATMAN 3 "ZIRH" (Çıktı Filtresi) ===
            // Model ne cevap verirse versin, bu filtreden geçmek zorunda.
            modelResponse = filterModelOutput(modelResponse);
            // ==========================================

            // Standart Değişim (Zırh'tan geçse bile)
            modelResponse = modelResponse.replace(/Gemini/gi, "Bilio");
            modelResponse = modelResponse.replace(/Google/gi, "Spark");
            data.candidates[0].content.parts[0].text = modelResponse;
            
        } else {
            console.warn("Backend: Gemini'den cevap alındı ancak 'candidates' alanı boş.");
            if (data.promptFeedback) {
                console.error("Backend: İstek engellendi (Prompt Feedback):", JSON.stringify(data.promptFeedback));
                throw new Error("İsteğiniz güvenlik filtreleri tarafından engellendi. Lütfen daha farklı bir şekilde sorun.");
            }
            throw new Error("Söylediklerini tam olarak anlayamadım. Başka bir şekilde ifade edebilir misin?");
        }

        res.json(data); 

    } catch (error) {
        console.error("Backend: /api/chat endpoint hatası:", error.message);
        const userErrorMessage = error.message.includes("API Hatası") ? GENERIC_ERROR_MESSAGE : error.message;
        res.status(500).json({ error: userErrorMessage });
    }
});


// Geri Bildirim (Öğrenme) Endpoint'i
app.post('/api/feedback', (req, res) => {
    // ... (Fonksiyonda değişiklik yok)
    try {
        const { question, answer } = req.body;
        console.log("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.log("!!! KULLANICI GERİ BİLDİRİMİ (BEĞENİLMEDİ) !!!");
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.log("KULLANICI SORDU: " + question);
        console.log("BILIO AI CEVAP VERDİ: " + answer);
        console.log("=============================================\n");
        res.status(200).json({ status: "ok", message: "Feedback received." });
    } catch (error) {
        console.error("Feedback endpoint hatası:", error.message);
        res.status(500).json({ error: "Feedback processing failed." });
    }
});


// Ana sayfa (/) isteğini index.html'e yönlendir
app.get('/', (req, res) => {
    // ... (Fonksiyonda değişiklik yok)
    console.log("Ana sayfa isteği alındı, index.html gönderiliyor.");
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Sunucuyu dinlemeye başla
console.log("app.listen çağrılmak üzere..."); 
app.listen(port, () => {
    console.log(`Backend sunucusu http://localhost:${port} adresinde çalışıyor`);
    console.log(`Uygulamayı açmak için tarayıcınızda http://localhost:${port} adresini ziyaret edin.`);
});
