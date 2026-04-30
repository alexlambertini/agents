const fs = require('fs');
const axios = require('axios');

async function addTrainingData() {
    // Carregar novos exemplos
    const newData = JSON.parse(fs.readFileSync('novos-exemplos.json', 'utf-8'));
    
    console.log(`📊 Adicionando ${newData.examples.length} novos exemplos...`);
    
    for (const example of newData.examples) {
        try {
            await axios.post('http://localhost:8000/learn-success', {
                task: example.task,
                actions: example.actions,
                final_state: { success: true }
            });
            console.log(`✅ Exemplo adicionado: ${example.task}`);
        } catch(e) {
            console.log(`❌ Erro: ${e.message}`);
        }
    }
    
    // Ver estatísticas
    try {
        const stats = await axios.get('http://localhost:8000/model-stats');
        console.log('📈 Novas estatísticas:', stats.data);
    } catch(e) {
        console.log('⚠️ Não foi possível obter estatísticas');
    }
}

addTrainingData();
