const axios = require('axios');

// Google Gemini AI Service
// Ücretsiz API: https://aistudio.google.com/app/apikey adresinden key alınır

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function generateTitleSuggestion(productTitle, categoryName, brand, popularKeywords, competitorTitles, trendyolSearchKeywords) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const popularKws = popularKeywords
        .filter(k => !k.inYourTitle)
        .slice(0, 15)
        .map(k => k.word)
        .join(', ');

    const competitorSamples = competitorTitles
        .slice(0, 5)
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n');

    const trendyolKws = (trendyolSearchKeywords || []).slice(0, 10).join(', ');

    const prompt = `Sen bir Trendyol ürün başlığı uzmanısın. Aşağıdaki ürün başlığını Trendyol SEO kurallarına göre optimize et.

ÖNEMLİ KURALLAR:
- Marka adı ("${brand || 'Yok'}") başlığa YAZILMAMALI — Trendyol bunu otomatik ekler
- Kategori adı ("${categoryName || 'Yok'}") başlığa YAZILMAMALI — Trendyol bunu otomatik ekler  
- Başlık 60-120 karakter olmalı
- Sadece ürünle DOĞRUDAN İLGİLİ kelimeler kullan
- Ürünü tanımlayan kelimeler kullan (malzeme, renk, boyut, kullanım alanı, adet bilgisi)
- ALAKASIZ kelimeler EKLEME — ürünle ilgisi olmayan kelime olmasın
- Özel karakter kullanma (!@#$%^&*)
- Her kelimenin baş harfi büyük olsun
- Tekrar eden kelime olmasın
- Rakip başlıkları REFERANS al ama birebir KOPYALAMA

MEVCUT BAŞLIK: "${productTitle}"
KATEGORİ: ${categoryName || 'Belirtilmemiş'}
MARKA: ${brand || 'Belirtilmemiş'}

TRENDYOL'DA EN ÇOK ARANAN İLGİLİ KELİMELER (organik arama verileri):
${trendyolKws || 'Veri yok'}

KATEGORİDEKİ POPÜLER ANAHTAR KELİMELER:
${popularKws || 'Yok'}

TRENDYOL'DAKİ EN ÇOK SATAN RAKİP BAŞLIKLARI:
${competitorSamples || 'Yok'}

Sadece optimize edilmiş başlığı yaz, başka açıklama yapma. Tek satır olsun.`;

    try {
        const response = await axios.post(`${GEMINI_API_URL}?key=${apiKey}`, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 200,
                topP: 0.9
            }
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            // Tırnak ve fazlalıkları temizle
            return text.trim().replace(/^["']|["']$/g, '').replace(/\n/g, ' ').trim();
        }
        return null;
    } catch (error) {
        console.error('Gemini AI hatasi:', error.response?.data?.error?.message || error.message);
        return null;
    }
}

async function analyzeProductWithAI(productTitle, categoryName, brand, salePrice, competitorData) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const prompt = `Sen bir Trendyol e-ticaret uzmanısın. Aşağıdaki ürünü analiz et ve kısa, öz öneriler ver.

ÜRÜN: "${productTitle}"
KATEGORİ: ${categoryName || 'Belirtilmemiş'}
MARKA: ${brand || 'Belirtilmemiş'}
FİYAT: ₺${salePrice}
${competitorData ? `ORTALAMA RAKİP FİYATI: ₺${competitorData.avgPrice}
RAKİP SAYISI: ${competitorData.count}` : ''}

Şu konularda 2-3 cümlelik öneriler ver (Türkçe):
1. 📦 Ürün Konumlandırma: Bu ürün pazarda nasıl konumlanmalı?
2. 💰 Fiyatlandırma: Fiyat stratejisi ne olmalı?
3. 🔍 Görünürlük: Satışı artırmak için ne yapılabilir?

JSON formatında yanıtla:
{"positioning": "...", "pricing": "...", "visibility": "..."}`;

    try {
        const response = await axios.post(`${GEMINI_API_URL}?key=${apiKey}`, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 500,
                topP: 0.9
            }
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            // JSON parse etmeye çalış
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        }
        return null;
    } catch (error) {
        console.error('Gemini AI analiz hatasi:', error.response?.data?.error?.message || error.message);
        return null;
    }
}

function isConfigured() {
    return !!process.env.GEMINI_API_KEY;
}

module.exports = {
    generateTitleSuggestion,
    analyzeProductWithAI,
    isConfigured
};
