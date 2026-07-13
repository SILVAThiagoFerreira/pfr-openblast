# PIPELINE

1. Carregar configuração.
2. Resolver caminhos absolutos.
3. Descobrir arquivos de entrada em `input/`.
4. Validar presença e colunas mínimas.
5. Gerar backup dos insumos.
6. Resolver ID do plano conforme `config.yaml`; quando houver risco de capturar ID de detonador, usar `business.fallback_plan_id`. Variações equivalentes apenas por zero à esquerda devem ser tratadas como o mesmo plano.
7. Extrair data e hora do disparo pelo primeiro `[Fire]` posterior ao `[BlastingPlan]` que contém o plano resolvido, considerando a equivalência de IDs com e sem zero à esquerda.
8. Ler o projeto e o realizado.
9. Mesclar os dados pelo `Number`.
10. Preencher `DetonatingTime` vazio por sequência determinística e única, quando habilitado, sem criar tempos repetidos novos.
11. Redistribuir cargas zeradas quando configurado, preservando o total alvo e os extremos da coluna.
12. Fechar o total de `cargas realizadas` ao alvo configurado quando `business.enforce_charge_total_target` estiver habilitado, preservando o menor e o maior valor da coluna.
13. Aplicar simulação determinística de variação em `tampao realizado` quando configurada e exportar `tampao previsto` / `tampao realizado` com uma casa decimal.
14. Montar a tabela final de saída.
15. Montar o resumo.
16. Exportar o Excel.
17. Registrar log da execução.

### Modo online incremental
As seleções sucessivas são acumuladas em memória, com deduplicação por nome, tamanho e data de modificação. A remoção atualiza imediatamente o conjunto submetido. Antes de escolher o evento do HISTO, o pipeline coleta IDs candidatos dos nomes e das primeiras linhas das tabelas e cruza-os com o bloco de plano usando normalização de zeros à esquerda e separadores.
