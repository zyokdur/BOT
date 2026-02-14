require('dotenv').config();
const axios = require('axios');

const key = process.env.GEMINI_API_KEY;
console.log('API Key:', key ? key.substring(0, 15) + '...' : 'MISSING');

async function test() {
    try {
        // Try multiple models
        const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
        for (const model of models) {
            try {
                console.log('Trying model:', model);
                const res = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
                    { contents: [{ parts: [{ text: 'Merhaba, 1+1 kac eder? Sadece sayiyi yaz.' }] }] },
                    { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
                );
                const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                console.log(`SUCCESS with ${model}:`, text);
                return;
            } catch (e2) {
                console.log(`${model} ERROR:`, e2.response?.status, (e2.response?.data?.error?.message || e2.message).substring(0, 120));
            }
        }
        console.log('All models failed');
        return;
        // original code below (unreachable)
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
            { contents: [{ parts: [{ text: 'Merhaba, 1+1 kac eder? Sadece sayiyi yaz.' }] }] },
            { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
        );
        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log('SUCCESS! Response:', text);
    } catch (e) {
        console.log('ERROR:', e.response?.status, e.response?.data?.error?.message || e.message);
    }
}

test();
