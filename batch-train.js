const fs = require('fs');
const axios = require('axios');

async function batchTrain() {
    // Carregar memória atual
    const memory = JSON.parse(fs.readFileSync('agent-memory.json', 'utf-8'));
    
    console.log(`📊 Treinando em lote com ${memory.examples.length} sucessos e ${memory.failures.length} falhas...`);
    
    // Enviar sucessos
    for (const example of memory.examples) {
        try {
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
    
    // Enviar falhas
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
    
    console.log('✅ Treinamento em lote concluído!');
    
    // Ver estatísticas
    try {
        const stats = await axios.get('http://localhost:8000/model-stats');
        console.log('📈 Estatísticas:', stats.data);
    } catch(e) {
        console.log('⚠️ Não foi possível obter estatísticas');
    }
}

batchTrain();
