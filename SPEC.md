# SPEC

## Objetivo
Gerar um Excel de plano de fogo realizado a partir dos arquivos operacionais PP, com validação prévia, backup e rastreabilidade.

## Entradas
- Projeto: `OPIT-PP*PROJETO COMPLETO*`
- Realizado: `OPIT-PP*CONFIG FINAL*`
- Plano PDF: `PP.pdf`
- Histórico: `HISTO-*.txt`

## Regras
- O ID do plano deve ser resolvido de forma auditável. Quando a extração automática puder confundir IDs de detonadores, usar `business.plan_id_source: "fallback"` e registrar o plano correto em `business.fallback_plan_id`.
- Quando o PDF trouxer o plano com zero à esquerda e o HISTO registrar a mesma frente sem esse zero, o sistema deve tratar as duas formas como equivalentes para localizar o bloco operacional correto e nomear a saída pelo ID resolvido.
- O ID segue a composição `PP<PLANO><MÊS><ANO>`: os quatro últimos dígitos representam mês e ano, e os dígitos anteriores representam o plano. Para localizar o bloco no HISTO, o mês pode ser diferente entre o PDF/arquivos e a detonação; a comparação exige o mesmo plano e ano, ignorando apenas o mês. O ID do evento encontrado no HISTO permanece como o identificador da execução.
- Se mais de um bloco `[BlastingPlan]` for compatível com o mesmo plano e ano, priorizar o bloco cujo mês coincida com o ID de origem; permanecendo mais de um candidato, abortar com erro explícito de ambiguidade.
- A data/hora do disparo não deve vir do último `[Fire]` do histórico inteiro. O sistema deve localizar o bloco `[BlastingPlan]` que contém o plano operacional, por exemplo `PP320526`, e usar o primeiro evento `[Fire]` posterior a esse bloco.
- IDs numéricos presentes em linhas de teste, detonadores ou eventos como `TestDetsResult` não são IDs de plano e não podem nomear a saída.
- Registros com `eliminated == 1` não entram na saída.
- O campo `eliminated` é tratado como opcional no arquivo final; quando ausente, a validação não bloqueia a execução.
- `DetonatingTime` vazio é preenchido por uma sequência determinística e única entre os valores válidos da sequência ordenada por `Number`, sem criar tempos repetidos novos.
- Quando a simulação de teste de tampão estiver habilitada, `tampao realizado` recebe uma variação determinística de até `0,12` para mais ou para menos e `tampao previsto` / `tampao realizado` são exportados com uma casa decimal.
- Quando houver `cargas realizadas` zeradas, o fluxo deve redistribuir uma carga mínima configurada sem alterar o total alvo e sem modificar o menor nem o maior valor da coluna.
- Quando `business.enforce_charge_total_target` estiver habilitado, o total final de `cargas realizadas` deve fechar exatamente em `business.charge_total_target_kg`, mesmo sem cargas zeradas, sem alterar o furo de menor carga nem o de maior carga e sem criar valores fora desses limites.
- `X` e `Y` são preenchidos a partir do arquivo final e, se faltarem, do arquivo de projeto.
- `Z (crest)` e `Z (toe)` devem refletir a geometria do arquivo final quando disponível.
- O arquivo de saída é nomeado com o ID do plano.

## Validação
- Verificar existência dos arquivos obrigatórios.
- Verificar colunas mínimas do projeto e do realizado.
- Se houver cargas zeradas, exigir `business.charge_total_target_kg` e aplicar a redistribuição configurada sem alterar os extremos da coluna.
- Se `business.enforce_charge_total_target` estiver habilitado, exigir ao menos 3 furos com carga válida e abortar com erro claro quando o fechamento ao total alvo não puder ser feito preservando os extremos.
- Abort ar com erro claro se algo crítico faltar.

## Identificação pública do plano
No processamento local do navegador, o ID é interpretado como `PLANO;MÊS;ANO`. O prefixo `PP`, espaços, hífens, sublinhados e pontos são tolerados, e zeros à esquerda não alteram a identidade do plano. A fonte é priorizada pelo bloco `[BlastingPlan]` do HISTO que tenha o mesmo plano e ano das pistas dos arquivos/tabelas anexados, mesmo quando o mês de emissão for diferente do mês da detonação.

## Determinismo
- Ordenação por `Number`.
- Formatos e nomes fixos via configuração.
- Backup por timestamp.
- Plano, data e hora devem ser reprodutíveis a partir de `config.yaml` e do bloco correspondente no `HISTO-*.txt`.
