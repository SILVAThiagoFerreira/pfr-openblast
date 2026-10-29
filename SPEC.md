# SPEC

## Objetivo
Gerar um Excel de plano de fogo realizado a partir dos arquivos operacionais PP, com validação prévia, backup e rastreabilidade.

## Entradas
- Projeto: `Projeto Completo.csv` (`*PROJETO COMPLETO*`)
- Realizado: `Config Final.csv` (`*CONFIG FINAL*`), exportado após Atualização dos Furos
- Plano Excel: `Plano de Perfuração.xlsx` (aba `PROJETO PERFURAÇÃO`; colunas `ID`, `X Collar`, `Y Collar`, `Z Collar`; fonte da cota quando o Config Final não traz cota válida, ver "Cota (Z) do realizado")
- Plano PDF: `Plano de Perfuração.pdf` (`PP*.pdf` ou `PP.pdf`)
- Histórico da BMO: `.txt` ou novo padrão `*_histo.log`; obrigatório no modo automático e opcional no modo forçado
- Relatório BREX (BMO) — opcional, somente no site: arquivo `*.brex` (XML `DB_BLASTREPORT_EXCHANGE`) exportado pelo sismógrafo BMO. Serve apenas para preencher o horário de desmonte; não entra no Excel como fonte de dados. Formato em `DATA_SCHEMA.md`, seção "Entrada BREX (BMO)".

