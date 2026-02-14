const axios = require('axios');

async function test() {
    try {
        console.log('Testing research API...');
        const res = await axios.post('http://localhost:3000/api/trendyol/research', {
            barcode: 'TK-135798WC',
            title: 'Silikon Deterjan Hazneli Tuvalet Firca Seti - Yeni Nesil Klozet ve WC Temizlik Fircasi',
            salePrice: 433.85,
            categoryName: 'Banyo Aksesuari',
            brand: 'TK',
            costPrice: 50
        }, { timeout: 30000 });

        const d = res.data.data;
        console.log('Success:', res.data.success);
        console.log('Score:', d.titleAnalysis.score, d.titleAnalysis.scoreLabel);
        console.log('Suggested Title:', d.titleAnalysis.suggestedTitle || 'YOK');
        console.log('AI Title:', d.aiSuggestedTitle || 'YOK');
        console.log('AI Analysis:', d.aiAnalysis ? JSON.stringify(d.aiAnalysis).substring(0, 150) : 'YOK');
        console.log('AI Enabled:', d.aiEnabled);
        console.log('BreakEven:', d.competitorAnalysis.breakEvenPrice || 'YOK');
        console.log('Trendyol Search:', JSON.stringify(d.trendyolSearch).substring(0, 150));
    } catch (e) {
        console.log('ERR:', e.response?.data?.error || e.message);
    }
}

test();
