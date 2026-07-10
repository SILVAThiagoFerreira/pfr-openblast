# Especificação: Integração de Tempos de Detonação no Sistema PFR

**Data:** 2026-04-22  
**Autor:** Sistema PFR  
**Versão:** 1.0  
**Status:** Aprovado pelo usuário

---

## 1. Visão Geral

### 1.1 Propósito
Integrar os tempos de detonação dos furos no plano de fogo gerado pelo sistema PFR, utilizando dados do arquivo `temporização.csv`.

### 1.2 Escopo
- Adicionar processamento do arquivo `temporização.csv` no fluxo existente
- Incluir coluna "Tempo de Detonação" na aba "Dados dos Furos"
- Adicionar estatísticas de temporização na aba "Resumo"
- Manter backward compatibility com execuções existentes

### 1.3 Filosofia de Design
- **SIMPLICIDADE:** Alterações mínimas no código existente
- **COMPATIBILIDADE:** Não quebrar execuções sem `temporização.csv`
- **ROBUSTEZ:** Tratamento adequado de erros e dados faltantes
- **CONFIGURABILIDADE:** Via `config.yaml`

---

## 2. Arquitetura Técnica

### 2.1 Fluxo de Dados Modificado

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   previsto.csv  │    │  realizado.csv  │    │ temporização.csv│
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         └──────────┬───────────┘                      │
                    │                                   │
              ┌─────▼─────┐                            │
              │   Merge   │◄───────────────────────────┘
              └─────┬─────┘
                    │
              ┌─────▼─────┐
              │   Excel   │
              │  Output   │
              └───────────┘
```

### 2.2 Mapeamento de Dados
- **Chave de associação:** `Number` (temporização.csv) ↔ `Nu` (realizado.csv)
- **Dado principal:** `DetonatingTime` → `Tempo_Detonação`
- **Unidade:** milissegundos (ms)

---

## 3. Especificação Funcional

### 3.1 Validação de Entradas

#### 3.1.1 Arquivo temporização.csv
- **Localização padrão:** `data/inputs/temporização.csv`
- **Colunas obrigatórias:** `Number`, `DetonatingTime`
- **Validações:**
  - Arquivo existe e é legível
  - Coluna `Number` contém valores numéricos
  - Coluna `DetonatingTime` contém valores numéricos (inteiros ou floats)
  - Não há valores `NaN` na coluna `Number`

#### 3.1.2 Comportamento de Fallback
- Se arquivo não existir: emitir warning no log e continuar sem a coluna
- Se colunas obrigatórias faltarem: erro crítico → interromper processamento
- Configuração `temporizacao.obrigatorio: false` por padrão para backward compatibility

### 3.2 Processamento

#### 3.2.1 Carregamento e Mapeamento
```python
# Pseudocódigo do processamento
def processar_temporizacao(caminho_csv):
    if not arquivo_existe(caminho_csv):
        log.warning("Arquivo de temporização não encontrado, omitindo coluna")
        return {}
    
    df_temp = pd.read_csv(caminho_csv)
    validar_colunas(df_temp, ['Number', 'DetonatingTime'])
    
    # Criar dicionário de mapeamento
    temporizacao_dict = dict(zip(df_temp['Number'], df_temp['DetonatingTime']))
    
    return temporizacao_dict
```

#### 3.2.2 Integração com Merge
```python
# Durante o merge de previsto.csv + realizado.csv
df_merged['Tempo_Detonacao'] = df_merged['Nu'].map(temporizacao_dict)

# Tratamento de valores faltantes
if config['temporizacao']['valor_padrao_faltante'] is not None:
    df_merged['Tempo_Detonacao'] = df_merged['Tempo_Detonacao'].fillna(
        config['temporizacao']['valor_padrao_faltante']
    )
