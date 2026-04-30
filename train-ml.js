// train-ml.js - Alimenta ML com dados históricos
const fs = require('fs');
const axios = require('axios');

async function trainWithHistoricalData() {
    const memoryPath = 'agent-memory.json';
    if (!fs.existsSync(memoryPath)) {
        console.log('⚠️ Nenhum agent-memory.json encontrado.');
        return;
    }

    const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
    
    console.log(`📊 Treinando ML com ${memory.failures.length} falhas e ${memory.examples.length} sucessos`);
    
    // Enviar exemplos de sucesso
    for (const example of memory.examples) {
        try {
            // O ML service espera actions como array no learn-success
            await axios.post('http://localhost:8000/learn-success', {
                task: example.task,
                actions: example.actions,
                final_state: { success: true }
            });
            console.log(`✅ Sucesso enviado: ${example.task.slice(0, 50)}...`);
        } catch(e) {
            console.log(`⚠️ Erro ao enviar sucesso: ${e.message}`);
        }
    }
    
    // Enviar exemplos de falha
    for (const failure of memory.failures) {
        try {
            await axios.post('http://localhost:8000/learn-failure', {
                error: failure.error,
                action: failure.action,
                task: failure.task
            });
            console.log(`❌ Falha enviada: ${failure.error.slice(0, 50)}...`);
        } catch(e) {
            console.log(`⚠️ Erro ao enviar falha: ${e.message}`);
        }
    }
    
    console.log('✅ Treinamento concluído!');
    
    // Verificar estatísticas
    try {
        const stats = await axios.get('http://localhost:8000/model-stats');
        console.log('📈 Estatísticas do modelo:', stats.data);
    } catch(e) {
        console.log('⚠️ Não foi possível obter estatísticas');
    }
}

trainWithHistoricalData();
