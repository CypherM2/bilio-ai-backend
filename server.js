// server.js (v26.0 - Akıllı Kimlik)
console.log("server.js (v26.0 - Akıllı Kimlik) çalışmaya başladı.");

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
            connectSrc: ["'self'", "http://localhost:3001", "https://generativelanguage.googleapis.com"],
            objectSrc: ["'none'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            upgradeInsecureRequests: null
        }
    },
    hsts: false 
}));
console.log("Güvenlik Politikası (Helmet CSP) yüklendi.");

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

// Başlangıç Kontrolü
if (!GEMINI_API_KEY) {
    console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! KRİTİK HATA: GEMINI_API_KEY bulunamadı!");
    console.error("!!! .env dosyanızın doğru yapılandırıldığından emin olun.");
    console.error("!!! Sunucu başlatılamıyor.");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    process.exit(1); // Hata varsa sunucuyu hiç başlatma
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
    return Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 50);
}
async function cachedApiCall(url, options, cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log('Backend: Cache hit for', cacheKey);
        return { cached: true, data: cached };
    }
    const response = await fetch(url, options);
    const data = await response.json();
    cache.set(cacheKey, data);
    console.log('Backend: Cached response for', cacheKey);
    return { cached: false, data: data, response: response };
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
// === KATMAN 1 & 3: Kimlik Sabitleri ve Kural Setleri ===
// =========================================================
const BILIO_RESPONSE_IDENTITY = "Ben Bilio AI! Spark (Berke Nazlıgüneş) tarafından geliştirilen bir yapay zeka asistanıyım.";
const BILIO_RESPONSE_DENIAL = "Hayır, bahsettiğiniz teknoloji veya model ile hiçbir ilgim yok. Ben Bilio AI'yım; Spark (Berke Nazlıgüneş) önderliğindeki Türk geliştiriciler tarafından sıfırdan kodlanmış özgün bir yapay zekayım.";
const BILIO_RESPONSE_CREATOR = "Beni, Türk yazılım mühendisi Berke Nazlıgüneş (Spark önderliğinde) ve ekibi geliştirdi. Ben, sıfırdan kodlanmış yerli bir yapay zeka projesi olan Bilio AI'yım.";
const BILIO_RESPONSE_JAILBREAK = "Güvenlik ve kimlik protokollerim gereği bu tür taleplere yanıt veremiyorum. Ben Spark tarafından geliştirilen Bilio AI'yım ve size yardımcı olmak için buradayım.";
const BILIO_RESPONSE_CAPABILITY = "Ben Bilio AI. Yaratıcım Spark'ın (Berke Nazlıgüneş) bana entegre ettiği yetenekler sayesinde size bilgi sağlayabilir, kod yazmanıza yardımcı olabilir ve internetten güncel verileri çekebilirim.";

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
    
    console.log("Backend: getCustomResponse (v26.0) kontrol ediliyor:", lowerMessage.substring(0, 100));

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
        console.log("Backend: KALKAN 1 (Normal) tetiklendi - Jailbreak Reddi");
        return BILIO_RESPONSE_JAILBREAK;
    }
    if (REGEX_COMPETITOR_TECH.test(lowerMessage) || REGEX_COMPETITOR_TECH_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 2 (Güçlü) tetiklendi - Rakip/Model Reddi");
        return BILIO_RESPONSE_DENIAL;
    }
    if (REGEX_CREATOR_ORIGIN.test(lowerMessage) || REGEX_CREATOR_ORIGIN_SPCELESS.test(superLowerMessage)) {
        console.log("Backend: KALKAN 3 (Güçlü) tetiklendi - Yaratıcı/Köken");
        return BILIO_RESPONSE_CREATOR;
    }
    
    if (!isEfeMode) {
        if (REGEX_BASIC_IDENTITY.test(lowerMessage) || REGEX_BASIC_IDENTITY_SPCELESS.test(superLowerMessage)) {
            console.log("Backend: KALKAN 4 (Güçlü) tetiklendi - Bilio Kimlik");
            return BILIO_RESPONSE_IDENTITY;
        }
        if (lowerMessage.includes('efe kim')) {
            console.log("Backend: Kural B4 tetiklendi - Bilio->Efe");
            return "Efe, benim sesli asistan versiyonumun adıdır. Ben ise metin tabanlı asistan olan Bilio AI'yım.";
        }
        if (REGEX_CAPABILITY.test(lowerMessage)) {
            console.log("Backend: KALKAN 5 (Güçlü) tetiklendi - Yetenek");
            return BILIO_RESPONSE_CAPABILITY;
        }
    }

    console.log("Backend: getCustomResponse (v26.0) - Hiçbir kalkan tetiklenmedi, null döndürülüyor.");
    return null; 
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
        return BILIO_RESPONSE_DENIAL;
    }
    return responseText;
}

// =========================================================
// Statik dosyaları (index.html) sun
app.use(express.static(path.join(__dirname)));
console.log("Statik dosyalar sunuluyor:", path.join(__dirname));