```

#### 3.2.3 Estatísticas para Resumo
```python
def calcular_estatisticas_temporizacao(df):
    tempos_validos = df['Tempo_Detonacao'].dropna()
    
    if len(tempos_validos) == 0:
        return None
    
    stats = {
        'total_furos_com_tempo': len(tempos_validos),
        'media': tempos_validos.mean(),
        'desvio_padrao': tempos_validos.std(),
        'minimo': tempos_validos.min(),
        'maximo': tempos_validos.max(),
        'tempo_total_sequencia': tempos_validos.max() - tempos_validos.min()
    }
    
    return stats
```

### 3.3 Saída em Excel

#### 3.3.1 Aba "Dados dos Furos"
- **Nova coluna:** `Tempo de Detonação (ms)`
- **Posição:** Após a coluna `r_azimuth`
- **Formatação:**
  - Números com 3 casas decimais
  - Alinhamento à direita
  - Formato numérico padrão
- **Valores especiais:**
  - `0` → "0 ms"
  - `NaN` → célula vazia
  - Outros valores → "[valor] ms"

#### 3.3.2 Aba "Resumo"
```markdown
Estatísticas de Temporização:
--------------------------------
Total de furos com tempo: XX
Média temporal: YYY ms
Desvio padrão: ZZZ ms
Mínimo: AAA ms | Máximo: BBB ms
Tempo total da sequência: CCC ms
Percentual de furos com tempo: DD%
```

### 3.4 Logging e Monitoramento

#### 3.4.1 Mensagens de Log
- **INFO:** "Processando arquivo de temporização: caminho"
- **INFO:** f"Encontrados {n} registros de tempo de detonação"
- **WARNING:** "Arquivo de temporização não encontrado, omitindo coluna"
- **WARNING:** f"{percentual}% dos furos não possuem tempo de detonação"
- **ERROR:** "Coluna 'DetonatingTime' não encontrada no arquivo de temporização"

#### 3.4.2 Métricas de Qualidade
- Percentual de furos com tempo mapeado
- Número de valores `NaN` após mapeamento
- Consistência entre `Number` e `Nu` (valores fora do range esperado)

---

## 4. Configuração

### 4.1 Novas Seções no config.yaml
```yaml
temporizacao:
  # Caminho do arquivo de temporização
  arquivo: "data/inputs/temporização.csv"
  
  # Nomes das colunas no CSV
  coluna_tempo: "DetonatingTime"
  coluna_id: "Number"
  
  # Comportamento
  obrigatorio: false
  valor_padrao_faltante: 0  # ou null para manter NaN
  
  # Formatação
  unidade: "ms"
  casas_decimais: 3
  
  # Validações
  validar_correspondencia: true
  limite_warning_percentual: 20  # % de furos sem tempo para emitir warning