## Regras
- O ID do plano deve ser resolvido de forma auditável. O sistema tenta extrair o ID nesta ordem: (1) regex configurado no conteúdo do PDF, (2) regex configurado no conteúdo do HISTO, (3) padrão PP nos nomes dos arquivos de entrada, (4) `business.fallback_plan_id`. O modo `"auto"` habilita todas as fontes; o modo `"fallback"` usa apenas nomes de arquivo e fallback.
- Quando o PDF trouxer o plano com zero à esquerda e o HISTO registrar a mesma frente sem esse zero, o sistema deve tratar as duas formas como equivalentes para localizar o bloco operacional correto e nomear a saída pelo ID resolvido.
- O ID segue a composição `PP<PLANO><MÊS><ANO>`: os quatro últimos dígitos representam mês e ano, e os dígitos anteriores representam o plano. Para localizar o bloco no HISTO, o mês pode ser diferente entre o PDF/arquivos e a detonação; a comparação exige o mesmo plano e ano, ignorando apenas o mês. O ID do evento encontrado no HISTO permanece como o identificador da execução.
- Se mais de um bloco `[BlastingPlan]` for compatível com o mesmo plano e ano, priorizar o bloco cujo mês coincida com o ID de origem; permanecendo mais de um candidato, abortar com erro explícito de ambiguidade.
- A data/hora do disparo não deve vir do último `[Fire]` do histórico inteiro. O sistema deve localizar o bloco `[BlastingPlan]` que contém o plano operacional, por exemplo `PP320526`, e usar o primeiro evento `[Fire]` posterior a esse bloco.
- No novo histórico, o sistema também deve localizar o bloco `[StartProcedure]` que contenha a linha `BP: PP<plano>` e usar o primeiro `[Fire]` posterior dentro desse bloco. Cabeçalhos com espaços, `BP:` e múltiplos eventos `[Fire]` são aceitos.
- A conversão de fuso é explícita. O offset selecionado (por exemplo, `-03:00`) deve ser aplicado ao instante do HISTO antes da gravação no Excel e identificado nos detalhes do resultado da página.
- IDs numéricos presentes em linhas de teste, detonadores ou eventos como `TestDetsResult` não são IDs de plano e não podem nomear a saída.
- O `Config Final.csv` é a fonte autoritativa dos furos realizados: todo `Number` presente nele entra na saída, mesmo que o mesmo ID esteja com `eliminated == 1` no `Projeto Completo.csv`. A configuração `business.include_eliminated` fica `true` por padrão; somente uma configuração explícita como `false` pode excluir esses registros, e a quantidade excluída deve permanecer auditável.
- O campo `eliminated` é tratado como opcional no arquivo de projeto; quando ausente, a validação não bloqueia a execução.
- `DetonatingTime` vazio, não numérico, negativo (incluindo `-1`) ou repetido é tratado como ausência. O sistema analisa a posição do furo na sequência ordenada por `Number`, usa os tempos válidos anterior e posterior como âncoras e gera uma sequência determinística de milissegundos inteiros, sempre sem repetir nenhum tempo na saída. Quando não houver espaço inteiro entre as âncoras, a sequência é estendida de forma determinística para preservar a unicidade.
- Quando a simulação de teste de tampão estiver habilitada, `tampao realizado` recebe uma variação determinística de até `0,12` para mais ou para menos e `tampao previsto` / `tampao realizado` são exportados com uma casa decimal.
- Quando houver `cargas realizadas` zeradas, o fluxo deve redistribuir uma carga mínima configurada sem alterar o total alvo e sem modificar o menor nem o maior valor da coluna.
- Quando `business.enforce_charge_total_target` estiver habilitado, o total final de `cargas realizadas` deve fechar exatamente em `business.charge_total_target_kg`, mesmo sem cargas zeradas, sem alterar o furo de menor carga nem o de maior carga e sem criar valores fora desses limites.
- No site, o usuário pode habilitar um alvo de carga realizada em kg e deve informar também uma carga mínima positiva por furo e o ID único do furo que receberá esse mínimo. O alvo substitui o alvo configurado apenas para a execução atual. A distribuição percorre todo o plano: fixa o furo identificado exatamente no mínimo informado, ajusta determinísticamente os demais furos intermediários dentro do intervalo mínimo-máximo, preserva exatamente a maior carga original do `InputedCharge` e todos os furos empatados nesse valor, e fecha o total final. O ID mínimo não pode pertencer ao grupo de máximos originais. Sem alvo habilitado, a execução mantém o comportamento padrão.
- Ao anexar um `Config Final` legível, o site sugere automaticamente a menor carga positiva de `InputedCharge` e o primeiro `Number` correspondente nos campos de carga mínima e ID mínimo. Valores editados pelo usuário não são sobrescritos.
- `X` e `Y` são preenchidos a partir do arquivo final e, se faltarem, do arquivo de projeto.
- `Z (crest)` e `Z (toe)` são cotas (elevação, em metros) e seguem a seção "Cota (Z) do realizado".
- O arquivo de saída é nomeado com o ID do plano.

## Cota (Z) do realizado
Motivo: o `Config Final` exportado em 27/10/2026 (REG CRISTA F3) trazia em `Z` valores com a ordem de grandeza de X (748775,62 no furo 171), e não cota (~287,6 m). O Excel gravou esses valores em `Z (crest)`. A cota real está no Plano de Perfuração (`Z Collar`), e o `Z_Toe` do Config Final segue a mesma convenção (`Z_Toe = Z - Length * cos(Angle)`, verificada em todos os 204 furos desse export).