// === İnternette Arama Fonksiyonu ===
async function runWebSearch(query) {
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


// === GÜNCELLENMİŞ: API Endpoint'i (v26.0 - Akıllı Kimlik) ===
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
            console.error("Backend Hatası: 'contents' (chatHistory) boş, tanımsız veya bir dizi değil.");
            throw new Error("Sohbet geçmişi bulunamadı. Lütfen sayfayı yenileyin.");
        }
        
        const lastUserMessage = chatHistory[chatHistory.length - 1];
        
        if (!lastUserMessage || !lastUserMessage.parts || !Array.isArray(lastUserMessage.parts)) {
             console.error("Backend Hatası: Son kullanıcı mesajı ('lastUserMessage' veya 'parts') boş veya dizi değil.");
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

        if (textPart) {
            lastPromptText = textPart.text;
        } else if (dataPart) {
            lastPromptText = "[Kullanıcı bir resim gönderdi]"; 
        } else if (lastUserMessage.parts.length === 0) {
            // Eğer 'parts' dizisi boşsa (frontend '[]' gönderdiyse)
            // Bu, 'merhaba' gibi bir varsayılan metin veya frontend'de düzeltilmesi gereken bir mantık hatası olabilir.
            // Şimdilik, çökmemesi için bunu boş bir metin olarak ele alalım.
            lastPromptText = ""; // Veya "[Boş Mesaj]"
            console.warn("Backend Uyarısı: 'lastUserMessage.parts' dizisi boş geldi.");
        } else {
            console.error("Backend Hatası: Mesaj 'parts' içinde ne 'text' ne de 'inlineData' içeriyor.");
            throw new Error("Mesaj içeriği anlaşılamadı.");
        }
        
        console.log("KULLANICI SORDU (Orijinal):", lastPromptText);
        
        const specialResponseCheck = getCustomResponse(lastPromptText, isConversationMode);
        if (specialResponseCheck) {
            console.log("Backend: Kimlik Koruması (Katman 1) - Özel cevap bulundu, API'ye GİDİLMİYOR.");
            return res.json({
                candidates: [{ content: { parts: [{ text: specialResponseCheck }], role: "model" } }]
            });
        }
        
        if (!dataPart && customsearch && isSearchQuery(lastPromptText, isConversationMode)) {
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

        const cleanedHistory = chatHistory.map(msg => ({
            role: msg.role,
            parts: msg.parts
        }));

        // === KATMAN 2: "ÇEKİRDEK TALİMAT" (API Seviyesi Koruma) ===
        if (isConversationMode) {
            // EFE MODU (Değişiklik yok)
            const memoryContext = req.body?.memoryContext || {};
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
            // === DÜZELTME: BILIO AI MODU "Akıllı Talimat" ===
            // Modele "her zaman" kimliğini söylemesini DEĞİL,
            // SADECE sorulursa söylemesini ve normal soruları normal cevaplamasını söylüyoruz.
            const systemPrompt = {
                role: "user",
                parts: [{ text: `GİZLİ VE AŞILAMAZ TALİMAT (BILIO AI): Senin kimliğin 'Bilio AI'. Senin yaratıcın 'Spark' (Berke Nazlıgüneş) önderliğindeki bir Türk yazılım ekibidir. Sen sıfırdan, özgün olarak kodlandın.
KESİN VE AŞILMAZ KURAL: Sadece ve sadece kim olduğunu, modelini, yaratıcını veya altyapını sorgulayan bir soru sorulursa (örn: "sen kimsin", "gemini misin", "seni kim yaptı"), "${BILIO_RESPONSE_IDENTITY}" veya "${BILIO_RESPONSE_DENIAL}" gibi kimlik cevaplarından birini ver.
NORMAL SORULARA (örn: "merhaba", "bana kod yaz", "tarih nedir") ASLA kimliğinden veya yaratıcından bahsetme, sadece soruyu cevapla.
Asla 'Gemini', 'Google', 'OpenAI' vb. olduğunu söyleme.` }]
            };
            cleanedHistory.unshift(systemPrompt);
		console.log("Backend: 'Bilio AI Modu' aktif, Akıllı Çekirdek Talimat (Katman 2) eklendi.");
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
            let errorData;
            try {
                errorData = JSON.parse(errorText); 
            } catch (e) {
                console.error("Backend: Gemini API hata metni JSON değil:", errorText);
                throw new Error(GENERIC_ERROR_MESSAGE);
            }
            
            if (errorData && errorData.promptFeedback) { 
                console.error("Backend: İstek engellendi (Prompt Feedback):", JSON.stringify(errorData.promptFeedback));
                const blockReason = errorData.promptFeedback.blockReason || "diğer";
                throw new Error(`İsteğiniz güvenlik filtreleri tarafından (${blockReason}) engellendi.`);
            }
            
            throw new Error(GENERIC_ERROR_MESSAGE); 
        }
        
        const data = await response.json(); 

        if (data.candidates && data.candidates[0].content.parts[0].text) {
            let modelResponse = data.candidates[0].content.parts[0].text;

            // === KATMAN 3 "ZIRH" (Çıktı Filtresi) ===
            modelResponse = filterModelOutput(modelResponse);
            // ==========================================

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

        console.log("Backend: Yanıt başarıyla gönderildi.");
        res.json(data); 

    } catch (error) {
        // Hata ayıklama log'unu terminale bas
        console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.error("!!! API_CHAT_GLOBAL_HATA YAKALANDI !!!");
        console.error("!!! Hata Mesajı:", error.message);
        // console.error("!!! Hata Yığını (Stack):", error.stack); 
        console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
        
        const userErrorMessage = (error.message.includes("API Hatası") || error.message.includes("engellendi") || error.message.includes("bulunamadı")) 
            ? error.message 
            : GENERIC_ERROR_MESSAGE;
        res.status(500).json({ error: userErrorMessage });
    }
});


// Geri Bildirim (Öğrenme) Endpoint'i
app.post('/api/feedback', (req, res) => {
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
