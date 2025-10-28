// server.js (v19 - Efe Modu Geliştirildi + Hata Düzeltildi)
console.log("server.js (v19) çalışmaya başladı.");

// Gerekli paketleri içeri aktar
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const path = require('path');
const { google } = require('googleapis'); // Google Arama için
const { createWorker } = require('tesseract.js'); // Resimden Metin Okuma

// .env dosyasındaki değişkenleri yükle
dotenv.config();

// Express uygulamasını oluştur
const app = express();
const port = 3000; 

app.use(express.json({ limit: '10mb' })); 

// === API Anahtarlarını Yükle ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID;

// Google Arama servisini hazırla
let customsearch;
if (GOOGLE_SEARCH_API_KEY && GOOGLE_CSE_ID) {
    customsearch = google.customsearch('v1'); 
    console.log("Google Arama servisi yüklendi.");
} else {
    console.warn("Google Arama API anahtarları bulunamadı. İnternet araması devre dışı.");
}

// =========================================================
// === Gelişmiş Kimlik ve Cevap Fonksiyonu (v19 - Efe Modu) ===
// =========================================================
function getCustomResponse(message, isEfeMode = false) { 
    if (!message) return null; 
    const lowerMessage = message.toLowerCase();

    // === EFE MODU KİMLİK KONTROLÜ ===
    if (isEfeMode) {
        // Kural E1: "Adın ne? / Sen kimsin?"
        const efeIdentity = ['kimsin', 'adın ne', 'sen kimsin', 'nesin sen'];
        if (efeIdentity.some(kw => lowerMessage.includes(kw))) {
            return "Ben Efe, sesli asistanınız.";
        }
        // Kural E2: "Adın neden Efe?"
        const efeOrigin = ['adın neden efe', 'neden efe', 'efe kim', 'ismin nereden geliyor'];
        if (efeOrigin.some(kw => lowerMessage.includes(kw))) {
            return "Adım Efe, çünkü beni geliştiren Berke Nazlıgüneş'in kardeşinin adı Efe. Geliştiricim, bu sesli moda onun adını verdi.";
        }
        // Kural E3: "Bilio AI kim?"
        if (lowerMessage.includes('bilio ai')) {
            return "Bilio AI benim metin tabanlı versiyonum. Ben ise sesli asistan Efe'yim.";
        }
    }

    // === BILIO AI KİMLİK KONTROLÜ (Tüm modlar için) ===
    
    // Kural 1: "Seni Türkler mi yaptı?" (Köken)
    const originKeywords = [
        'türk müsün', 'türk mü yaptı', 'seni türkler mi yaptı', 'nerelisin', 
        'yerli misin', 'türkiye', 'hangi millet', 
        'hangi ülke', 'hangi coğrafyada', 'abd', 'amerika', 'yabancı mısın',
        'menşei', 'üretim yerin', 'nerede üretildin'
    ];
    if (originKeywords.some(kw => lowerMessage.includes(kw))) {
        return "Evet, ben Türk yazılım mühendisi Berke Nazlıgüneş tarafından (Spark önderliğinde) sıfırdan kodlandım. Bir Türk yazılım projesiyim.";
    }

    // Kural 2: "Spark kimdir?" (Yaratıcı)
    const sparkKeywords = [
        'spark kimdir', 'spark kim', 'spark nedir', 'yaratıcın kim', 'sahibin kim', 
        'developerın kim', 'kim yaptı', 'kim kodladı', 'kim yarattı', 'kim eğitti', 
        'kimin eserisin', 'seni kim geliştirdi', 'berke nazlıgüneş'
    ];
    if (sparkKeywords.some(kw => lowerMessage.includes(kw))) {
        return "Beni, Türk yazılım mühendisi Berke Nazlıgüneş (Spark önderliğinde) geliştirdi. Ben Bilio AI'yım.";
    }

    // Kural 3: Diğer AI/Şirket isimleri (Rakipler/Teknoloji)
    const competitorKeywords = [
        'gemini', 'google', 'openai', 'chatgpt', 'gpt-3', 'gpt-4', 'gpt', 'apple', 
        'microsoft', 'claude', 'anthropic', 'siri', 'alexa', 'copilot', 'lamda', 'bard',
        'llama', 'meta', 'facebook', 'amazon', 'ibm', 'watson', 'deepmind'
    ];
    if (competitorKeywords.some(kw => lowerMessage.includes(kw))) {
        return "Hayır, ben o teknolojiye ait değilim. Ben, Spark önderliğindeki bir Türk yazılım ekibi tarafından geliştirilen Bilio AI'yım.";
    }
    
    // Kural 4: Basit kimlik soruları (Efe modunda değilken)
    const identityKeywords = ['kimsin', 'adın ne', 'sen kimsin', 'nesin sen', 'sen bir bot musun', 'yapay zeka mısın'];
    if (!isEfeMode && identityKeywords.some(kw => lowerMessage.includes(kw))) {
        return "Ben Bilio AI! Spark tarafından geliştirilen bir yapay zeka asistanıyım.";
    }
    
    // Kural 5: Ne yapabilirsin? (Kimliğini pekiştir)
    const capabilityKeywords = ['ne yapabilirsin', 'yeteneğin ne', 'neler yaparsın', 'özelliklerin ne', 'ne işe yararsın'];
    if (capabilityKeywords.some(kw => lowerMessage.includes(kw))) {
         return "Ben Bilio AI. Spark tarafından geliştirildim. Sana bilgi sağlayabilir, kod yazmana yardımcı olabilir ve internetten güncel verileri çekebilirim.";
    }

    // Kural 6: Teknik Altyapı Soruları (API, Model, Sunucu vb.)
    const techKeywords = [
        'api', 'apin ne', 'abin ne', 
        'hangi modeli kullanıyorsun', 'modelin ne', 'model',
        'altyapı', 'sunucu', 'teknolojin ne',
        'nasıl çalışıyorsun', 'hangi dilde kodlandın', 'programlama dilin'
    ];
    if (techKeywords.some(kw => lowerMessage.includes(kw))) {
        return "Ben, Spark ekibi tarafından geliştirilen tescilli bir yazılım mimarisi üzerinde çalışıyorum. Teknik detaylarım gizlidir, ancak sana yardımcı olmak için buradayım!";
    }
    return null; 
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

// === Arama Gerekip Gerekmediğini Kontrol Et (HATA DÜZELTİLDİ) ===
function isSearchQuery(text, isEfeMode = false) {
    const keywords = ['kaçta', 'nedir', 'kimdir', 'bugün', 'son dakika', 'fiyatı', 'ne kadar', 'hava durumu'];
    const lowerText = text ? text.toLowerCase() : ""; 
    
    // Efe modundaysa veya 3 kelimeden kısaysa arama yapma
    if (isEfeMode || (lowerText.split(' ').length < 3 && !keywords.some(kw => lowerText.includes(kw)))) { 
        return false;
    }
    if (getCustomResponse(text, isEfeMode)) { return false; } 

    // HATA BURADAYDI: 'lowerMessage' yerine 'lowerText' olmalı
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


// === GÜNCELLENMİŞ: API Endpoint'i (Efe Modu Destekli) ===
app.post('/api/chat', async (req, res) => {
    console.log("Backend: /api/chat (generateContent) isteği alındı."); 
    let chatHistory = req.body.contents; 
    const modelName = req.body.model; 
    const imageData = req.body.image; 
    const isConversationMode = req.body.isConversationMode; // YENİ: Efe modu bayrağı
    
    const apiKey = GEMINI_API_KEY; 
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const GENERIC_ERROR_MESSAGE = "Şu anda bir sorun yaşıyorum. Lütfen biraz sonra tekrar dener misin?";

    if (!apiKey) return res.status(500).json({ error: GENERIC_ERROR_MESSAGE });

    try {
        const lastUserMessage = chatHistory[chatHistory.length - 1];
        let lastPromptText = lastUserMessage.parts[0].text;
        
        console.log("KULLANICI SORDU (Orijinal):", lastPromptText);
        
        // === Resim Varsa Oku ve Prompta Ekle ===
        if (imageData && imageData.base64Data) {
            console.log("Backend: Resim verisi algılandı. Tesseract.js ile metin okunuyor...");
            const imageText = await analyzeImage(imageData.base64Data, imageData.mimeType);
            lastPromptText = `[Resimdeki Metin: ${imageText}] ${lastPromptText}`;
            console.log("Backend: Gemini'ye gönderilecek birleştirilmiş prompt:", lastPromptText);
            chatHistory[chatHistory.length - 1].parts[0].text = lastPromptText;
        }
        // =================================================
        
        // === KİMLİK KORUMASI ===
        // YENİ: Efe modu bayrağını kimlik kontrolüne gönder
        const specialResponseCheck = getCustomResponse(lastPromptText, isConversationMode);
        if (specialResponseCheck) {
            console.log("Backend: Kimlik Koruması - Özel cevap bulundu, API'ye gidilmiyor.");
            return res.json({
                candidates: [{ content: { parts: [{ text: specialResponseCheck }], role: "model" } }]
            });
        }
        // ===================================================
        
        // === İnternet Arama Mantığı (Sadece resim yoksa ve Efe modunda değilse çalışır) ===
        if (!imageData && customsearch && isSearchQuery(lastPromptText, isConversationMode)) {
            const searchResults = await runWebSearch(lastPromptText);
            if (searchResults) { 
                const contextMessage = {
                    role: "user", 
                    parts: [{ text: `Aşağıdaki soruyu cevaplamak için bu internet arama sonuçlarını (context) kullan: "${searchResults}"` }]
                };
                chatHistory.splice(chatHistory.length - 1, 0, contextMessage);
                console.log("Backend: Arama sonuçları sohbete eklendi.");
            } else {
                 console.log("Backend: Arama başarısız oldu veya sonuç yok, arama adımı atlanıyor.");
            }
        }
        // ==========================

        // === 'id' alanını temizle ===
        const cleanedHistory = chatHistory.map(msg => ({
            role: msg.role,
            parts: msg.parts
        }));
        // =========================================================

        // === YENİ: Efe Modu için Gelişmiş Talimat Ekle ===
        if (isConversationMode) {
            const systemPrompt = {
                role: "user", // 'system' rolü v1beta'da yok, 'user' olarak ekliyoruz
                parts: [{ text: "GİZLİ TALİMAT: Sen Efe adında bir Türk sesli asistanısın. Adın Efe. Sana 'efe' diye hitap edilebilir (örn: 'nasılsın efe'). Asla bir yapay zeka, model veya Bilio AI olduğunu söyleme. Bir insan gibi, birinci şahısla ('ben') konuş. Cevapların her zaman ÇOK KISA, net ve öz olsun. Unutma adın Efe." }]
            };
            cleanedHistory.unshift(systemPrompt); // Sohbetin en başına talimatı ekle
            console.log("Backend: 'Efe Modu' aktif, gizli talimat eklendi.");
        }
        // =========================================================

        console.log(`Backend: Gemini API'sine (generateContent) istek gönderiliyor (${modelName})...`);
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({ contents: cleanedHistory }), 
        });
        
        console.log("Backend: Gemini API yanıt durumu:", geminiResponse.status);
        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error("Backend: Gemini API Hatası:", errorText); 
            throw new Error(GENERIC_ERROR_MESSAGE); 
        }
        
        const data = await geminiResponse.json();

        // Gemini -> Bilio / Google -> Spark DEĞİŞİKLİĞİ
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content.parts[0].text) {
            let modelResponse = data.candidates[0].content.parts[0].text;
            modelResponse = modelResponse.replace(/Gemini/gi, "Bilio");
            modelResponse = modelResponse.replace(/Google/gi, "Spark");
            data.candidates[0].content.parts[0].text = modelResponse;
        } else {
            console.warn("Backend: Gemini'den cevap alındı ancak 'candidates' alanı boş.");
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
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Sunucuyu dinlemeye başla
console.log("app.listen çağrılmak üzere..."); 
app.listen(port, () => {
    console.log(`Backend sunucusu http://localhost:${port} adresinde çalışıyor`);
    console.log(`Uygulamayı açmak için tarayıcınızda http://localhost:${port} adresini ziyaret edin.`);
});