- Faixa de cota: um valor de `Z` só é cota se estiver entre `business.elevation_plausible_min_m` (-500) e `business.elevation_plausible_max_m` (5000). Valores fora dessa faixa não são usados como cota.
- `Z (crest)`: usa o `Z` do Config Final quando é cota válida. Senão, usa o `Z Collar` do Plano de Perfuração (planilha, aba cujo nome contém `business.elevation_design_sheet_pattern`, ex.: `PROJETO PERFURAÇÃO`) do mesmo `Number`, desde que o `X`/`Y` do Config Final esteja a até `business.elevation_design_match_tolerance_m` (0,5 m) do `X Collar`/`Y Collar` do plano. Furos sem cota válida ficam com `Z (crest)` e `Z (toe)` em branco e aparecem em aviso com o motivo.
- `Z (toe)`: usa o `Z_Toe` do Config Final somente quando o `Z (crest)` também veio do Config Final e o valor é cota válida. Senão, é calculado pela geometria realizada: `Z (crest) - profundidade realizada * cos(inclinação)`, com aviso. O `Z Toe` planejado do plano não é usado, porque a profundidade realizada pode diferir da prevista.
- Sem nenhuma cota válida em todo o plano, a execução é interrompida com erro explícito; não há coluna vazia silenciosa.
- Avisos (site e log da CLI): Z do Config Final fora da faixa (com exemplos), cota obtida do plano (quantidade), furos sem cota (IDs e motivo), Z (toe) calculado (quantidade).
- O Plano de Perfuração é identificado pelas colunas `ID`, `X Collar`, `Y Collar` e `Z Collar`. Se a planilha for encontrada e faltarem colunas, a validação para com erro. No site, a leitura de cabeçalhos reconhece variações destas quatro colunas com aviso, como nas demais tabelas.
- Implementação: `public/elevation.js` (site) e `src/pfr/elevation.py` (CLI); mesma regra e mesmos avisos. Testes: `tests/test_elevation.js` e `tests/test_elevation.py`.

## Validação
- Verificar existência dos arquivos obrigatórios.
- Verificar colunas mínimas do projeto e do realizado.
- Verificar que a quantidade de furos exportados coincide com a quantidade de linhas do `Config Final` quando `business.include_eliminated` estiver habilitado; registrar as contagens de origem e saída no log.
- Se houver cargas zeradas, exigir `business.charge_total_target_kg` e aplicar a redistribuição configurada sem alterar os extremos da coluna.
- Se `business.enforce_charge_total_target` estiver habilitado, exigir ao menos 3 furos com carga válida e abortar com erro claro quando o fechamento ao total alvo não puder ser feito preservando os extremos.
- No site, rejeitar alvo ausente, não numérico ou menor/igual a zero; rejeitar carga mínima ausente, não numérica ou menor/igual a zero; rejeitar ID de furo vazio, inexistente ou duplicado; rejeitar ID que pertença ao grupo de máximos originais; rejeitar mínimo acima da maior carga da planilha e alvos que não possam ser distribuídos entre os limites preservados, com mensagem clara antes do download.
- Validar que todos os tempos de detonação exportados sejam inteiros, não negativos, preenchidos e únicos.
- Abortar com erro claro se algo crítico faltar. No modo automático, o HISTO e um evento `[Fire]` identificável são obrigatórios. No modo forçado, o HISTO pode ser omitido somente quando o usuário informar a data e o horário locais do desmonte; o ID do plano é resolvido pela ordem da seção "ID textual e ordem de resolução (site)", e nenhum dos três é substituído pela data do computador.
- A aba `Resumo` do Excel deve conter somente as colunas `Plano`, `Data` e `Hora`, com uma linha de valores.
- No site, os cabeçalhos das colunas obrigatórias são reconhecidos sem diferenciar caixa, acentos, espaços e separadores (ex.: `number` → `Number`, `z toe` → `Z_Toe`). Um cabeçalho só é ajustado quando a variação casa com uma única coluna conhecida e a coluna exata ainda não existe na tabela; cada ajuste aparece como aviso no resultado. Aliases já existentes (ex.: `Angle (º)`) são aplicados sem aviso.
- No site, avisos de identificação (ID derivado do nome do arquivo ou ID gerado) e ajustes de cabeçalho não bloqueiam a geração. Continuam bloqueando: ausência de HISTO no modo automático, data ou horário ausentes no modo forçado, ID do plano inexistente no HISTO, anexos de planos diferentes, ambiguidade de blocos `[BlastingPlan]`, falta de colunas obrigatórias e qualquer erro de dados ou temporização.

