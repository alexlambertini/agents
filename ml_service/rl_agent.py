import numpy as np
from collections import defaultdict
import json
from typing import List, Dict, Any

class RLActionOptimizer:
    """
    Agente de Reinforcement Learning usando Q-Learning
    Aprende qual ação tomar baseado no contexto e recompensa
    """
    
    def __init__(self, learning_rate=0.1, discount_factor=0.95, epsilon=0.1):
        self.q_table = defaultdict(lambda: defaultdict(float))
        self.lr = learning_rate
        self.gamma = discount_factor
        self.epsilon = epsilon
        self.action_history = []
        
        # Ações possíveis
        self.actions = ['read_file', 'write_file', 'apply_patch', 'run_cmd']
    
    def get_state(self, error: str, task: str, last_action: Dict) -> str:
        """Converte contexto em estado discreto para Q-learning"""
        
        features = []
        
        # 1. Tipo de erro
        error_lower = error.lower()
        if 'syntax' in error_lower or 'unexpected' in error_lower:
            features.append('syntax_error')
        elif 'nil' in error_lower or 'panic' in error_lower:
            features.append('runtime_error')
        elif 'cannot find' in error_lower or 'module' in error_lower:
            features.append('dependency_error')
        else:
            features.append('unknown_error')
        
        # 2. Última ação
        last_action_name = last_action.get('name', 'none')
        features.append(f'last_action_{last_action_name}')
        
        # 3. Fase da tarefa
        if 'criar' in task or 'create' in task:
            features.append('creation_phase')
        elif 'adicionar' in task or 'add' in task:
            features.append('addition_phase')
        elif 'corrigir' in task or 'fix' in task:
            features.append('fixing_phase')
        else:
            features.append('general_phase')
        
        # 4. Número de tentativas
        attempts = len(self.action_history)
        if attempts < 3:
            features.append('early_attempts')
        elif attempts < 7:
            features.append('mid_attempts')
        else:
            features.append('late_attempts')
        
        return '|'.join(features)
    
    async def suggest_action(self, error: str, task: str, last_action: Dict, similar_cases: List) -> Dict:
        """Sugere ação baseada na política atual"""
        
        state = self.get_state(error, task, last_action)
        
        # Exploration vs Exploitation
        if np.random.random() < self.epsilon:
            # Exploração
            action = np.random.choice(self.actions)
            confidence = 0.3
        else:
            # Exploitation
            q_values = self.q_table[state]
            if not q_values:
                return await self._similarity_based_suggestion(similar_cases)
            
            best_action = max(q_values.items(), key=lambda x: x[1])[0]
            action = best_action
            confidence = min(0.9, max(q_values.values()) / 10.0)
        
        # Registrar histórico
        self.action_history.append({
            'state': state,
            'action': action,
            'error': error[:100]
        })
        
        # Limitar histórico
        if len(self.action_history) > 100:
            self.action_history = self.action_history[-100:]
        
        return {
            'recommended_action': action,
            'confidence': confidence,
            'q_value': float(self.q_table[state].get(action, 0)),
            'state': state
        }
    
    async def _similarity_based_suggestion(self, similar_cases: List) -> Dict:
        """Sugestão baseada em casos similares"""
        if not similar_cases:
            return {
                'recommended_action': 'read_file',
                'confidence': 0.4,
                'q_value': 0.0,
                'state': 'similarity_based'
            }
        
        action_counts = defaultdict(int)
        for case in similar_cases:
            action = case.get('action_taken', 'read_file')
            action_counts[action] += 1
        
        if action_counts:
            best_action = max(action_counts.items(), key=lambda x: x[1])[0]
            confidence = action_counts[best_action] / len(similar_cases)
            
            return {
                'recommended_action': best_action,
                'confidence': confidence,
                'q_value': 0.0,
                'state': 'similarity_based'
            }
        
        return {
            'recommended_action': 'read_file',
            'confidence': 0.3,
            'q_value': 0.0,
            'state': 'default'
        }
    
    def add_reward(self, actions: List[Dict], reward: float):
        """Adiciona recompensa após sequência de ações"""
        
        for i in range(len(actions) - 1, -1, -1):
            action_data = actions[i]
            state = self.get_state(
                action_data.get('error', ''),
                action_data.get('task', ''),
                action_data.get('last_action', {})
            )
            action_name = action_data.get('name', 'read_file')
            
            # Calcular max Q para próximo estado
            next_state = self.get_state(
                actions[i+1].get('error', '') if i+1 < len(actions) else '',
                actions[i+1].get('task', '') if i+1 < len(actions) else '',
                actions[i+1] if i+1 < len(actions) else {}
            ) if i+1 < len(actions) else state
            
            max_next_q = max(self.q_table[next_state].values()) if self.q_table[next_state] else 0
            
            # Q-learning update
            current_q = self.q_table[state][action_name]
            new_q = current_q + self.lr * (reward + self.gamma * max_next_q - current_q)
            self.q_table[state][action_name] = new_q
    
    def q_table_size(self) -> int:
        """Retorna tamanho da Q-table"""
        return sum(len(q_vals) for q_vals in self.q_table.values())
    
    def save(self, path: str = "data/models/rl_q_table.json"):
        """Salva Q-table"""
        q_table_serializable = {
            state: dict(actions) 
            for state, actions in self.q_table.items()
        }
        with open(path, 'w') as f:
            json.dump(q_table_serializable, f)
    
    def load(self, path: str = "data/models/rl_q_table.json"):
        """Carrega Q-table"""
        try:
            with open(path, 'r') as f:
                q_table_data = json.load(f)
            for state, actions in q_table_data.items():
                self.q_table[state] = defaultdict(float, actions)
        except FileNotFoundError:
            print("Nenhum modelo RL encontrado, começando do zero")
