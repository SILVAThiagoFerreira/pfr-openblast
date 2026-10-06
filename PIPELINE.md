# PIPELINE

1. Carregar configuração.
2. Resolver caminhos absolutos.
3. Descobrir arquivos de entrada em `input/` usando padrões flexíveis (`PP*.pdf`, `PP*.xlsx`, `*PROJETO COMPLETO*`, `*CONFIG FINAL*`, `HISTO-*.txt`, `*_histo.log`).
4. Validar presença e colunas mínimas; no modo online automático, exigir o HISTO, e no modo online forçado permitir sua ausência somente com data e horário locais informados pelo usuário.
5. Gerar backup dos insumos.
6. Resolver ID do plano em múltiplas fontes: (a) regex configurado no conteúdo do PDF, (b) regex configurado no conteúdo do HISTO, (c) padrão PP nos nomes dos arquivos de entrada, (d) `business.fallback_plan_id`. A primeira fonte que produzir um ID válido é utilizada. Interpretar o ID como `PLANO;MÊS;ANO`: comparar o mesmo plano e ano, ignorando o mês para permitir que a emissão e a detonação ocorram em meses diferentes. Pequenas variações nos nomes (zeros à esquerda, sufixos, separadores) são normalizadas automaticamente.
7. Extrair data e hora do disparo pelo primeiro `[Fire]` posterior ao bloco compatível: `[BlastingPlan]` no formato antigo ou `[StartProcedure]` com `BP: PP<plano>` no novo `.log`, considerando zeros à esquerda, separadores e mês de emissão diferente do mês de detonação.
8. Aplicar o offset de fuso configurado (por exemplo, `-03:00`) ao instante do HISTO antes de montar a saída e exibir a conversão nos detalhes do resultado.
   - Se o HISTO estiver ausente no modo forçado, exigir a data e o horário locais informados no site; nenhum deles recebe conversão adicional de fuso nem é obtido do relógio do computador.
   - Se o usuário preencher a data com HISTO anexado, usar essa data local no lugar da data do evento; caso contrário, manter a data extraída do `[Fire]`.
9. Se houver mais de um bloco compatível, priorizar mês coincidente; se a ambiguidade permanecer, interromper e listar os candidatos, sem escolher um bloco arbitrariamente.
10. Ler o projeto e o realizado. O `Config Final` é a fonte autoritativa da cardinalidade da saída.
11. Mesclar os dados pelo `Number`, mantendo todo `Number` presente no `Config Final`; `business.include_eliminated` permite uma exclusão operacional explícita e a quantidade de exclusões é registrada.
    - Quando a inclusão estiver habilitada, interromper a execução se a quantidade final divergir da quantidade de linhas do `Config Final`.
12. Normalizar `DetonatingTime`: valores vazios, não numéricos, negativos (inclusive `-1`) e repetições posteriores são posições sem tempo. Ordenar os furos por `Number`, analisar as âncoras anterior/posterior e preencher cada bloco com tempos inteiros determinísticos, sempre únicos; se o intervalo não comportar todos os valores, extrapolar deterministicamente para manter a unicidade.
13. Redistribuir cargas zeradas quando configurado, preservando o total alvo e os extremos da coluna.
14. Fechar o total de `cargas realizadas` ao alvo configurado quando `business.enforce_charge_total_target` estiver habilitado, preservando o menor e o maior valor da coluna.
   - No site, o usuário pode fornecer um alvo em kg para a execução atual, uma carga mínima positiva por furo e o ID único do furo que receberá esse mínimo. O alvo informado tem precedência sobre a configuração; o furo mínimo e todos os furos empatados na maior carga original permanecem fixos, os demais furos intermediários são ajustados de forma determinística em todo o plano e o fechamento é exato. ID inexistente/duplicado, ID mínimo pertencente ao grupo máximo, mínimo acima do máximo ou alvo inviável interrompem a execução com erro explícito.
15. Aplicar simulação determinística de variação em `tampao realizado` quando configurada e exportar `tampao previsto` / `tampao realizado` com uma casa decimal.
16. Montar a tabela final de saída.
17. Montar o resumo com somente as colunas `Plano`, `Data` e `Hora` e uma linha de valores.
18. Exportar o Excel.
19. Registrar log da execução.

20. Validar a saída final e interromper a exportação se houver tempo vazio, negativo ou repetido.

21. No modo online, aceitar a identificação manual opcional do plano e mostrar o valor e as fontes do evento no resultado da página.
22. Disponibilizar `Forçar execução` como ação explícita e confirmada para divergências de ID ou ausência do HISTO; no segundo caso, exigir data e horário locais informados pelo usuário. Em ambos os casos, manter todas as validações estruturais.
23. Ao anexar tabelas no modo online, ler o `Config Final` e preencher uma sugestão de carga mínima positiva e o primeiro ID correspondente; preservar campos que o usuário já editou manualmente.

### Modo online incremental
As seleções sucessivas são acumuladas em memória, com deduplicação por nome, tamanho e data de modificação. A remoção atualiza imediatamente o conjunto submetido. Antes de escolher o evento do HISTO, o pipeline coleta IDs candidatos dos nomes e das primeiras linhas das tabelas e cruza-os com o bloco de plano usando a composição `PLANO;MÊS;ANO`: zeros à esquerda e separadores são normalizados, o ano é preservado e o mês não impede a associação.