## Identificação pública do plano
No processamento local do navegador, o ID é interpretado como `PLANO;MÊS;ANO`. O prefixo `PP`, espaços, hífens, sublinhados e pontos são tolerados, e zeros à esquerda não alteram a identidade do plano. A fonte é priorizada pelo bloco `[BlastingPlan]` do HISTO que tenha o mesmo plano e ano das pistas dos arquivos/tabelas anexados, mesmo quando o mês de emissão for diferente do mês da detonação.

O sistema detecta automaticamente o ID do plano a partir dos nomes dos arquivos de entrada (ex: `PP0370626.pdf`, `PP370726_B.xlsx`). Pequenas variações como zeros à esquerda, sufixos (`_B`, `_D`) e separadores diferentes são normalizadas. Se nenhum arquivo contiver um ID reconhecível, o fallback configurado é utilizado. No site, a resolução completa segue a seção "ID textual e ordem de resolução (site)".

Na página pública, o campo `ID / nome do plano de fogo em trabalho` permite registrar a identificação manual. Quando ela contém um ID numérico válido, esse ID é usado na coluna `Plano`, no nome do Excel e no resumo, mantendo também o ID localizado no HISTO quando forem diferentes. A página reconhece `BP:440826` e `BP: PP440826` no novo `.log`. O botão `Forçar execução` exige confirmação e pode ignorar a divergência de identificação ou a ausência total do HISTO. Sem HISTO, a data e o horário locais informados no site são obrigatórios e não recebem conversão de fuso; o ID, as colunas, o PDF, os furos e as temporizações continuam sendo validados.

### ID textual e ordem de resolução (site)
- Qualquer texto não vazio digitado no campo de identificação é aceito como ID do plano. Exemplos: `REG CRISTA F3`, `Área Norte 2`. O texto é gravado como digitado na coluna `Plano` e na aba `Resumo`; espaços laterais são removidos e acentos são mantidos.
- Um ID numérico (`440726`, `PP440726`, `PP0440726_D`, `Plano 440726`) continua sendo normalizado para o número do plano e gravado como tal.
- Quando o texto digitado contém um número de plano entre outras palavras (ex.: `REG 440726 CRISTA`), o número é usado apenas para localizar o bloco no HISTO; o texto digitado continua sendo o ID gravado.
- Sem ID digitado, a ordem é: (1) ID numérico dos anexos ou do HISTO, sem aviso; (2) nome do PDF ou da planilha de plano dos anexos, sem termos genéricos (ex.: `Plano de Perfuração.pdf`, `PP.pdf`, `Projeto Completo`, `Config Final`), com o sublinhado trocado por espaço (`Crista_F3.pdf` → `Crista F3`), com aviso; (3) ID gerado `PFR_<AAAAMMDD>_<HHMMSS>` a partir da data e do horário do disparo já resolvidos, com aviso. O prefixo `PFR` e os termos genéricos vêm de `business.plan_label_fallback_prefix` e `business.plan_label_generic_names`.
- O resultado informa a origem do ID (`Digitado`, `Anexos ou HISTO`, `Nome do arquivo (automático)` ou `Gerado (automático)`) e lista os avisos em um bloco próprio, sem bloquear o arquivo.
- Nome do arquivo: ID numérico gera `Plano_Fogo_Realizado_PP<plano>.xlsx`; qualquer outro ID gera `Plano_Fogo_Realizado_<nome>.xlsx`, em que `<nome>` é o ID sem acentos, com espaços trocados por `_`, sem caracteres inválidos em nomes de arquivo e com no máximo `business.plan_label_max_length` caracteres. Se nada restar, o arquivo é `Plano_Fogo_Realizado.xlsx`, com aviso.
- O HISTO continua sendo a fonte do disparo. Com HISTO, o ID encontrado nele é mostrado como `ID no HISTO` quando for diferente do ID gravado.

