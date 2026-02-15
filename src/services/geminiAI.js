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

    // Sadece puan/yorum sahibi rakip başlıklarını öncelikle göster
    const competitorSamples = competitorTitles
        .slice(0, 10)
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n');

    const trendyolKws = (trendyolSearchKeywords || []).slice(0, 15).join(', ');

    const prompt = `Sen bir Trendyol ürün başlığı SEO uzmanısın. Mevcut başlığı analiz et, rakiplerin başlıklarındaki anahtar kelimeleri incele ve SEO'ya uygun yeni bir başlık oluştur.

KRİTİK KURALLAR:
1. Çıktı SADECE yeni başlık olacak — açıklama, not, alternatif YOK
2. Başlık MUTLAKA 60-120 karakter arasında olmalı (kısa veya uzun OLMASIN)
3. Marka adı "${brand || 'Yok'}" YAZMA — Trendyol otomatik ekler
4. Kategori adı "${categoryName || 'Yok'}" başlığa YAZMA — Trendyol otomatik ekler
5. Ürünü tam tanımlayan anahtar kelimeler kullan: malzeme, renk, boyut, adet, kullanım alanı
6. Rakip başlıklarında ortak olan ve ürünle ilgili kelimeleri MUTLAKA dahil et
7. Her kelimenin baş harfi büyük olsun
8. Özel karakter (!@#$%^&*) kullanma
9. Kelime tekrarı olmasın
10. Rakip başlıkları referans al ama birebir kopyalama

MEVCUT BAŞLIK: "${productTitle}"
KATEGORİ: ${categoryName || 'Belirtilmemiş'}
MARKA: ${brand || 'Belirtilmemiş'}

TRENDYOL ARAMA VERİLERİ (kullanıcıların aradığı kelimeler):
${trendyolKws || 'Veri yok'}

KATEGORİDE EN ÇOK KULLANILAN ANAHTAR KELİMELER:
${popularKws || 'Yok'}

TRENDYOL'DAKİ EN ÇOK SATAN RAKİPLERİN BAŞLIKLARI:
${competitorSamples || 'Yok'}

ÖNEMLİ: Çıktın SADECE tek satır optimize edilmiş başlık olacak. Bu başlık 60-120 karakter arası olacak. Başka hiçbir şey yazma.`;

    try {
        const response = await axios.post(`${GEMINI_API_URL}?key=${apiKey}`, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.5,
                maxOutputTokens: 300,
                topP: 0.85,
                topK: 40
            }
        }, {
            timeout: 20000,
            headers: { 'Content-Type': 'application/json' }
        });

        let text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            // Tırnak ve fazlalıkları temizle
            text = text.trim()
                .replace(/^["'`]+|["'`]+$/g, '')
                .replace(/\n/g, ' ')
                .replace(/\*+/g, '')
                .replace(/^(Önerilen Başlık|Başlık|Optimize Edilmiş Başlık)[:\s]*/i, '')
                .replace(/\s{2,}/g, ' ')
                .trim();

            // Eğer çok kısaysa (30 karakter altı) büyük ihtimalle hatalı — dönme
            if (text.length < 30) {
                console.warn(`Gemini AI çok kısa başlık döndü (${text.length} kar): "${text}"`);
                return null;
            }
            // 150 karakterden uzunsa kes
            if (text.length > 150) {
                const words = text.split(' ');
                text = '';
                for (const w of words) {
                    if ((text + ' ' + w).trim().length > 120) break;
                    text = (text + ' ' + w).trim();
                }
            }
            return text;
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