```

### 4.2 Valores Padrão
```python
CONFIG_PADRAO_TEMPORIZACAO = {
    "temporizacao": {
        "arquivo": "data/inputs/temporização.csv",
        "coluna_tempo": "DetonatingTime",
        "coluna_id": "Number",
        "obrigatorio": False,
        "valor_padrao_faltante": 0,
        "unidade": "ms",
        "casas_decimais": 3,
        "validar_correspondencia": True,
        "limite_warning_percentual": 20
    }
}
```

---

## 5. Tratamento de Erros

### 5.1 Cenários de Erro

#### 5.1.1 Arquivo Não Encontrado
- **Severidade:** Warning (se `obrigatorio: false`), Error (se `obrigatorio: true`)
- **Ação:** Continuar sem a coluna ou interromper processamento
- **Mensagem:** "Arquivo de temporização não encontrado em [caminho]"

#### 5.1.2 Coluna Faltante
- **Severidade:** Error
- **Ação:** Interromper processamento
- **Mensagem:** "Coluna '[nome]' não encontrada no arquivo de temporização"

#### 5.1.3 Tipos de Dado Incorretos
- **Severidade:** Warning
- **Ação:** Converter quando possível, senão definir como `NaN`
- **Mensagem:** f"{n} valores não numéricos na coluna DetonatingTime"

#### 5.1.4 Baixa Correspondência
- **Severidade:** Warning (acima do limite configurado)
- **Ação:** Continuar processamento
- **Mensagem:** f"Apenas {percentual}% dos furos possuem tempo de detonação"

### 5.2 Fallbacks e Recovery
1. **Fallback principal:** Omitir coluna se arquivo não existir/configurado como opcional
2. **Fallback secundário:** Usar `valor_padrao_faltante` para valores `NaN`
3. **Recovery:** Backup automático dos inputs inclui `temporização.csv` se existir

---

## 6. Testes e Validação

### 6.1 Casos de Teste

#### 6.1.1 Cenário Ideal
- **Inputs:** `previsto.csv`, `realizado.csv`, `temporização.csv` completo
- **Expectativa:** Coluna preenchida, estatísticas no resumo
- **Métrica:** 100% de correspondência

#### 6.1.2 Arquivo Ausente
- **Inputs:** Sem `temporização.csv`, `obrigatorio: false`
- **Expectativa:** Sem coluna, sem erros
- **Métrica:** Warning no log, processamento normal

#### 6.1.3 Correspondência Parcial
- **Inputs:** `temporização.csv` com apenas 50% dos furos
- **Expectativa:** Coluna com valores e `NaN`, warning no log
- **Métrica:** Estatísticas apenas sobre valores válidos

#### 6.1.4 Tipos de Dado Inválidos
- **Inputs:** `DetonatingTime` com strings
- **Expectativa:** Conversão quando possível, `NaN` quando não
- **Métrica:** Warning com contagem de conversões falhas

### 6.2 Critérios de Aceitação
1. ✅ Sistema funciona sem `temporização.csv` (backward compatibility)
2. ✅ Coluna "Tempo de Detonação" aparece corretamente no Excel
3. ✅ Estatísticas aparecem no resumo quando dados disponíveis
4. ✅ Logs informativos para todos os cenários
5. ✅ Configuração via `config.yaml` funcionando

---

## 7. Considerações de Implementação

### 7.1 Modificações no Código Existente

#### 7.1.1 Arquivos a Modificar
1. **gerar_plano.py**
   - Adicionar função `processar_temporizacao()`
   - Modificar função de merge para incluir mapeamento
   - Atualizar geração do Excel (coluna + resumo)
   - Atualizar `carregar_configuracao()` com defaults

2. **config.yaml**
   - Adicionar seção `temporizacao`

3. **AGENTS.md**
   - Atualizar documentação com nova funcionalidade

#### 7.1.2 Ordem de Implementação
1. Adicionar configuração padrão
2. Implementar carregamento e validação
3. Implementar mapeamento durante merge
4. Implementar saída no Excel
5. Implementar estatísticas no resumo
6. Atualizar documentação
7. Testar todos os cenários

### 7.2 Dependências
- **Nenhuma nova dependência:** usa `pandas` já existente
- **Compatibilidade:** Python 3.8+ (igual ao sistema atual)
- **Performance:** Impacto mínimo (operações `O(n)`)

---

## 8. Próximos Passos

### 8.1 Imediatos (Após Aprovação)
1. Criar plano de implementação detalhado
2. Implementar funcionalidade
3. Testar com dados reais
4. Atualizar documentação

### 8.2 Futuros (Opcionais)
1. Suporte a múltiplos formatos de temporização
2. Visualização gráfica da sequência temporal
3. Análise de padrões de detonação
4. Integração com relatórios de segurança

---

## 9. Aprovações

| Data | Aprovador | Status | Observações |
|------|-----------|--------|-------------|
| 2026-04-22 | Usuário | ✅ Aprovado | Design apresentado e aprovado |

---

## 10. Histórico de Revisões

| Versão | Data | Autor | Mudanças |
|--------|------|-------|----------|
| 1.0 | 2026-04-22 | Sistema PFR | Especificação inicial |

---

**Fim da Especificação**