## Importação do BREX (BMO) no site
- O botão "Importar BREX (BMO)", ao lado de "Horário local do desmonte", lê um ou mais arquivos `.brex` somente no navegador. Nenhum arquivo é enviado a servidor.
- Validação: o arquivo deve ser XML bem formado com raiz `DB_BLASTREPORT_EXCHANGE`. Tag fora de ordem, texto fora da raiz, data ou horário de disparo inválidos interrompem a importação com mensagem que indica o arquivo. Um bloco `DATA` sem `FIRING_DATE` e `FIRING_TIME_START` gera aviso e é ignorado; se nenhum bloco tiver disparo, a importação falha. Nenhum disparo é inventado.
- Horário: o disparo é o `FIRING_TIME_START` do bloco, lido como relógio do BMO. O ajuste em horas inteiras é aplicado a todos os horários listados (`horário ajustado = horário do BMO + ajuste`). O padrão vem de `business.brex_offset_hours` (-3, para equipamento em UTC e horário de Brasília), com limites `business.brex_offset_min_hours` e `business.brex_offset_max_hours`. Ajuste não inteiro ou fora dos limites é recusado e a lista não é exibida.
- Identificadores de cada disparo: plano, nome do BMO (`DISPLAYED_NAME`), evento (`BLAST_EVENT_ID` com `FIRING_TAG`), número de série do BMO (`DATA@DBD_SN`) e nome do arquivo. Um plano é extraído somente do nome do BMO, como `PP` seguido de 6 a 8 dígitos ou de 6 dígitos isolados, validado pela regra `PLANO;MÊS;ANO`. O nome do arquivo não é usado para extrair plano.
- Ranking: (1) pontuação pelo ID/nome digitado em "ID / nome do plano de fogo em trabalho"; (2) disparos na data informada em "Data local do desmonte"; (3) ordem cronológica. Pontuação: mesmo plano e ano, com mês ignorado, 90; igualdade após remover acentos, caixa, espaços e pontuação, 100; contenção de texto com 3 ou mais caracteres, 70; metade ou mais das palavras encontradas, de 20 a 40. Disparos com pontuação acima de zero ficam em destaque, mas não são preenchidos automaticamente. O ranking é refeito ao alterar o ID, a data ou o ajuste.
- Seleção: o disparo escolhido preenche "Horário local do desmonte" em HH:MM:SS, com o horário ajustado. Data e ID não são alterados. Se o ajuste mudar depois da escolha e o campo ainda tiver o horário preenchido pelo botão, o horário acompanha o novo ajuste; horário digitado pelo usuário não é sobrescrito.
- Rótulo do disparo escolhido: plano do evento; sem plano no evento, o ID digitado; sem ambos, o nome do BMO, o número do evento ou a série do BMO.
- Limites: o horário preenchido mantém os segundos do `FIRING_TIME_START`. O BREX não substitui o HISTO e não participa do processamento pela linha de comando.
- Arquivos `.brex` arrastados ou escolhidos no campo principal de anexos são encaminhados a esta importação e não entram na lista de anexos do plano. Os demais formatos seguem o fluxo normal de anexos.

## Determinismo
- Ordenação por `Number`.
- Formatos e nomes fixos via configuração.
- Backup por timestamp.
- Plano, data e hora devem ser reprodutíveis a partir de `config.yaml` e do bloco correspondente no `HISTO-*.txt`; na execução forçada sem HISTO, a data e o horário inseridos pelo usuário são as fontes explícitas do evento.

## Modelos de apoio publicados
Na interface pública, a seção recolhível de modelos deve disponibilizar exatamente os três arquivos oficiais, com `href` e atributo `download` preservando os nomes originais:

- `Plano de Fogo - PC.xls` — Modelo - Pré-Corte - SEM FUROS;
- `Plano de Fogo Realizado - PP.xlsx` — Modelo - Produção;
- `Plano Realizado - REG .xls` — Modelo - Regularização.
