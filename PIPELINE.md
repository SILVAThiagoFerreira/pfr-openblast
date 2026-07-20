# PIPELINE

1. Carregar configuração.
2. Resolver caminhos absolutos.
3. Descobrir arquivos de entrada em `input/`.
4. Validar presença e colunas mínimas.
5. Gerar backup dos insumos.
6. Resolver ID do plano conforme `config.yaml`; quando houver risco de capturar ID de detonador, usar `business.fallback_plan_id`. Interpretar o ID como `PLANO;MÊS;ANO`: comparar o mesmo plano e ano, ignorando o mês para permitir que a emissão e a detonação ocorram em meses diferentes.
7. Extrair data e hora do disparo pelo primeiro `[Fire]` posterior ao `[BlastingPlan]` que contém o plano resolvido, considerando zeros à esquerda, separadores e mês de emissão diferente do mês de detonação.
8. Se houver mais de um bloco compatível, priorizar mês coincidente; se a ambiguidade permanecer, interromper e listar os candidatos, sem escolher um bloco arbitrariamente.
9. Ler o projeto e o realizado.
10. Mesclar os dados pelo `Number`.
11. Normalizar `DetonatingTime`: valores vazios, não numéricos, negativos (inclusive `-1`) e repetições posteriores são posições sem tempo. Ordenar os furos por `Number`, analisar as âncoras anterior/posterior e preencher cada bloco com tempos inteiros determinísticos, sempre únicos; se o intervalo não comportar todos os valores, extrapolar deterministicamente para manter a unicidade.
12. Redistribuir cargas zeradas quando configurado, preservando o total alvo e os extremos da coluna.
13. Fechar o total de `cargas realizadas` ao alvo configurado quando `business.enforce_charge_total_target` estiver habilitado, preservando o menor e o maior valor da coluna.
   - No site, o usuário pode fornecer um alvo em kg para a execução atual; o valor informado tem precedência sobre a configuração e é aplicado aos furos intermediários, com fechamento exato e erro explícito quando inviável.
14. Aplicar simulação determinística de variação em `tampao realizado` quando configurada e exportar `tampao previsto` / `tampao realizado` com uma casa decimal.
15. Montar a tabela final de saída.
16. Montar o resumo.
17. Exportar o Excel.
18. Registrar log da execução.

19. Validar a saída final e interromper a exportação se houver tempo vazio, negativo ou repetido.

### Modo online incremental
As seleções sucessivas são acumuladas em memória, com deduplicação por nome, tamanho e data de modificação. A remoção atualiza imediatamente o conjunto submetido. Antes de escolher o evento do HISTO, o pipeline coleta IDs candidatos dos nomes e das primeiras linhas das tabelas e cruza-os com o bloco de plano usando a composição `PLANO;MÊS;ANO`: zeros à esquerda e separadores são normalizados, o ano é preservado e o mês não impede a associação.
